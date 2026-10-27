'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {curl, detectExit, normalizeProxy, fullArgs, prepareCore, runFullCheck} = require('../simple-ip-check');
const {runProcess} = require('../lib/transport');

test('简易脚本分别强制 curl -4/-6，代理不得被 NO_PROXY 绕过，不混用协议族', () => {
  for (const family of [4, 6]) {
    for (const proxy of ['', 'http://127.0.0.1:7890']) {
      let actual;
      curl('https://example.org/', proxy, family, (_command, args) => {
        actual = args; return {status: 0, stdout: 'body\n__STATUS__200\n__URL__https://example.org/'};
      });
      assert.ok(actual.includes(`-${family}`));
      assert.equal(actual[actual.indexOf('--proxy') + 1], proxy);
      assert.equal(actual[actual.indexOf('--noproxy') + 1], proxy ? '' : '*');
    }
  }
  const requests = [];
  const v6 = detectExit(6, '', (url, proxy, family) => {
    requests.push({url, proxy, family});
    return {status: 200, body: requests.length === 1 ? '8.8.8.8' : '2606:4700:4700::1111'};
  });
  assert.equal(v6.ip, '2606:4700:4700::1111');assert.equal(requests.length, 2);assert.ok(requests.every(r => r.family === 6));
  assert.equal(requests[0].url, 'https://api6.ipify.org');
  let v4url;
  const v4 = detectExit(4, 'http://127.0.0.1:10808', url => {
    v4url = url;return {status: 200, body: new URL(url).hostname === 'api4.ipify.org' ? '8.8.8.8' : '2606:4700:4700::1111'};
  });
  assert.equal(v4.ip, '8.8.8.8');assert.equal(v4url, 'https://api4.ipify.org');
  const failed = detectExit(6, '', () => ({status: 0, body: '', error: 'IPv6 connection failed'}));
  assert.equal(failed.ip, null);assert.equal(failed.status, 'unknown');assert.match(failed.reason, /IPv6/);
  for (const ip of ['192.168.1.1', '127.0.0.1', '10.0.0.1', '169.254.1.1', 'fe80::1', '::1', 'fd00::1']) {
    const family = ip.includes(':') ? 6 : 4;
    assert.equal(detectExit(family, '', () => ({status: 200, body: ip})).ip, null, `Do not accept gateway/local address ${ip}`);
  }
  assert.equal(normalizeProxy('7890'), 'http://127.0.0.1:7890');assert.equal(normalizeProxy('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
  assert.throws(() => normalizeProxy('65536'));
});

test('两项菜单默认启用完整内核，离线真实运行生成全部报告且未知不冒充成功', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openmili-simple-report-'));
  try {
    const {parseArgs} = require('../bin/openmili');
    for (const proxy of ['', 'http://127.0.0.1:10808']) {
      const options = parseArgs(fullArgs(proxy, temp));
      for (const flag of ['routes', 'history', 'lookup', 'communitySources', 'ignoreEnvProxy', 'noPause','terminalOnly','noInstall']) assert.equal(options[flag], true, flag);
      assert.equal(options.browser,false);assert.equal(options.installBrowser,false);
      assert.equal(parseArgs(fullArgs(proxy,temp,['--browser'])).browser,false);
      assert.equal(options.mode, proxy ? 'proxy' : 'direct');assert.equal(options.proxy, proxy);
    }
    const result = await runFullCheck('http://127.0.0.1:10808', temp, ['--offline', '--plain','--save-report']);
    assert.equal(result.sites.length, 38);assert.equal(result.command, 'all');assert.equal(result.mode, 'proxy');
    assert.equal(new URL(result.proxy).port, '10808');assert.equal(result.score.coverage, 0);assert.equal(result.score.overall, null);
    assert.ok(result.dns);assert.ok(result.history);assert.ok(result.routes);assert.equal(result.browser.reason, '用户跳过');
    assert.equal(result.modules.reputation.status,'unknown');assert.match(result.modules.reputation.reason,/没有有效公网出口/);
    assert.ok(result.sites.every(site => site.http.kind === 'untested' && site.httpPlain.kind === 'untested' && site.browser.kind === 'untested'));
    const reports = (await fs.readdir(temp)).filter(name => name !== 'latest.json');assert.equal(reports.length, 1);
    const directory = path.join(temp, reports[0]);
    for (const ext of ['txt','json','html','md','ansi']) assert.ok((await fs.stat(path.join(directory, `report.${ext}`))).size > 0);
    const text = await fs.readFile(path.join(directory, 'report.txt'), 'utf8');
    assert.equal(text.charCodeAt(0), 0xFEFF);assert.match(text, /公开库风险/);assert.match(text, /IP 历史/);assert.match(text, /浏览器标头/);assert.doesNotMatch(text,/真实浏览器/);assert.match(text, /证据覆盖 0%/);
  } finally { await fs.rm(temp, {recursive: true, force: true}); }
});

test('简单入口默认终端展示全部结果，不创建报告目录或截图',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-terminal-only-'));
  try{
    const output=path.join(temp,'must-not-exist');
    const report=await runFullCheck('http://127.0.0.1:10808',output,['--offline','--plain']);
    assert.equal(report.sites.length,38);assert.equal(report.score.coverage,0);
    assert.equal(require('../lib/schema').validateReport(report),true);
    await assert.rejects(fs.stat(output),{code:'ENOENT'});
    assert.deepEqual(await fs.readdir(temp),[]);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('简单入口实际发送普通与模拟标头两次 curl 请求，不执行页面 JavaScript',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-header-check-')),received=[];
  const server=http.createServer((req,res)=>{
    received.push({url:req.url,headers:req.headers});
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(req.url==='/js'?'<title>Loading</title><main>Enable JavaScript</main><script>fetch("/executed")</script>':'<title>Header fixture</title><main>Welcome</main>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`,targets=path.join(temp,'targets.yaml');
    await fs.writeFile(targets,`domains:\n  - name: Headers\n    url: ${base}/headers\n  - name: JavaScript\n    url: ${base}/js\n`);
    const report=await runFullCheck('',path.join(temp,'unused'),['--urls',targets,'--skip-ip','--no-lookup','--no-dns','--no-routes','--no-history','--plain','--min-delay','0','--max-delay','0']);
    assert.equal(received.length,4);assert.deepEqual(received.map(r=>r.url),['/headers','/headers','/js','/js']);
    for(let i=0;i<received.length;i+=2){
      const plain=received[i].headers,browser=received[i+1].headers;
      assert.match(plain['user-agent'],/^curl\//);assert.equal(plain['sec-fetch-mode'],undefined);
      assert.match(browser['user-agent'],/Mozilla\/5\.0.*Chrome\//);assert.match(browser.accept,/text\/html,application\/xhtml\+xml/);
      assert.match(browser['accept-language'],/en-US/);assert.equal(browser['upgrade-insecure-requests'],'1');
      assert.equal(browser['sec-fetch-mode'],'navigate');assert.equal(browser['sec-fetch-dest'],'document');
    }
    assert.equal(report.sites[0].http.kind,'reachable');assert.equal(report.sites[1].http.kind,'js-required');
    assert.ok(report.sites.every(site=>site.browser.kind==='untested'));assert.equal(report.browser.status,'untested');
    await assert.rejects(fs.stat(path.join(temp,'unused')),{code:'ENOENT'});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});

test('远程单文件入口实际解包临时核心，禁用安装脚本并在完成或异常时清理', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openmili-bootstrap-test-'));
  try {
    const fixture = path.join(temp, 'fixture');await fs.mkdir(path.join(fixture, 'bin'), {recursive:true});
    await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({name:'openmili-ip-toolkit',version:'0.0.0',scripts:{postinstall:"node -e \"require('fs').writeFileSync('BAD_SCRIPT','ran')\""}}));
    await fs.writeFile(path.join(fixture, 'bin/openmili.js'), `exports.main = async args => {
      const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
      fs.writeFileSync(args[args.indexOf('--output')+1],root);
      if(fs.existsSync(path.join(root,'BAD_SCRIPT')))throw Error('install script ran');
      if(args.includes('--fixture-fail'))throw Error('fixture failure');
      return {args,root};
    };`);
    const npm = require('../lib/npm-runtime').npmCommand(['pack', fixture, '--ignore-scripts', '--json', '--pack-destination', temp]);
    const packed = await runProcess(npm.command, npm.args, {cwd:fixture,timeout:20000,env:require('../lib/npm-runtime').npmEnvironment()});assert.equal(packed.code, 0, packed.stderr);
    const data=JSON.parse(packed.stdout),packages=Array.isArray(data)?data:Object.values(data);assert.equal(packages.length,1,packed.stdout);
    const packageUrl = path.join(temp, packages[0].filename), output = path.join(temp,'received-root');
    const bootstrap = {sourceRoot:temp, packageUrl, log:()=>{}};
    const result = await runFullCheck('socks5h://127.0.0.1:10808', output, [], {bootstrap});
    assert.ok(!result.args.includes('--browser'));assert.ok(result.args.includes('--no-browser'));assert.ok(result.args.includes('--no-install'));assert.ok(result.args.includes('--community-sources'));
    assert.equal(result.args[result.args.indexOf('--proxy')+1], 'socks5h://127.0.0.1:10808');
    await assert.rejects(fs.stat(result.root), {code:'ENOENT'});
    await assert.rejects(runFullCheck('',output,['--fixture-fail'],{bootstrap}), /fixture failure/);
    await assert.rejects(fs.stat(await fs.readFile(output,'utf8')), {code:'ENOENT'});
    await assert.rejects(prepareCore({...bootstrap,offline:true}), /离线运行需要/);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
});

if (process.platform === 'win32') test('Windows 下载入口通过 iex 运行成功/失败均保留当前 PowerShell 会话', async () => {
  const wrapper = await fs.readFile(path.resolve('simple-ip-check.ps1'), 'utf8');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(req.url === '/failure' ? "console.log('FIXTURE_ERROR'); process.exitCode=7;" : "console.log('FIXTURE_SUCCESS');");
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const mode of ['success', 'failure']) {
      const code = wrapper.replace('https://raw.githubusercontent.com/OpenMili/OpenMili-IP-Toolkit/main/simple-ip-check.js', `http://127.0.0.1:${server.address().port}/${mode}`);
      const encoded = Buffer.from(code).toString('base64');
      const command = `Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))); Write-Output 'SHELL_STILL_ALIVE'; Write-Output "CHILD_EXIT=$LASTEXITCODE"`;
      const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {timeout: 15000});
      assert.equal(result.code, 0, result.stderr);assert.match(result.stdout, /SHELL_STILL_ALIVE/);
      assert.match(result.stdout, mode === 'success' ? /FIXTURE_SUCCESS/ : /FIXTURE_ERROR/);
      assert.match(result.stdout, mode === 'success' ? /CHILD_EXIT=0/ : /CHILD_EXIT=1/);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
