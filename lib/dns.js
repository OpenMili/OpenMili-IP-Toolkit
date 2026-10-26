'use strict';
const dgram=require('node:dgram');
const net=require('node:net');
const tls=require('node:tls');
const dns=require('node:dns');
const crypto=require('node:crypto');
const packet=require('dns-packet');
const {state}=require('./status');
const {validHost}=require('./port');
const {request,mapLimit,runProcess}=require('./transport');
const {reverseIP}=require('./ip-network');
const TYPES={1:'A',28:'AAAA',5:'CNAME',15:'MX',16:'TXT',12:'PTR'};
function resolverAddress(value) {
  if(net.isIP(value)) return {host:value,port:53};
  const m=String(value).match(/^\[([^\]]+)\]:(\d+)$|^([\d.]+):(\d+)$/);
  if(!m || !net.isIP(m[1]||m[3]) || +(m[2]||m[4])<1 || +(m[2]||m[4])>65535) throw new Error('DNS resolver 必须为 IP 或 [IPv6]:端口 / IPv4:端口');
  return {host:m[1]||m[3],port:+(m[2]||m[4])};
}
function queryWire(name,type,{id=crypto.randomInt(65536)}={}) {
  validHost(name);
  if(!Object.values(TYPES).includes(type)) throw new Error('Unsupported DNS record type');
  return packet.encode({type:'query',id,flags:packet.RECURSION_DESIRED,questions:[{type,name}],additionals:[{type:'OPT',name:'.',udpPayloadSize:1232,flags:packet.DNSSEC_OK,options:[]}]});
}
function responseResult(data,meta) {
  const answers=(data.answers||[]).map(a=>({name:a.name,type:a.type,ttl:a.ttl,data:Array.isArray(a.data)?a.data.map(x=>Buffer.isBuffer(x)?x.toString('utf8'):x):a.data}));
  const rcode=data.rcode || 'NOERROR';
  return state(rcode==='NOERROR'?'success':'limited',`DNS_${rcode}`,rcode==='NOERROR'?'收到 DNS 响应':`解析器返回 ${rcode}`,{
    ...meta,rcode,answers,truncated:Boolean(data.flag_tc),resolver_reports_ad:Boolean(data.flag_ad),
    dnssec:'未做本地密码学验证；AD 仅代表所查询解析器的声明'
  });
}
async function wireQuery(name,type,options={}) {
  const protocol=options.protocol||'udp',server=resolverAddress(options.server||dns.getServers()[0]||'1.1.1.1');
  if(!['udp','tcp','dot'].includes(protocol))throw new Error('Unsupported DNS transport');
  const timeout=options.timeout||3000,start=performance.now(),wire=queryWire(name,type),expected=packet.decode(wire);
  const meta={name,type,protocol,resolver:server.host,port:protocol==='dot'?(options.port||853):(options.port||server.port),source:options.source||'configured-resolver'};
  if(options.offline || options.signal?.aborted) return state('skipped',options.offline?'OFFLINE':'ABORTED','未进行网络查询',meta);
  if(options.proxy) return state('skipped','PROXY_DNS_UNSUPPORTED','UDP/TCP/DoT 不绕过指定代理，请选 DoH',meta);
  if(options.sourceIP && net.isIP(options.sourceIP)!==net.isIP(server.host)) return state('skipped','DNS_SOURCE_FAMILY_MISMATCH','解析器与绑定来源协议族不同',meta);
  return new Promise(resolve=>{
    let socket,done=false,buffer=Buffer.alloc(0);
    const finish=result=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(protocol==='udp'){try{socket?.close();}catch{}}else socket?.destroy();resolve({...meta,...result,latency_ms:Math.round((performance.now()-start)*100)/100});};
    const abort=()=>finish(state('skipped','ABORTED','用户中止'));
    const timer=setTimeout(()=>finish(state('unknown','DNS_TIMEOUT','DNS 查询超时，原因未确定')),timeout);
    const accept=body=>{
      try{const p=packet.decode(body);if(p.id!==expected.id || p.type!=='response' || p.questions?.[0]?.name.toLowerCase().replace(/\.$/,'')!==name.toLowerCase().replace(/\.$/,'') || p.questions[0].type!==type)return;
        finish(responseResult(p,meta));
      }catch(error){finish(state('unknown','DNS_INVALID_RESPONSE',error.message));}
    };
    options.signal?.addEventListener('abort',abort,{once:true});
    try{
      if(protocol==='udp'){
        socket=dgram.createSocket(net.isIP(server.host)===6?'udp6':'udp4');socket.on('message',accept);
        const connect=()=>socket.connect(meta.port,server.host,()=>socket.send(wire,error=>{if(error)finish(state('unknown','DNS_SEND_FAILED',error.message));}));
        if(options.sourceIP)socket.bind({address:options.sourceIP,port:0},connect);else connect();
      }else{
        const connect={host:server.host,port:meta.port,...(options.sourceIP?{localAddress:options.sourceIP}:{})};
        socket=protocol==='dot'?tls.connect({...connect,servername:options.servername||undefined,rejectUnauthorized:true,...(options.ca?{ca:options.ca}:{})}):net.connect(connect);
        const send=()=>{const size=Buffer.alloc(2);size.writeUInt16BE(wire.length);socket.write(Buffer.concat([size,wire]));};
        socket.once(protocol==='dot'?'secureConnect':'connect',send);
        socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>65537){finish(state('unknown','DNS_OVERSIZE','DNS 响应超过上限'));return;}if(buffer.length>=2 && buffer.length>=buffer.readUInt16BE(0)+2)accept(buffer.subarray(2,buffer.readUInt16BE(0)+2));});
        socket.once('end',()=>{if(!done)finish(state('unknown','DNS_INCOMPLETE','DNS 流未返回完整且匹配的响应'));});
      }
      socket.on('error',error=>finish(state('unknown',protocol==='dot'?'DNS_TLS_FAILED':'DNS_TRANSPORT_FAILED',error.message,{native_code:error.code})));
    }catch(error){finish(state('unknown','DNS_TRANSPORT_FAILED',error.message));}
  });
}
async function dohQuery(name,type,options={}) {
  validHost(name);if(!Object.values(TYPES).includes(type)) throw new Error('Unsupported DNS record type');
  const endpoint=new URL(options.dohURL||'https://dns.google/resolve');
  if(endpoint.protocol!=='https:') throw new Error('DoH endpoint 必须使用 HTTPS');
  endpoint.searchParams.set('name',name);endpoint.searchParams.set('type',type);endpoint.searchParams.set('do','true');
  const meta={name,type,protocol:'doh',resolver:endpoint.origin,through_proxy:Boolean(options.proxy)};
  if(options.offline || options.signal?.aborted)return state('skipped',options.offline?'OFFLINE':'ABORTED','未进行网络查询',meta);
  try{
    const r=await (options.request||request)(endpoint.href,{...options,headers:['Accept: application/dns-json'],maxBytes:128*1024});
    if(r.error || r.status!==200)throw new Error(r.error||`HTTP ${r.status}`);
    const d=JSON.parse(r.body);if(!Number.isInteger(d.Status) || !Array.isArray(d.Question) || d.Question[0]?.name?.toLowerCase().replace(/\.$/,'')!==name.toLowerCase().replace(/\.$/,'') || TYPES[d.Question[0].type]!==type)throw new Error('DoH 响应问题不匹配');
    const rcodes=['NOERROR','FORMERR','SERVFAIL','NXDOMAIN','NOTIMP','REFUSED'];
    return responseResult({rcode:rcodes[d.Status]||`RCODE_${d.Status}`,flag_ad:d.AD,flag_tc:d.TC,answers:(d.Answer||[]).map(a=>({name:a.name,type:TYPES[a.type]||String(a.type),ttl:a.TTL,data:a.data}))},{...meta,latency_ms:r.duration});
  }catch(error){return state('unknown','DOH_FAILED',error.message,meta);}
}
function compareAnswers(checks) {
  const differences=[];
  for(const type of ['A','AAAA','CNAME','MX','TXT']) {
    const available=checks.filter(x=>x.type===type && x.status==='success');
    const values=new Set(available.map(x=>JSON.stringify(x.answers.map(a=>JSON.stringify(a.data)).sort())));
    if(values.size>1)differences.push({type,reason:'解析结果存在差异，CDN/分流/策略都可能造成；不能据此证明污染'});
  }
  return differences;
}
async function systemLookup(host,options={}) {
  const meta={protocol:'system-getaddrinfo',name:host,source:'OS resolver (hosts/NSS/DNS policy)'};
  if(options.offline||options.proxy||options.sourceIP||options.signal?.aborted)return state('skipped','SYSTEM_RESOLVER_SKIPPED','离线、代理或来源绑定时不会静默使用本机系统解析路径',meta);
  const start=performance.now();
  const code="require('node:dns').lookup(process.argv[1],{all:true,verbatim:true},(error,addresses)=>{console.log(JSON.stringify(error?{error:error.message,code:error.code}:{addresses}));})";
  const r=await runProcess(process.execPath,['-e',code,host],{timeout:options.timeout||3000,signal:options.signal,maxOutput:32768});
  if(r.error||r.code!==0)return state('unknown','SYSTEM_DNS_FAILED',r.error||r.stderr,meta);
  try{const data=JSON.parse(r.stdout);return state(data.error?'unknown':'success',data.error?'SYSTEM_DNS_FAILED':'SYSTEM_DNS_RESOLVED',data.error||'系统解析器返回 A/AAAA 地址',{...meta,...data,latency_ms:Math.round(performance.now()-start)});}catch{return state('unknown','SYSTEM_DNS_INVALID','系统解析子进程未返回有效 JSON',meta);}
}
async function inspectDNS(options={}) {
  const host=options.dnsHost||'example.org';validHost(host);
  const defaults=options.family===6?['2606:4700:4700::1111','2001:4860:4860::8888']:['1.1.1.1','8.8.8.8'];
  const servers=options.resolver?[options.resolver]:[...new Set([...dns.getServers().slice(0,1),...defaults])];
  const protocols=options.dnsProtocols||['udp','tcp','doh'];
  const jobs=[];
  for(const protocol of protocols)for(const type of ['A','AAAA','CNAME','MX','TXT']) {
    if(protocol==='doh')jobs.push(()=>dohQuery(host,type,options));
    else for(const server of servers)jobs.push(()=>wireQuery(host,type,{...options,server,protocol,servername:options.dotServername}));
  }
  if(options.publicIP)jobs.push(()=>options.proxy?dohQuery(reverseIP(options.publicIP),'PTR',options):wireQuery(reverseIP(options.publicIP),'PTR',{...options,server:servers[0],protocol:'udp'}));
  const checks=await mapLimit(jobs,options.concurrency||3,job=>job());
  const forwardReverse=[];
  for(const ptr of checks.filter(c=>c.type==='PTR'&&c.status==='success').flatMap(c=>c.answers).filter(a=>a.type==='PTR').slice(0,2)) {
    try{
      const type=net.isIP(options.publicIP)===6?'AAAA':'A';
      const forward=options.proxy?await dohQuery(ptr.data,type,options):await wireQuery(ptr.data,type,{...options,server:servers[0],protocol:'udp'});
      const matches=forward.answers?.some(a=>a.type===type&&net.isIP(a.data)&&require('./core').sameIP(a.data,options.publicIP));
      forwardReverse.push(state(forward.status!=='success'?'unknown':matches?'success':'limited','FCRDNS',matches?'PTR 名称正向解析回受测 IP':'未证明 PTR 名称正向解析回受测 IP',{hostname:ptr.data,forward}));
    }catch(error){forwardReverse.push(state('unknown','FCRDNS_INVALID',error.message));}
  }
  const system=options.systemResolver===false?state('skipped','SYSTEM_RESOLVER_SKIPPED','本次未执行系统解析器'):await systemLookup(host,options);
  const successes=checks.filter(x=>x.status==='success').length;
  return state(successes?'success':checks.every(x=>x.status==='skipped')?'skipped':'unknown','DNS_INSPECTED',successes?'完成实际 DNS 查询':'没有取得可核验 DNS 响应',{
    host,system_servers:dns.getServers(),system,checks,forward_reverse:forwardReverse,differences:compareAnswers(checks),
    leak:state('skipped','CONTROLLED_DOMAIN_REQUIRED','未配置受控域名与关联递归查询日志；不宣称 DNS 泄漏'),
    dns64_nat64:'未执行专用前缀核验；AAAA 存在不能证明或排除 NAT64',
    note:'普通 DNS 是从本机到指定解析器；DoH 可经过显式代理。记录不同不等于污染，NXDOMAIN 不等于网络断开。'
  });
}
module.exports={resolverAddress,queryWire,responseResult,wireQuery,dohQuery,compareAnswers,systemLookup,inspectDNS};
