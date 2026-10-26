'use strict';

// 轻量入口：只依赖 Node.js 18+ 和系统 curl，不安装 npm 包、不改系统配置。
const fs = require('node:fs');
const os = require('node:os');
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

function curl(url, proxy = '') {
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = ['-q', '-sS', '-L', '--max-redirs', '5', '--connect-timeout', '5', '--max-time', '15', '--proto', '=https', '--proto-redir', '=https', '--compressed'];
  args.push('--noproxy', '', '--proxy', proxy || '');
  args.push('-A', 'Mozilla/5.0 OpenMili-IP-Check/1.0', '-w', '\n__STATUS__%{http_code}\n__URL__%{url_effective}', url);
  const result = cp.spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  if (result.error) return { status: 0, body: '', error: result.error.message };
  const output = result.stdout || '';
  const marker = output.lastIndexOf('\n__STATUS__');
  const body = marker >= 0 ? output.slice(0, marker) : output;
  const status = Number((output.match(/\n__STATUS__(\d+)/) || [])[1]) || 0;
  const finalUrl = (output.match(/\n__URL__(.*)$/) || [])[1] || url;
  return { status, body: body.slice(0, 20000), finalUrl, error: result.status === 0 ? '' : (result.stderr || `curl exit ${result.status}`).trim().slice(0, 300) };
}

function classify(result) {
  if (!result.status) return '网络失败';
  const text = result.body.toLowerCase();
  if (/captcha|cloudflare|verify you are human|人机验证|security check|checking your browser|challenge/.test(text)) return '风控/验证';
  if ([401, 403, 429, 451].includes(result.status)) return '访问受限';
  if (result.status >= 200 && result.status < 400) return '可访问';
  return `HTTP ${result.status}`;
}

function ask(question, fallback = '') {
  return question.then(answer => (answer || '').trim() || fallback).catch(() => fallback);
}

async function main() {
  if (!process.stdin.isTTY) console.log('OpenMili IP 简易检测');
  console.log(`系统：${os.platform()} ${os.arch()} | 本机：${Object.values(os.networkInterfaces()).flat().filter(x => x && !x.internal).map(x => x.address).join(', ') || '未知'}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const choice = await ask(rl.question('输入 1 直连；输入 2 使用代理端口 [1]：'), '1');
    let proxy = '';
    if (choice === '2') {
      const value = await ask(rl.question('输入端口或代理地址 [7890]：'), '7890');
      proxy = /^\d+$/.test(value) ? `http://127.0.0.1:${value}` : value;
    }
    if (choice !== '1' && choice !== '2') throw new Error('只能输入 1 或 2');
    console.log(`开始检测（${proxy || '直连'}）...`);
    const ipResult = curl('https://api.ipify.org', proxy);
    const ip = ipResult.body.trim().match(/^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i)?.[0] || '';
    const info = ip ? curl(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, proxy) : { status: 0, body: '' };
    let identity = {};
    try { identity = JSON.parse(info.body); } catch { identity = { raw: info.body.slice(0, 500) }; }
    const results = sites.map(([name, url]) => {
      const result = curl(url, proxy);
      return { name, url, status: classify(result), http_status: result.status || null, final_url: result.finalUrl, error: result.error || undefined };
    });
    const counts = results.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
    const score = ip ? Math.max(0, Math.round(100 - (counts['风控/验证'] || 0) * 8 - (counts['访问受限'] || 0) * 12 - (counts['网络失败'] || 0) * 15)) : null;
    const report = { checked_at: new Date().toISOString(), system: `${os.platform()} ${os.arch()}`, proxy: proxy || 'direct', exit_ip: ip || null, identity, websites: results, summary: counts, score, score_note: '简单参考分，不代表绝对干净、注册成功或永久可用' };
    const file = `openmili-ip-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(`\n出口 IP：${ip || '未取得'}  ASN：${identity.org || '未知'}  国家/地区：${identity.country || '未知'}`);
    for (const item of results) console.log(`${item.status === '可访问' ? '✓' : item.status === '风控/验证' ? '!' : '×'} ${item.name}: ${item.status}${item.http_status ? ` (${item.http_status})` : ''}`);
    console.log(`\n参考分：${score === null ? '未知' : `${score}/100`}（只作快速筛选）`);
    console.log(`报告：${require('node:path').resolve(file)}`);
  } finally { rl.close(); }
}

main().catch(error => { console.error(`检测失败：${error.message}`); process.exitCode = 1; });
