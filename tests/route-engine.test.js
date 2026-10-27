'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {parseHops,routeDirection,traceCommand,runTraceroute,resolveNode,measureRoutes}=require('../lib/route-engine');
test('P2 完整跳点保留星号、IPv6、多地址、RTT 上界和确实到达',()=>{
  const result=parseHops('traceroute to 2606:4700::1111\n 1 <1 ms <1 ms <1 ms fe80::1%12\n 2 * * *\n 3 2606:4700::1111 10.2 ms 11.4 ms 12.6 ms\n','2606:4700:0:0:0:0:0:1111');
  assert.equal(result.hops.length,3);assert.equal(result.hops[1].anonymous,true);assert.equal(result.hops[1].anonymous_probes,3);assert.equal(result.reached,true);
  assert.equal(result.hops[0].ip,'fe80::1');assert.equal(result.hops[0].rtt,null);assert.equal(result.hops[0].rtt_samples[0].upper_bound,true);
  assert.deepEqual(result.hops[2].rtt,{min:10.2,avg:11.4,p95:12.6,samples:3});
  const multipath=parseHops(' 1 1.1.1.1 1 ms 8.8.8.8 2 ms 1.1.1.1 3 ms','9.9.9.9');assert.deepEqual(multipath.hops[0].ips,['1.1.1.1','8.8.8.8']);assert.equal(multipath.reached,false);
  assert.equal(parseHops('traceroute to 8.8.8.8\n 1 * * *','8.8.8.8').reached,false);
});
test('P2 协议/绑定能力严格区分，方向声明不冒充核实的海外回程',()=>{
  const tcp=traceCommand('2606:4700::1111','tcp',{platform:'linux',sourceIP:'2606:4700::2'});assert.ok(tcp.args.includes('-6'));assert.ok(tcp.args.includes('-T'));assert.ok(tcp.args.includes('-s'));
  assert.equal(traceCommand('8.8.8.8','tcp',{platform:'win32'}),null);assert.equal(traceCommand('8.8.8.8','icmp',{platform:'win32',sourceIP:'192.168.1.2'}),null);
  assert.equal(routeDirection({originCountry:'CN'}).kind,'outbound');assert.equal(routeDirection({originCountry:'US'}).verified,false);assert.match(routeDirection().warning,/不能冒充/);
});
test('P2 工具缺失、权限失败、代理和部分路径都不伪造到达',async()=>{
  const missing=await runTraceroute('8.8.8.8','icmp',{runProcess:async()=>({stdout:'',stderr:'',code:null,error:'spawn ENOENT'})});assert.equal(missing.status,'skipped');
  const partial=await runTraceroute('8.8.8.8','icmp',{runProcess:async()=>({stdout:'1 192.168.1.1 1 ms\n2 * * *',stderr:'',code:0})});assert.equal(partial.status,'limited');assert.equal(partial.reached,false);assert.equal(partial.hops.length,2);
  let invoked=false;const proxy=await runTraceroute('8.8.8.8','icmp',{proxy:'http://localhost:9',runProcess:()=>{invoked=true;}});assert.equal(proxy.status,'skipped');assert.equal(invoked,false);
});
test('Linux 缺少 traceroute 时回退 tracepath，并识别带冒号的跳点',async()=>{
  const calls=[];
  const result=await runTraceroute('8.8.8.8','icmp',{platform:'linux',runProcess:async(command)=>{
    calls.push(command);return calls.length===1?{stdout:'',stderr:'',code:null,error:'spawn ENOENT'}:{stdout:' 1: 1.1.1.1 1.2ms\n 2: 8.8.8.8 2.3ms',stderr:'',code:0};
  }});
  assert.deepEqual(calls,['traceroute','tracepath']);assert.equal(result.backend,'Linux tracepath');assert.equal(result.reached,true);assert.equal(result.hops.length,2);
});
test('P2 节点归属错误会阻止测量，真实成功时间仅由响应写入健康记录',async()=>{
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-route-test-'));
  const fixture={name:'fixture node',isp:'telecom',region:'beijing',ipv4:'fixture.example.org',expected_asns:[4134]};
  const request=async()=>({status:200,body:JSON.stringify({status:'ok',data:{prefix:'8.8.8.0/24',asns:[15169]}})});
  const queryDNS=async()=>({status:'success',answers:[{type:'A',data:'8.8.8.8'}]});
  try{
    const node=await resolveNode(fixture,4,{cacheDir,request,queryDNS});assert.equal(node.health.status,'mismatch');assert.equal(node.health.last_successful_at,null);
    let probes=0;
    const blocked=await measureRoutes([fixture],{family:4,cacheDir,request,queryDNS,routeProtocols:['icmp'],runProcess:async()=>{probes++;return {stdout:'1 8.8.8.8 1 ms',stderr:'',code:0};}});assert.equal(blocked.results[0].reached,true);assert.equal(probes,1);
    const success=await measureRoutes([{name:'user fixture',ip:'8.8.8.8'}],{family:4,cacheDir,request,routeProtocols:['icmp'],runProcess:async()=>({stdout:'1 8.8.8.8 1 ms 2 ms 3 ms\n',stderr:'',code:0})});
    assert.equal(success.results[0].reached,true);assert.ok(success.results[0].health.last_successful_at);assert.deepEqual(success.results[0].hops[0].asn_evidence[0].asns,[15169]);
    await measureRoutes([{name:'user IPv6 fixture',ip:'2606:4700::1111'}],{family:6,cacheDir,request,routeProtocols:['icmp'],runProcess:async()=>({stdout:'1 * * *',stderr:'',code:0})});
    const health=JSON.parse(await fs.readFile(path.join(cacheDir,'route-health.json'),'utf8'));
    assert.ok(health.nodes.find(n=>n.name==='user fixture').last_successful_at);
    assert.equal(health.nodes.find(n=>n.family===6).last_successful_at,null);assert.ok(health.nodes.length>=3);
  }finally{await fs.rm(cacheDir,{recursive:true,force:true});}
});
