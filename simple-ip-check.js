'use strict';

// 简单菜单共用完整检测内核；远程运行时仅在临时目录准备核心依赖。
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const cp = require('node:child_process');
const readline = require('node:readline/promises');

const IP_ENDPOINTS = {
  4: ['https://api4.ipify.org', 'https://ipv4.icanhazip.com', 'https://api-ipv4.ip.sb/ip'],
  6: ['https://api6.ipify.org', 'https://ipv6.icanhazip.com', 'https://api-ipv6.ip.sb/ip']
};

function safeText(value) {
  return String(value).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1[hidden]@');
}

function curl(url, proxy = '', family = 4, run = cp.spawnSync) {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = ['-q', `-${family}`, '-sS', '-L', '--max-redirs', '5', '--connect-timeout', '3', '--max-time', '5', '--proto', '=https', '--proto-redir', '=https', '--compressed'];
  args.push('--noproxy', proxy ? '' : '*', '--proxy', proxy || '');
  args.push('-A', 'Mozilla/5.0 OpenMili-IP-Check/1.0', '-w', '\n__STATUS__%{http_code}\n__URL__%{url_effective}', url);
  const result = run(command, args, { encoding: 'utf8', windowsHide: true, timeout: 7000, maxBuffer: 65536 });
  if (result.error) return { status: 0, body: '', error: safeText(result.error.message) };
  const output = result.stdout || '';
  const marker = output.lastIndexOf('\n__STATUS__');
  const body = marker >= 0 ? output.slice(0, marker) : output;
  const trailer = marker >= 0 ? output.slice(marker) : '';
  const status = Number((trailer.match(/\n__STATUS__(\d+)/) || [])[1]) || 0;
  const finalUrl = (trailer.match(/\n__URL__(.*)$/) || [])[1] || url;
  return { status, body: body.slice(0, 20000), finalUrl, error: result.status === 0 ? '' : safeText((result.stderr || `curl exit ${result.status}`).trim().slice(0, 300)) };
}

function isPublicExit(ip, family) {
  if (net.isIP(ip) !== family) return false;
  if (family === 6) return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

function detectExit(family, proxy = '', request = curl) {
  const observations = [];
  // CONNECT 代理下 -4/-6 不能约束远端解析，必须同时使用单协议族域名。
  for (const url of IP_ENDPOINTS[family]) {
    const result = request(url, proxy, family), ip = result.body.trim();
    if (!result.error && result.status === 200 && isPublicExit(ip, family)) {
      return { ip, status: 'ok', family, source: url, method: `curl -${family}`, observations };
    }
    observations.push({ source: url, reason: result.error || `未返回所选协议族的有效公网 IPv${family} 地址 (HTTP ${result.status})` });
  }
  return { ip: null, status: 'unknown', family, method: `curl -${family}`, reason: `未获取 IPv${family} 公网出口；可能未启用、代理不支持该族或回显服务不可达`, observations };
}

function showExits(proxy = '', label = '当前公网') {
  console.log(`正在通过 curl -4 查询${label} IPv4…`);
  const ipv4 = detectExit(4, proxy);
  console.log(`${label} IPv4：${ipv4.ip || ipv4.reason}`);
  console.log(`正在通过 curl -6 查询${label} IPv6…`);
  const ipv6 = detectExit(6, proxy);
  console.log(`${label} IPv6：${ipv6.ip || ipv6.reason}`);
  return { ipv4, ipv6 };
}

function normalizeProxy(value) {
  if (/^\d+$/.test(value)) {
    if (Number(value) < 1 || Number(value) > 65535) throw new Error('代理端口必须为 1–65535');
    value = `http://127.0.0.1:${value}`;
  }
  const url = new URL(value);
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('代理地址格式无效');
  return value;
}

async function ask(rl, prompt, fallback, signal) {
  const answer = await rl.question(prompt, {signal});
  return answer.trim() || fallback;
}

function npmCommand(args) {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ...String(process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'node_modules/npm/bin/npm-cli.js'))];
  const cli = candidates.find(p => p && /npm-cli\.js$/.test(p) && fs.existsSync(p));
  if (cli) return {command: process.execPath, args: [cli, ...args]};
  if (process.platform === 'win32') throw new Error('需要 Node.js 20+（含 npm）：https://nodejs.org/');
  return {command: 'npm', args};
}

