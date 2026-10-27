const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
  const status = request.url === '/forbidden' ? 403 : request.url === '/error' ? 503 : 200;
  response.writeHead(status);
  response.end(request.url === '/empty' ? '' : request.url === '/ok' ? 'ok' : 'test');
});

function run(command, args, expectFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    child.on('error', reject);
    child.on('close', code => (expectFailure ? code !== 0 : code === 0) ? resolve(output) : reject(new Error(output)));
  });
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const targets = path.join(os.tmpdir(), `openmili-smoke-${process.pid}.yaml`);
  const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'openmili-smoke-reports-'));
  fs.writeFileSync(targets, [
    '# YAML regression: quotes, comments, field order, URL fragments and duplicates',
    'domains:',
    '  - name: "短响应" # comment',
    `    url: http://127.0.0.1:${port}/ok?x=1&y=2#fragment`,
    `  - url: 'http://127.0.0.1:${port}/forbidden'`,
    "    name: '访问受限'",
    '  - name: 服务异常',
    `    url: http://127.0.0.1:${port}/error # comment`,
    '  - name: 响应为空',
    `    url: "http://127.0.0.1:${port}/empty"`,
    "  - name: '重''复'",
    `    url: http://127.0.0.1:${port}/ok?x=1&y=2#fragment`,
    String.raw`  - name: "重复 \"引号\""`,
    `    url: http://127.0.0.1:${port}/ok?x=1&y=2#fragment`
  ].join('\r\n'));
  try {
    const checks = [];
    if (process.platform === 'win32') {
      checks.push(['PowerShell', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'run.ps1'), '-Mode', 'direct', '-Urls', targets, '-SkipIP', '-NoPause', '-NoBrowser', '-NoRoutes', '-NoHistory', '-NoLookup', '-MinDelayMs', '0', '-MaxDelayMs', '0', '-Output', reports]]);
    }
    const bash = process.env.TEST_BASH || (process.platform === 'win32' ? '' : 'bash');
    if (bash) {
      const script = process.platform === 'win32' ? path.join(root, 'run.sh').replace(/\\/g, '/').replace(/^([A-Z]):/i, (_, d) => `/${d.toLowerCase()}`) : path.join(root, 'run.sh');
      checks.push(['Bash', bash, [script, '--mode', 'direct', '--urls', targets, '--skip-ip', '--no-pause', '--no-browser', '--no-routes', '--no-history', '--no-lookup', '--min-delay', '0', '--max-delay', '0', '--output', reports]]);
    }
    for (const [name, command, args] of checks) {
      const output = await run(command, args);
      assert.match(output, /短响应\s+通过 200/);
      assert.match(output, /访问受限\s+阻断 403/);
      assert.match(output, /服务异常\s+异常 503/);
      assert.match(output, /响应为空\s+空白 200/);
      assert.match(output, /服务可达 1\/4/);
      assert.match(output, /04 响应为空/);
      process.stdout.write(`${name}: YAML + HTTP PASS\n`);
    }
    fs.writeFileSync(targets, 'domains:\n  - name: 缺少URL\n');
    for (const [name, command, args] of checks) {
      await run(command, args, true);
      process.stdout.write(`${name}: invalid YAML rejected\n`);
    }
  } finally {
    fs.rmSync(targets, { force: true });
    fs.rmSync(reports, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
