'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {parseArgs} = require('../bin/openmili');
const {probePort,diagnosePort} = require('../lib/port');
const {bindSource,addressType} = require('../lib/system');
const {request,runProcess} = require('../lib/transport');
const {saveReport} = require('../lib/report');
const {validateReport} = require('../lib/schema');
const {classify} = require('../lib/core');
const {discoverFamily} = require('../lib/identity');
const listen = server => new Promise(r=>server.listen(0,'127.0.0.1',r));
const close = server => new Promise(r=>server.close(r));
function run(args) {
  return new Promise((resolve,reject) => {
    const child=spawn(process.execPath,[path.join(__dirname,'../bin/openmili.js'),...args],{windowsHide:true});
    let stdout='',stderr=''; child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.on('error',reject);child.on('close',code=>resolve({stdout,stderr,code}));
  });
}
test('P0 子命令严格隔离查询目标与端口/代理语义',()=>{
  assert.equal(parseArgs(['--lookup-ip','8.8.8.8']).command,'lookup');
  assert.equal(parseArgs(['lookup','--ip','2606:4700:4700::1111']).onlyLookup,true);
  const port=parseArgs(['port','--host','example.org','--port','443','--tls']);
  assert.equal(port.targetPort,443);assert.equal(port.proxy,'');
  assert.equal(parseArgs(['--port','443']).proxy,'http://127.0.0.1:443');
  for(const args of [['lookup'],['port','--host','example.org'],['--ipv4','--ipv6'],['--source-ip','invalid'],['port','--host','example.org;whoami','--port','443']]) assert.throws(()=>parseArgs(args));
});
test('P0 本机绑定不静默回退；CGNAT/IPv6 地址分类',()=>{
  const interfaces={lan:[{address:'192.168.1.2'},{address:'2001:4860::1'}]};
  assert.equal(bindSource({family:4,interface:'lan'},interfaces),'192.168.1.2');
  for(const o of [{family:4,interface:'missing'},{family:6,sourceIP:'192.168.1.2'},{family:4,interface:'lan',proxy:'http://localhost'}]) assert.throws(()=>bindSource(o,interfaces));
  assert.equal(addressType('100.64.1.1'),'shared-cgnat');assert.equal(addressType('fd12::1'),'unique-local');assert.equal(addressType('fe80::1'),'link-local');
});
test('P0 TCP 成功/拒绝、TLS 失败与主动取消均来自真实本地 socket',async()=>{
  const server=net.createServer(s=>{s.on('error',()=>{});s.resume();s.end('HTTP/1.1 200 OK\r\n\r\nplain');});
  await listen(server);const port=server.address().port;
  try {
    const ok=await diagnosePort({host:'127.0.0.1',port,samples:3,sourceIP:'127.0.0.1'});
    assert.equal(ok.status,'success');assert.equal(ok.latency.samples,3);assert.equal(ok.checks[0].source_ip,'127.0.0.1');
    const badTLS=await probePort({host:'127.0.0.1',port,tls:true});assert.equal(badTLS.code,'TLS_FAILED');assert.equal(badTLS.tcp_connected,true);
    const controller=new AbortController();controller.abort();
    assert.equal((await probePort({host:'127.0.0.1',port,signal:controller.signal})).code,'ABORTED');
    assert.equal((await probePort({host:'127.0.0.1',port,proxy:'http://localhost:1'})).status,'skipped');
  } finally {await close(server);}
  assert.equal((await probePort({host:'127.0.0.1',port})).code,'CONNECT_REFUSED');
});
test('P0 HTTP 严格绑定、进程取消、回显独立源不足不标稳定',async()=>{
  const server=http.createServer((req,res)=>{if(req.url !== '/hang') res.end('8.8.8.8');});
  await listen(server);const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const r=await request(base,{family:4,sourceIP:'127.0.0.1'});assert.equal(r.bindingVerified,true);
    const controller=new AbortController();
    const pending=request(base+'/hang',{signal:controller.signal});setTimeout(()=>controller.abort(),80);
    assert.equal((await pending).error,'ABORTED');
    const ip=await discoverFamily(4,{endpoints:{4:[base+'/a',base+'/b']}});assert.equal(ip.ip,'8.8.8.8');assert.equal(ip.stable,false);
    const cp=new AbortController();const processPending=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:cp.signal});cp.abort();
    assert.equal((await processPending).error,'ABORTED');
  }finally {server.closeAllConnections();await close(server);}
});
test('P0 报告/内嵌 JSON/快照统一清除 Cookie、凭据和敏感查询参数',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-privacy-'));
  try {
    const fixture={startedAt:new Date().toISOString(),family:4,mode:'lookup',selectedIP:'8.8.8.8',environment:{hostname:'private-host'},sites:[{name:'test',url:'https://example.org/?api_key=DUMMY_QUERY',weight:1,http:{kind:'reachable',headers:{'set-cookie':'session=DUMMY_COOKIE',authorization:'Bearer DUMMY_AUTH'},snippet:'password=DUMMY_PASSWORD',finalUrl:'https://user:DUMMY_PASS@example.org/?token=DUMMY_TOKEN'}}]};
    const safe=await saveReport(fixture,path.join(temp,'run'),{command:'lookup',redact:true,secrets:['DUMMY_SECRET']});
    assert.equal(validateReport(safe),true,JSON.stringify(validateReport.errors));
    for(const file of [path.join(temp,'run/report.json'),path.join(temp,'run/report.html'),path.join(temp,'latest.json')]) {
      const text=await fs.readFile(file,'utf8');assert.doesNotMatch(text,/DUMMY_|8\.8\.8\.8|private-host/);
    }
    const broken=structuredClone(safe);broken.modules.system.status='green';assert.equal(validateReport(broken),false);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('P0 IPv6 lookup 离线 stdout 是单份 schema-valid JSON，无网站/路由实测',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-lookup-'));
  try {
    const r=await run(['lookup','--ip','2606:4700:4700::1111','--offline','--json','--output',path.join(temp,'report.json')]);
    assert.equal(r.code,0,r.stderr);const d=JSON.parse(r.stdout);
    assert.equal(d.mode,'lookup');assert.equal(d.family,6);assert.equal(d.target.family,6);assert.equal(d.target.exit_verified,false);assert.equal(d.target.exit_ip,null);
    assert.equal(d.sites.length,0);assert.equal(d.routes.results.length,0);assert.equal(d.scores.overall,null);assert.equal(validateReport(d),true);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(temp,'report.json'),'utf8')),d);
  } finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('P0 无关跳转和无效最终地址不会算目标可达',()=>{
  assert.equal(classify({status:200,body:'landing',requestUrl:'https://expected.example/',finalUrl:'https://unrelated.example/'}).kind,'untested');
  assert.equal(classify({status:200,body:'home',requestUrl:'https://expected.example/',finalUrl:'https://www.expected.example/'}).kind,'reachable');
});
test('P0 新入口与 YAML 配置覆盖在真实子进程中一致',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-entry-'));
  const root=path.resolve(__dirname,'..');
  try {
    const config=path.join(temp,'config.yaml');await fs.writeFile(config,'plain: true\noffline: true\njson: true\nfamily: 4\n');
    const tokens=['lookup','--ip','2606:4700:4700::1111','--config',config,'--output',temp];
    const entries=[];
    if(process.platform === 'win32') entries.push(['powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'openmili.ps1'),...tokens]]);
    if(process.platform !== 'win32' || process.env.TEST_BASH) {
      const script=process.platform === 'win32' ? path.join(root,'openmili.sh').replace(/\\/g,'/').replace(/^([A-Z]):/i,(_,d)=>`/${d.toLowerCase()}`) : path.join(root,'openmili.sh');
      entries.push([process.env.TEST_BASH || 'sh',[script,...tokens]]);
    }
    for(const [cmd,args] of entries) {
      const result=await runProcess(cmd,args,{timeout:15000});assert.equal(result.code,0,result.stderr);
      const report=JSON.parse(result.stdout);assert.equal(report.mode,'lookup');assert.equal(report.family,6);assert.equal(validateReport(report),true);
    }
    await fs.writeFile(config,'plain: true\nunknown-key: value\n');assert.throws(()=>parseArgs(['--config',config]));
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
