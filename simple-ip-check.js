'use strict';

// 轻量入口：只依赖 Node.js 18+ 和系统 curl，不安装 npm 包、不改系统配置。
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const cp = require('node:child_process');
const readline = require('node:readline/promises');

const sites = [
  ['GitHub', 'https://github.com/'],
  ['Google', 'https://www.google.com/'],
  ['YouTube', 'https://www.youtube.com/'],
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Claude', 'https://claude.ai/'],
  ['Reddit', 'https://www.reddit.com/'],
  ['X', 'https://x.com/'],
  ['Hugging Face', 'https://huggingface.co/'],
  ['Google Scholar', 'https://scholar.google.com/'],
  ['Cloudflare', 'https://www.cloudflare.com/']
];

function safeText(value) {
  return String(value).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1[hidden]@');
}

function curl(url, proxy = '', family = 4, run = cp.spawnSync) {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = ['-q', `-${family}`, '-sS', '-L', '--max-redirs', '5', '--connect-timeout', '5', '--max-time', '15', '--proto', '=https', '--proto-redir', '=https', '--compressed'];
  args.push('--noproxy', proxy ? '' : '*', '--proxy', proxy || '');
  args.push('-A', 'Mozilla/5.0 OpenMili-IP-Check/1.0', '-w', '\n__STATUS__%{http_code}\n__URL__%{url_effective}', url);
  const result = run(command, args, { encoding: 'utf8', windowsHide: true, timeout: 17000, maxBuffer: 1024 * 1024 });
  if (result.error) return { status: 0, body: '', error: safeText(result.error.message) };
  const output = result.stdout || '';
  const marker = output.lastIndexOf('\n__STATUS__');
  const body = marker >= 0 ? output.slice(0, marker) : output;
  const trailer = marker >= 0 ? output.slice(marker) : '';
  const status = Number((trailer.match(/\n__STATUS__(\d+)/) || [])[1]) || 0;
  const finalUrl = (trailer.match(/\n__URL__(.*)$/) || [])[1] || url;
  return { status, body: body.slice(0, 20000), finalUrl, error: result.status === 0 ? '' : safeText((result.stderr || `curl exit ${result.status}`).trim().slice(0, 300)) };
}

