'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { request } = require('../lib/transport');
const { classify } = require('../lib/core');
const { launchBrowser, probePage, browserIdentity } = require('../lib/browser');
const { IP_ENDPOINTS } = require('../lib/identity');
const root = path.resolve(__dirname,'..');

function run(command, args, env = process.env) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{cwd:root,windowsHide:true,env});
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout='',stderr='';
    const timer = setTimeout(() => child.kill(),30000);
    child.stdout.on('data',d => stdout+=d); child.stderr.on('data',d => stderr+=d);
    child.on('error',reject); child.on('close',code => { clearTimeout(timer); resolve({code,stdout,stderr}); });
  });
}

test('本地 HTTP、显式代理、Chromium 渲染和跨平台入口集成', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'openmili-test-'));
  const server = http.createServer((req,res) => {
    if(req.url === '/reset') return req.socket.destroy();
    if(req.url === '/ip') return res.end('8.8.8.8');
    if(req.url === '/redirect') { res.writeHead(302,{'location':'/ok','cf-mitigated':'challenge'}); return res.end(); }
    if(req.url === '/challenge') { res.writeHead(200); return res.end('<title>Just a moment...</title>Verifying'); }
    if(req.url === '/captcha') { res.writeHead(403); return res.end('<h1>Verify you are human</h1>'); }
    if(req.url === '/forbidden') { res.writeHead(403); return res.end('Forbidden'); }
    if(req.url === '/error') { res.writeHead(503); return res.end('Service unavailable'); }
    if(req.url === '/empty') { res.writeHead(200); return res.end(); }
    if(req.url === '/js') return res.end('<title>Loading</title><body><main id="app">Enable JavaScript</main><script>document.title="App ready";document.getElementById("app").innerText="Loaded content"</script>');
    if(req.url === '/plain') return res.end('<title>Home</title><body>Welcome<script src="/recaptcha/api.js"></script></body>');
    res.end('<title>OK</title><body>ok</body>');
  });
  let proxyHits=0;
  const proxy = http.createServer((req,res) => { proxyHits++; res.end('<title>Proxy route</title>Proxied'); });
  await Promise.all([new Promise(r => server.listen(0,'127.0.0.1',r)),new Promise(r => proxy.listen(0,'127.0.0.1',r))]);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await t.test('HTTP 最终响应与超大响应保护', async () => {
      const r=await request(`${base}/redirect`);
      assert.equal(r.finalUrl,`${base}/ok`); assert.equal(classify(r).kind,'reachable');
      const large=await request(`${base}/ok`,{maxBytes:3});
      assert.ok(large.error); assert.notEqual(classify(large).kind,'reachable');
    });
    await t.test('NO_PROXY=* 仍不能绕过用户指定的代理',async () => {
      const old=process.env.NO_PROXY; process.env.NO_PROXY='*';
      try {
        const r=await request(`${base}/ok`,{proxy:`http://127.0.0.1:${proxy.address().port}`});
        assert.match(r.body,/Proxied/); assert.equal(proxyHits,1);
      } finally { if(old===undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY=old; }
    });
    let browser;
    t.after(async () => { if(browser) await browser.close(); });
    await t.test('真实浏览器验证 JavaScript 渲染和可见验证码',async t => {
      try { browser=await launchBrowser({installBrowser:false},()=>{}); }
      catch (error) { if(process.env.REQUIRE_BROWSER_TESTS) throw error; t.skip('系统没有浏览器；浏览器 CI 单独安装'); return; }
      const js=await probePage(browser,{url:`${base}/js`},{browserWait:20});
      assert.equal(js.kind,'reachable'); assert.equal(js.title,'App ready'); assert.match(js.snippet,/Loaded content/);
      assert.equal(js.connectionFamily,4); assert.equal(js.remoteIP,'127.0.0.1');
      assert.equal((await probePage(browser,{url:`${base}/captcha`},{browserWait:20})).kind,'captcha');
      assert.equal((await probePage(browser,{url:`${base}/plain`},{browserWait:20})).kind,'reachable');
      assert.equal((await probePage(browser,{url:`${base}/challenge`},{browserWait:20})).kind,'challenge');
      const original=IP_ENDPOINTS[4];
      IP_ENDPOINTS[4]=[`${base}/reset`,`${base}/ip`];
      try {
        const identity=await browserIdentity(browser,4);
        assert.equal(identity.status,'ok'); assert.equal(identity.ip,'8.8.8.8'); assert.equal(identity.source,`${base}/ip`);
        assert.equal(identity.observations.length,1);
      } finally { IP_ENDPOINTS[4]=original; }
      await browser.close(); browser=null;
    });
    const targets = path.join(temp,'targets.yaml');
    await fs.writeFile(targets,'domains:\n  - name: 短响应\n    url: '+base+'/ok\n  - name: 访问受限\n    url: '+base+'/forbidden\n  - name: 服务异常\n    url: '+base+'/error\n  - name: 响应为空\n    url: '+base+'/empty\n');
    const common=['--mode','direct','--urls',targets,'--skip-ip','--no-pause','--no-browser','--no-routes','--no-history','--no-lookup','--min-delay','0','--max-delay','0','--output',path.join(temp,'reports')];
    const entries=[['Node',process.execPath,[path.join(root,'bin/openmili.js'),...common]]];
    if(process.platform==='win32') entries.push(['PowerShell','powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'run.ps1'),'-Mode','direct','-Urls',targets,'-SkipIP','-NoPause','-NoBrowser','-NoRoutes','-NoHistory','-NoLookup','-MinDelayMs','0','-MaxDelayMs','0','-Output',path.join(temp,'reports')]]);
    if(process.platform!=='win32' || process.env.TEST_BASH) {
      // Git Bash expects POSIX form for the script argument, but Node accepts the Windows target path.
      const script = process.platform==='win32' ? path.join(root,'run.sh').replace(/\\/g,'/').replace(/^([A-Z]):/i,(_,d)=>`/${d.toLowerCase()}`) : path.join(root,'run.sh');
      entries.push(['Bash',process.env.TEST_BASH || 'bash',[script,...common]]);
    }
    for(const [name,command,args] of entries) await t.test(`${name} 入口、缺失证据评分与 HTML/JSON`,async () => {
      const r=await run(command,args); assert.equal(r.code,0,r.stdout+r.stderr);
      assert.match(r.stdout,/短响应: 服务可达 200/); assert.match(r.stdout,/访问受限: 访问受限 403/); assert.match(r.stdout,/服务异常: 服务异常 503/); assert.match(r.stdout,/响应为空: 响应为空 200/); assert.match(r.stdout,/服务可达 1\/4/);
      const report=JSON.parse(await fs.readFile(path.join(temp,'reports','latest.json'),'utf8'));
      assert.equal(report.sites.length,4); assert.equal(report.score.coverage,0); assert.equal(report.score.grade,'证据不足');
      assert.ok(report.sites.every(s => s.browser.kind==='untested'));
    });
  } finally {
    await Promise.all([new Promise(r => server.close(r)),new Promise(r => proxy.close(r))]);
    await fs.rm(temp,{recursive:true,force:true});
  }
});
