'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {curl, detectExit, classify, saveReport, normalizeProxy} = require('../simple-ip-check');
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
  const failed = detectExit(6, '', () => ({status: 0, body: '', error: 'IPv6 connection failed'}));
  assert.equal(failed.ip, null);assert.equal(failed.status, 'unknown');assert.match(failed.reason, /IPv6/);
  for (const ip of ['192.168.1.1', '127.0.0.1', '10.0.0.1', '169.254.1.1', 'fe80::1', '::1', 'fd00::1']) {
    const family = ip.includes(':') ? 6 : 4;
    assert.equal(detectExit(family, '', () => ({status: 200, body: ip})).ip, null, `Do not accept gateway/local address ${ip}`);
  }
  assert.equal(normalizeProxy('7890'), 'http://127.0.0.1:7890');assert.equal(normalizeProxy('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
  assert.throws(() => normalizeProxy('65536'));
});

test('简易脚本保留公网双栈与错误原因，TXT/JSON 报告写入指定用户目录', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openmili-simple-report-'));
  try {
    const report = {checked_at: '2026-10-27T00:00:00.000Z', system: 'fixture', proxy: 'direct', family: 4,
      exit_ips: {ipv4: {ip: '8.8.8.8'}, ipv6: {ip: null, reason: 'IPv6 fixture unavailable'}}, identity: {}, websites: [{name: 'fixture', status: '网络失败', error: 'fixture error'}], score: null, score_note: 'fixture'};
    const files = saveReport(report, path.join(temp, '用户报告'));
    assert.ok(path.isAbsolute(files.text));assert.deepEqual(JSON.parse(await fs.readFile(files.json, 'utf8')), report);
    const text = await fs.readFile(files.text, 'utf8');assert.match(text, /公网 IPv4：8\.8\.8\.8/);assert.match(text, /公网 IPv6：IPv6 fixture unavailable/);assert.match(text, /fixture error/);
    assert.equal(classify({status: 200, body: '<h1>GitHub</h1><script>cloudflare captcha challenge</script>'}), '可访问');
    assert.equal(classify({status: 200, body: '<title>Just a moment</title>Verify you are human'}), '风控/验证');
    assert.equal(classify({status: 200, body: 'partial', error: 'transfer failed'}), '网络失败');
  } finally { await fs.rm(temp, {recursive: true, force: true}); }
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
