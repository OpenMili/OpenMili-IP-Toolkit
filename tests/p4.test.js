'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {gzipSync}=require('node:zlib');
const {agentCommand,runAgent}=require('../lib/agent');
const {finalizeReport}=require('../lib/schema');
const {checkArchive,metadata,uninstall}=require('../lib/installation');
const {parseArgs}=require('../bin/openmili');
test('P4 Agent 拒绝注入/任意远端命令，严格SSH验证，不回退本机',async()=>{
  const options={ssh:'user@vps.example',remotePath:'/home/user/openmili-ip',task:'ip'};
  const cmd=agentCommand(options);assert.ok(cmd.args.includes('StrictHostKeyChecking=yes'));assert.ok(cmd.args.at(-1).includes("'--json'"));
  for(const ssh of ['-oProxyCommand=whoami','user@host;touch /tmp/x','user@host\nwhoami'])assert.throws(()=>agentCommand({...options,ssh}));
  assert.throws(()=>agentCommand({...options,remotePath:'/tmp/../bin/sh'}));assert.throws(()=>agentCommand({...options,task:'sh -c id'}));
  const remote=finalizeReport({startedAt:new Date().toISOString(),environment:{hostname:'REMOTE_FIXTURE'},sites:[],family:4,selectedIP:'8.8.8.8',exit:{v4:{ip:'8.8.8.8',stable:true}}},{command:'ip'});
  const result=await runAgent({...options,runProcess:async()=>({code:0,stdout:JSON.stringify(remote),stderr:''})});
  assert.equal(result.mode,'agent');assert.equal(result.environment.hostname,'REMOTE_FIXTURE');assert.equal(result.selectedIP,'8.8.8.8');
  await assert.rejects(()=>runAgent({...options,runProcess:async()=>({code:255,stdout:'',stderr:'host key failure'})}),/未回退本机/);
  await assert.rejects(()=>runAgent({...options,runProcess:async()=>({code:0,stdout:'banner\n{}',stderr:''})}),/JSON/);
});
test('P4 默认核心不启浏览器，浏览器出口必须两源同族一致',async t=>{
  assert.equal(parseArgs(['all']).browser,false);assert.equal(parseArgs(['all','--browser']).browser,true);assert.equal(parseArgs(['websites','--mode','browser']).browser,true);
  let browser;const server=http.createServer((req,res)=>res.end(req.url==='/v6'?'2606:4700::1111':'8.8.8.8'));await new Promise(r=>server.listen(0,r));
  const {launchBrowser,browserIdentity}=require('../lib/browser'),port=server.address().port;
  try{
    try{browser=await launchBrowser({installBrowser:false},()=>{});}catch(error){if(process.env.REQUIRE_BROWSER_TESTS)throw error;t.skip('没有本机浏览器');return;}
    const same=[`http://127.0.0.1:${port}/a`,`http://127.0.0.1:${port}/b`];
    assert.equal((await browserIdentity(browser,4,{endpoints:same})).stable,false);
    const dual=[same[0],`http://localhost:${port}/a`];assert.equal((await browserIdentity(browser,4,{endpoints:dual})).stable,true);
    assert.equal((await browserIdentity(browser,6,{endpoints:dual})).stable,false);
    assert.equal((await browserIdentity(browser,4,{endpoints:[same[0],`http://localhost:${port}/v6`]})).stable,false);
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('P4 校验不符/路径越界拒绝，源码卸载与非自有目录不删除',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-safety-'));
  try{
    const file=path.join(temp,'bad.tar.gz'),header=Buffer.alloc(512);header.write('../../escape');header.write('0000644\0',100);header.write('0000000\0',108);header.write('0000000\0',116);header.write('00000000001\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write('00',263);const sum=header.reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    const buffer=gzipSync(Buffer.concat([header,Buffer.from('x'),Buffer.alloc(511+1024)]));await fs.writeFile(file,buffer);
    const sha=crypto.createHash('sha256').update(buffer).digest('hex');await assert.rejects(()=>checkArchive(file,sha),/越界/);await assert.rejects(()=>checkArchive(file,'f'.repeat(64)),/SHA-256/);
    await fs.writeFile(path.join(temp,'user-file'),'keep');await assert.rejects(()=>metadata(temp),/非空/);
    assert.equal((await uninstall()).status,'skipped');assert.equal(await fs.readFile(path.join(temp,'user-file'),'utf8'),'keep');
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
