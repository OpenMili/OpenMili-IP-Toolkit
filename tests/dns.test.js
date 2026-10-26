'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const dgram=require('node:dgram');
const net=require('node:net');
const tls=require('node:tls');
const fs=require('node:fs');
const path=require('node:path');
const packet=require('dns-packet');
const {wireQuery,dohQuery,inspectDNS,compareAnswers,systemLookup}=require('../lib/dns');
const {inPrefix,reverseIP}=require('../lib/ip-network');
test('P1 真实 UDP/TCP DNS：事务匹配、分片帧、各记录与 NXDOMAIN',async()=>{
  const sockets=new Set();
  const answer=wire=>{
    const q=packet.decode(wire),question=q.questions[0],type=question.type;
    const data={A:'192.0.2.1',AAAA:'2001:db8::1',CNAME:'cdn.example.org',MX:{preference:10,exchange:'mx.example.org'},TXT:[Buffer.from('fixture only')],PTR:'ptr.example.org'}[type];
    return packet.encode({type:'response',id:q.id,flags:packet.RECURSION_AVAILABLE|(question.name.startsWith('missing.')?3:0),questions:q.questions,answers:question.name.startsWith('missing.')?[]:[{...question,ttl:30,data}]});
  };
  const tcp=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let data=Buffer.alloc(0),sent=false;
    socket.on('data',chunk=>{
      data=Buffer.concat([data,chunk]);if(sent||data.length<2||data.length<data.readUInt16BE(0)+2)return;sent=true;
      const body=answer(data.subarray(2)),length=Buffer.alloc(2);length.writeUInt16BE(body.length);
      const response=Buffer.concat([length,body]);socket.write(response.subarray(0,1));setImmediate(()=>socket.end(response.subarray(1)));
    });
  });
  await new Promise(r=>tcp.listen(0,'127.0.0.1',r));const port=tcp.address().port;
  const udp=dgram.createSocket('udp4');udp.on('message',(wire,remote)=>{
    const good=answer(wire),bad=Buffer.from(good);bad.writeUInt16BE((bad.readUInt16BE(0)+1)%65536);
    udp.send(bad,remote.port,remote.address);udp.send(good,remote.port,remote.address);
  });
  await new Promise((r,reject)=>{udp.once('error',reject);udp.bind(0,'127.0.0.1',r);});
  const udpPort=udp.address().port;
  try{
    for(const protocol of ['udp','tcp'])for(const type of ['A','AAAA','CNAME','MX','TXT','PTR']){
      const r=await wireQuery('example.org',type,{server:`127.0.0.1:${protocol==='udp'?udpPort:port}`,protocol,sourceIP:'127.0.0.1'});
      assert.equal(r.status,'success',r.reason);assert.equal(r.answers[0].type,type);assert.ok(r.latency_ms>=0);
    }
    const nx=await wireQuery('missing.example.org','A',{server:`127.0.0.1:${udpPort}`});assert.equal(nx.code,'DNS_NXDOMAIN');assert.equal(nx.status,'limited');
    const module=await inspectDNS({dnsHost:'example.org',resolver:`127.0.0.1:${udpPort}`,dnsProtocols:['udp'],concurrency:2,systemResolver:false});assert.equal(module.checks.length,5);assert.equal(module.leak.status,'skipped');assert.equal(module.status,'success');
    const badTLS=await wireQuery('example.org','A',{server:`127.0.0.1:${port}`,protocol:'dot',port,timeout:150});assert.equal(badTLS.status,'unknown');
  }finally{for(const s of sockets)s.destroy();await Promise.all([new Promise(r=>udp.close(r)),new Promise(r=>tcp.close(r))]);}
});
test('P1 DNS 无响应、取消、代理能力不足不会标红或静默直连',async()=>{
  const udp=dgram.createSocket('udp4');await new Promise(r=>udp.bind(0,'127.0.0.1',r));
  const server=`127.0.0.1:${udp.address().port}`;
  try {
    assert.equal((await wireQuery('example.org','A',{server,timeout:50})).code,'DNS_TIMEOUT');
    assert.equal((await wireQuery('example.org','A',{server,proxy:'http://localhost:9'})).status,'skipped');
    const controller=new AbortController();const pending=wireQuery('example.org','A',{server,signal:controller.signal});controller.abort();assert.equal((await pending).code,'ABORTED');
  }finally{await new Promise(r=>udp.close(r));}
});
test('P1 DoH 校验问题/类型，不同 CDN 结果不当作污染',async()=>{
  let hits=0;
  const request=async()=>({status:200,duration:3,body:JSON.stringify({Status:0,AD:true,Question:[{name:'example.org.',type:1}],Answer:[{name:'example.org.',type:1,TTL:30,data:'192.0.2.2'}]})});
  const good=await dohQuery('example.org','A',{request});assert.equal(good.status,'success');assert.equal(good.resolver_reports_ad,true);
  assert.equal((await dohQuery('other.example.org','A',{request})).code,'DOH_FAILED');
  assert.equal((await dohQuery('example.org','AAAA',{request})).code,'DOH_FAILED');
  const skipped=await dohQuery('example.org','A',{offline:true,request:()=>{hits++;}});assert.equal(skipped.status,'skipped');assert.equal(hits,0);
  const diff=compareAnswers([good,{...good,answers:[{type:'A',data:'192.0.2.3'}]}]);assert.equal(diff.length,1);assert.match(diff[0].reason,/不能据此证明污染/);
});
test('P1 IPv4/IPv6 前缀范围与反向查询无压缩歧义',()=>{
  assert.equal(inPrefix('2606:4700::1111','2606:4700::/32'),true);assert.equal(inPrefix('2606:4701::1','2606:4700::/32'),false);
  assert.equal(inPrefix('8.8.8.8','8.8.8.0/24'),true);assert.equal(inPrefix('8.8.9.8','8.8.8.0/24'),false);assert.equal(inPrefix('8.8.8.8','8.8.0.0/33'),false);
  assert.equal(reverseIP('8.8.8.8'),'8.8.8.8.in-addr.arpa');assert.equal(reverseIP('::1').split('.').slice(0,3).join('.'),'1.0.0');
});
test('P1 系统解析器实际调用 OS，代理/绑定模式明确跳过',async()=>{
  const local=await systemLookup('localhost');assert.equal(local.status,'success',local.reason);assert.ok(local.addresses.some(a=>['127.0.0.1','::1'].includes(a.address)));
  assert.equal((await systemLookup('localhost',{sourceIP:'127.0.0.1'})).status,'skipped');
  assert.equal((await systemLookup('localhost',{proxy:'http://127.0.0.1:9'})).status,'skipped');
});
test('P1 DoT 真实可信 TLS 握手、DNS 长度帧与错误证书拒绝',async()=>{
  const cert=fs.readFileSync(path.join(__dirname,'fixtures/dns-cert.pem')),key=fs.readFileSync(path.join(__dirname,'fixtures/dns-key.pem'));
  const sockets=new Set();
  const server=tls.createServer({cert,key},socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let buffer=Buffer.alloc(0);
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length<2||buffer.length<buffer.readUInt16BE(0)+2)return;
      const q=packet.decode(buffer.subarray(2));const body=packet.encode({type:'response',id:q.id,questions:q.questions,answers:[{name:q.questions[0].name,type:'A',ttl:30,data:'192.0.2.1'}]});
      const length=Buffer.alloc(2);length.writeUInt16BE(body.length);socket.end(Buffer.concat([length,body]));
    });
  });server.on('tlsClientError',()=>{});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  try{
    const options={server:'127.0.0.1',port,protocol:'dot',servername:'localhost',ca:cert};
    const good=await wireQuery('example.org','A',options);assert.equal(good.status,'success',good.reason);assert.equal(good.port,port);
    const bad=await wireQuery('example.org','A',{...options,servername:'wrong.example'});assert.equal(bad.code,'DNS_TLS_FAILED');
  }finally{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});
