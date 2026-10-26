'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {defaults,validateModel,normalizeScoreInput,calculateScore,scoreReport}=require('../lib/scoring');
const {saveReport}=require('../lib/report');
const {runProcess}=require('../lib/transport');
const {launchBrowser}=require('../lib/browser');
const {wrap,statusLabel}=require('../lib/ui');
const fixture=()=>({startedAt:'2026-10-27T00:00:00.000Z',mode:'local',family:4,sites:[{name:'Fixture only',url:'https://example.org/',weight:1,http:{kind:'reachable',identityVerified:true},browser:{kind:'challenge',identityVerified:true}}],database:{records:[],reputation:{tested:true,risk:.2,coverage:.5}},dns:{checks:[{status:'success'},{status:'limited'},{status:'unknown'}]},routes:{results:[{reached:true,hops:[{ip:'8.8.8.8'}]},{reached:false,hops:[{ip:'1.1.1.1'}]},{reached:false,hops:[{ip:null}]}]},exit:{v4:{ip:'8.8.8.8',stable:true},v6:{stable:false}}});
test('P3 五维归一化、未知覆盖、方法不重复投票和类型不计分',()=>{
  const r=fixture(),s=scoreReport(r);
  assert.equal(s.model,'scoring-v1.0.0');assert.equal(s.coverage,68.3);assert.equal(s.earned,39.5);assert.equal(s.reference,57.8);assert.equal(s.grade_code,'fair');
  assert.equal(s.components.find(x=>x.name==='websites').reference,20);
  r.database.attribute={type:'RESIDENTIAL',confidence:100};assert.deepEqual(scoreReport(r),s);
  r.sites[0].browser.identityVerified=false;assert.equal(scoreReport(r).components.find(x=>x.name==='websites').reference,100);
  assert.equal(scoreReport({sites:[{weight:1,http:{kind:'reachable',identityVerified:true}}]}).overall,null);
  r.mode='lookup';assert.equal(scoreReport(r).reference,null);assert.equal(scoreReport(r).coverage,0);
  assert.throws(()=>validateModel({...defaults,weights:{...defaults.weights,dns:16}}));
  assert.throws(()=>validateModel({...defaults,website_factors:{reachable:2}}));
});
test('P3 报告快照离线评分重放一致，自定义权重校验与完整输入',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-score-'));
  try{
    const report=await saveReport(fixture(),path.join(temp,'run'),{command:'all'});
    const replay=await runProcess(process.execPath,['bin/openmili.js','score','--input',path.join(temp,'run/report.json'),'--json']);
    assert.equal(replay.code,0,replay.stderr);assert.deepEqual(JSON.parse(replay.stdout),report.score);
    assert.deepEqual(calculateScore(report.score_input,report.score_model),report.score);
    const model=validateModel({...defaults,weights:{reputation:0,websites:100,routes:0,dns:0,network:0}});
    assert.equal(scoreReport(fixture(),model).reference,20);
    assert.equal(normalizeScoreInput({mode:'port'}).eligible,false);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('P3 聚合状态不会把已执行但全未知的站点标为成功，文本导出统一脱敏',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-export-'));
  try{
    const r=fixture();r.sites[0].http.kind='untested';r.sites[0].browser.kind='untested';r.sites[0].name='secret=DUMMY_PASSWORD';
    const safe=await saveReport(r,path.join(temp,'run'),{redact:true,command:'websites'});
    assert.equal(safe.modules.websites.status,'unknown');
    for(const ext of ['md','txt','ansi','html','json'])assert.doesNotMatch(await fs.readFile(path.join(temp,'run','report.'+ext),'utf8'),/DUMMY_PASSWORD|8\.8\.8\.8/);
    assert.doesNotMatch(statusLabel('success',{plain:true}),/\x1b/);
    for(const line of wrap('中文窄屏状态 abc '.repeat(20),24).split('\n'))assert.ok([...line].reduce((n,ch)=>n+(/[\u2e80-\uffff]/u.test(ch)?2:1),0)<=24);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('P3 HTML 单文件离线主题/图表/逐跳/嵌图实际 Chromium 检查',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-html-'));let browser;
  try{
    try{browser=await launchBrowser({installBrowser:false},()=>{});}catch(error){if(process.env.REQUIRE_BROWSER_TESTS)throw error;t.skip('没有本机浏览器');return;}
    const dir=path.join(temp,'run');await fs.mkdir(path.join(dir,'evidence'),{recursive:true});
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=';
    await fs.writeFile(path.join(dir,'evidence/test.png'),Buffer.from(png,'base64'));
    const r=fixture();r.sites[0].browser.screenshot='evidence/test.png';await saveReport(r,dir,{command:'all'});
    const context=await browser.newContext();await context.setOffline(true);const page=await context.newPage();
    await page.goto(pathToFileURL(path.join(dir,'report.html')).href);
    assert.equal(await page.locator('progress').count(),5);assert.equal(await page.locator('img').count(),1);
    const background=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);await page.locator('#light').check();
    assert.notEqual(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),background);
    assert.ok(await page.getByText('逐跳 IP / RTT / ASN / 协议',{exact:true}).count());
    await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('main').evaluate(el=>el.getBoundingClientRect().width<=390));
    assert.match(await fs.readFile(path.join(dir,'report.html'),'utf8'),/data:image\/png;base64,/);
    await context.close();
  }finally{if(browser)await browser.close();await fs.rm(temp,{recursive:true,force:true});}
});
test('P3 主流程取消真实未完成 HTTP 后保存部分报告和退出码 130',async()=>{
  const http=require('node:http'),controller=new AbortController();
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-abort-'));
  const server=http.createServer(()=>controller.abort());await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const originalLog=console.log,originalExit=process.exitCode;console.log=()=>{};
  try{
    const targets=path.join(temp,'targets.yaml');await fs.writeFile(targets,`domains:\n  - name: cancellation fixture\n    url: http://127.0.0.1:${server.address().port}/\n`);
    const result=await require('../bin/openmili').main(['websites','--mode','http','--urls',targets,'--skip-ip','--no-browser','--json','--output',temp],{signal:controller.signal});
    assert.equal(process.exitCode,130);assert.ok(result.errors.some(e=>e.code==='ABORTED'));assert.equal(result.score.coverage,0);
    assert.equal(result.sites[0].http.kind,'untested');assert.ok(JSON.parse(await fs.readFile(path.join(temp,'latest.json'),'utf8')).errors.length);
  }finally{console.log=originalLog;process.exitCode=originalExit;server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true});}
});