async function prepareCore({proxy = '', signal, sourceRoot = __dirname,
  packageUrl = `https://codeload.github.com/OpenMili/OpenMili-IP-Toolkit/tar.gz/refs/heads/main?openmili=${Date.now()}`,
  log = console.log, offline = false} = {}) {
  if (fs.existsSync(path.join(sourceRoot, 'bin/openmili.js'))) {
    return {main: require(path.join(sourceRoot, 'bin/openmili.js')).main, close: async () => {}};
  }
  if (offline) throw new Error('离线运行需要已克隆且已安装依赖的本地仓库');
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'openmili-check-'));
  const close = () => fs.promises.rm(temp, {recursive: true, force: true, maxRetries: 3});
  try {
    log('正在从 GitHub 获取完整检测脚本与依赖（临时目录）…');
    // 下载代理仅用于本次取文件；不改变测试出口或 npm 全局设置。
    const env = {...process.env};
    for (const key of Object.keys(env)) if (/^(?:npm_config_(?:prefix|local_prefix|global_prefix)|npm_(?:command|execpath|node_execpath|lifecycle_event|lifecycle_script|package_json))$/i.test(key)) delete env[key];
    let downloadProxy = proxy;
    if (!downloadProxy) downloadProxy = cp.spawnSync('git', ['config', '--get-urlmatch', 'http.proxy', 'https://github.com/'], {encoding: 'utf8', windowsHide: true, timeout: 3000}).stdout?.trim() || '';
    if (downloadProxy) Object.assign(env, {npm_config_https_proxy: downloadProxy, npm_config_proxy: downloadProxy, npm_config_noproxy: ''});
    const npm = npmCommand(['install', '--prefix', temp, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error', '--fetch-retries=1', '--fetch-timeout=45000', packageUrl]);
    await new Promise((resolve, reject) => {
      const child = cp.spawn(npm.command, npm.args, {cwd: temp, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal});
      let errors = '';
      child.stderr.on('data', chunk => {errors = (errors + chunk).slice(-12000);});
      child.stdout.resume();
      const progress = setInterval(() => log('正在准备检测依赖，请稍候…'), 15000);
      const timeout = setTimeout(() => child.kill(), 180000);
      child.on('error', reject);
      child.on('close', code => {clearInterval(progress); clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`完整脚本获取失败：${safeText(errors.trim() || `npm exit ${code}`)}`));});
    });
    const core = require(path.join(temp, 'node_modules/openmili-ip-toolkit/bin/openmili.js'));
    return {main: core.main, close};
  } catch (error) {await close(); throw error;}
}

function fullArgs(proxy, directory, extra = []) {
  return ['all', '--terminal', '--browser', '--community-sources', '--no-pause', '--ignore-env-proxy', ...extra,
    '--output', directory, '--mode', proxy ? 'proxy' : 'direct', ...(proxy ? ['--proxy', proxy] : [])];
}

async function runFullCheck(proxy, directory, extra = [], runtime = {}) {
  const core = await prepareCore({proxy, signal: runtime.signal, offline: extra.includes('--offline'), ...runtime.bootstrap});
  try {return await core.main(fullArgs(proxy, directory, extra), {signal: runtime.signal});}
  finally {await core.close();}
}

async function main(args = process.argv.slice(2), runtime = {}) {
  if (+process.versions.node.split('.')[0] < 20) throw new Error('需要 Node.js 20+（含 npm）：https://nodejs.org/');
  console.log(`\nOpenMili-IP-Toolkit · IP 质量检测脚本\nGitHub：https://github.com/OpenMili/OpenMili-IP-Toolkit\n系统：${os.platform()} ${os.arch()}\n`);
  const extra = [...args].filter(a => a !== '--no-pause');
  const outputIndex = extra.indexOf('--output');
  if (outputIndex !== -1 && (!extra[outputIndex + 1] || extra[outputIndex + 1].startsWith('--'))) throw new Error('--output 需要目录');
  const directory = path.resolve(outputIndex !== -1 ? extra.splice(outputIndex, 2)[1] : path.join(os.homedir(), 'openmili-reports'));
  if(outputIndex!==-1)extra.push('--save-report');
  if(extra.includes('--save-report')){
    fs.mkdirSync(directory, {recursive:true});
    fs.accessSync(directory, fs.constants.W_OK);
  }
  if (!extra.includes('--offline')) showExits('', '当前公网（直连）');
  console.log('\n[1] 开始测试\n[2] 自定义端口\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let proxy = '';
  try {
    const choice = await ask(rl, '请选择 [1]：', '1', runtime.signal);
    if (choice === '2') {
      const value = await ask(rl, '输入代理端口或完整地址 [7890]：', '7890', runtime.signal);
      proxy = normalizeProxy(value);
    }
    if (choice !== '1' && choice !== '2') throw new Error('只能输入 1 或 2');
    console.log(`\n开始检测（${safeText(proxy) || '直连'}）…`);
    if(extra.includes('--save-report'))console.log(`同时保存报告：${directory}`);
  } finally { rl.close(); }
  console.log('检测内容：双栈出口、公开库/ASN/风险、DNS、三网路径、IP 历史、全部网站 HTTP 与真实浏览器、综合评分。');
  if (proxy) console.log('代理模式：三网路径无法穿过 HTTP/SOCKS 代理；需要回程结果，请在被测服务器本机运行。');
  return runFullCheck(proxy, directory, extra, runtime);
}

if (require.main === module) {
  const controller = new AbortController(), abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  main(undefined, {signal: controller.signal}).catch(error => { console.error(`检测失败：${safeText(error.message)}`); process.exitCode = controller.signal.aborted ? 130 : 1; }).finally(async () => {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    if (process.platform === 'win32' && process.stdin.isTTY && !controller.signal.aborted && !process.argv.includes('--no-pause')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { await rl.question('按回车键结束…'); } finally { rl.close(); }
    }
  });
}
module.exports = { curl, detectExit, normalizeProxy, prepareCore, fullArgs, runFullCheck, main };