function classify(result) {
  if (result.error || !result.status) return '网络失败';
  const text = result.body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  if (/verify (?:that )?you(?:'re| are) (?:a )?human|人机验证|checking your browser|just a moment|complete (?:the|a) captcha|请完成验证|unusual traffic from your computer/i.test(text)) return '风控/验证';
  if ([401, 403, 429, 451].includes(result.status)) return '访问受限';
  if (result.status >= 200 && result.status < 300 && text.trim()) return '可访问';
  if (result.status >= 200 && result.status < 400) return '证据不足';
  return `HTTP ${result.status}`;
}

function isPublicExit(ip, family) {
  if (net.isIP(ip) !== family) return false;
  if (family === 6) return /^[23][0-9a-f]{0,3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
  const [a, b, c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}

function detectExit(family, proxy = '', request = curl) {
  const observations = [];
  for (const url of ['https://api64.ipify.org', 'https://ifconfig.co/ip']) {
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

async function ask(rl, prompt, fallback) {
  const answer = await rl.question(prompt);
  return answer.trim() || fallback;
}

function saveReport(report, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const base = path.join(directory, `openmili-ip-report-${report.checked_at.replace(/[:.]/g, '-')}`);
  const lines = [`OpenMili IP 检测报告`, `检测时间：${report.checked_at}`, `系统：${report.system}`, `连接：${report.proxy}`,
    `公网 IPv4：${report.exit_ips.ipv4.ip || report.exit_ips.ipv4.reason}`, `公网 IPv6：${report.exit_ips.ipv6.ip || report.exit_ips.ipv6.reason}`,
    `网站检测使用：IPv${report.family}`, `ASN / 归属：${report.identity.org || '未知'}`, `国家/地区：${report.identity.country || '未知'}`, '',
    ...report.websites.map(item => `${item.name}: ${item.status}${item.http_status ? ` (${item.http_status})` : ''}${item.error ? ` — ${item.error}` : ''}`), '',
    `参考分：${report.score === null ? '未知' : `${report.score}/100`}`, report.score_note];
  fs.writeFileSync(base + '.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  fs.writeFileSync(base + '.txt', '\uFEFF' + lines.join(os.EOL), { mode: 0o600 });
  return { json: base + '.json', text: base + '.txt' };
}

async function main() {
  console.log(`\nOpenMili-IP-Toolkit · IP 质量检测脚本\nGitHub：https://github.com/OpenMili/OpenMili-IP-Toolkit\n系统：${os.platform()} ${os.arch()}\n`);
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex !== -1 && (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith('--'))) throw new Error('--output 需要目录');
  const directory = path.resolve(outputIndex !== -1 ? process.argv[outputIndex + 1] : path.join(os.homedir(), 'openmili-reports'));
  // 在发出网络请求前确认可保存报告，避免运行很久后才发现无写入权限。
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.W_OK);
  const current = showExits('', '当前公网（直连）');
  console.log('\n[1] 开始测试\n[2] 自定义端口\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const choice = await ask(rl, '请选择 [1]：', '1');
    let proxy = '';
    if (choice === '2') {
      const value = await ask(rl, '输入代理端口或完整地址 [7890]：', '7890');
      proxy = normalizeProxy(value);
    }
    if (choice !== '1' && choice !== '2') throw new Error('只能输入 1 或 2');
    console.log(`开始检测（${safeText(proxy) || '直连'}）...\n报告保存目录：${directory}`);
    const { ipv4, ipv6 } = proxy ? showExits(proxy, '代理出口') : current;
    const family = ipv4.ip ? 4 : ipv6.ip ? 6 : 4, ip = family === 4 ? ipv4.ip : ipv6.ip;
    const info = ip ? curl(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, proxy, family) : { status: 0, body: '' };
    let identity = {};
    try { identity = JSON.parse(info.body); } catch { identity = { raw: info.body.slice(0, 500) }; }
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) identity = {};
    console.log(`ASN / 归属：${identity.org || '未知'}  国家/地区：${identity.country || '未知'}\n网站检测使用 IPv${family}：`);
    const results = sites.map(([name, url]) => {
      const result = curl(url, proxy, family);
      const item = { name, url, family, status: classify(result), http_status: result.status || null, final_url: result.finalUrl, error: result.error || undefined };
      console.log(`${name}: ${item.status}${item.http_status ? ` (${item.http_status})` : ''}`);
      return item;
    });
    const counts = results.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
    const score = ip ? Math.max(0, Math.round(100 - (counts['风控/验证'] || 0) * 8 - (counts['访问受限'] || 0) * 12 - (counts['网络失败'] || 0) * 15)) : null;
    const report = { checked_at: new Date().toISOString(), system: `${os.platform()} ${os.arch()}`, proxy: safeText(proxy) || 'direct', exit_ip: ip || null, exit_ips: { ipv4, ipv6 }, family, identity, websites: results, summary: counts, score, score_note: '简单参考分，不代表绝对干净、注册成功或永久可用' };
    const files = saveReport(report, directory);
    console.log(`\n参考分：${score === null ? '未知' : `${score}/100`}（只作快速筛选）`);
    console.log(`文本报告：${files.text}\nJSON 报告：${files.json}`);
  } finally { rl.close(); }
}

if (require.main === module) {
  main().catch(error => { console.error(`检测失败：${safeText(error.message)}`); process.exitCode = 1; }).finally(async () => {
    if (process.platform === 'win32' && process.stdin.isTTY && !process.argv.includes('--no-pause')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try { await rl.question('按回车键结束…'); } finally { rl.close(); }
    }
  });
}
module.exports = { curl, detectExit, classify, saveReport, normalizeProxy };
