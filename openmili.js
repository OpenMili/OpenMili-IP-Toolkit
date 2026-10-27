#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const readline = require('node:readline/promises');
const os = require('node:os');

const VERSION = '3.0.0';

// ANSI 颜色支持检测
const isColorSupported = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);
const C = {
  reset: isColorSupported ? '\x1b[0m' : '',
  bold: isColorSupported ? '\x1b[1m' : '',
  dim: isColorSupported ? '\x1b[2m' : '',
  green: isColorSupported ? '\x1b[32m' : '',
  yellow: isColorSupported ? '\x1b[33m' : '',
  red: isColorSupported ? '\x1b[31m' : '',
  cyan: isColorSupported ? '\x1b[36m' : '',
  blue: isColorSupported ? '\x1b[34m' : '',
  magenta: isColorSupported ? '\x1b[35m' : '',
  gray: isColorSupported ? '\x1b[90m' : '',
};

function normalizeProxy(val) {
  if (!val) return '';
  val = String(val).trim();
  if (/^\d+$/.test(val)) return `http://127.0.0.1:${val}`;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(val)) return `http://${val}`;
  return val;
}

const NULL_DEV = process.platform === 'win32' ? 'NUL' : '/dev/null';

// 执行 HTTP 请求（优先使用系统 curl 以支持各类 socks5/http 代理和更真实的 TLS 指纹）
function request(url, { proxy = '', timeout = 5, userAgent, headers = [], checkBody = false, family = 0 } = {}) {
  const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  const curlCmd = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const args = [
    '-sS',
    '-L',
    '--max-redirs', '4',
    '--connect-timeout', String(Math.min(3, timeout)),
    '--max-time', String(timeout),
    '-A', ua
  ];

  if (family === 4) args.push('-4');
  if (family === 6) args.push('-6');

  if (proxy) {
    args.push('--proxy', proxy);
  } else {
    args.push('--noproxy', '*');
  }

  for (const h of headers) {
    args.push('-H', h);
  }

  if (checkBody) {
    args.push('-w', '\n__STATUS__%{http_code}\n__TIME__%{time_total}\n__URL__%{url_effective}', url);
  } else {
    args.push('-o', NULL_DEV, '-w', '%{http_code}\n%{time_total}\n%{url_effective}\n', url);
  }

  try {
    const res = cp.spawnSync(curlCmd, args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: checkBody ? 2 * 1024 * 1024 : 64 * 1024,
      timeout: (timeout + 2) * 1000
    });

    if (res.error) {
      return { ok: false, status: 0, duration: 0, body: '', error: res.error.message };
    }

    const out = res.stdout || '';

    if (checkBody) {
      const statusMatch = out.match(/\n__STATUS__(\d+)/);
      const timeMatch = out.match(/\n__TIME__([\d.]+)/);
      const urlMatch = out.match(/\n__URL__(.*)$/);

      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const duration = timeMatch ? parseFloat(timeMatch[1]) : 0;
      const finalUrl = urlMatch ? urlMatch[1].trim() : url;

      const markerIdx = out.indexOf('\n__STATUS__');
      const body = markerIdx !== -1 ? out.slice(0, markerIdx) : out;

      return {
        ok: status >= 200 && status < 400,
        status,
        duration,
        finalUrl,
        body,
        error: res.status !== 0 ? (res.stderr || `curl exit ${res.status}`).trim() : ''
      };
    } else {
      const lines = out.trim().split(/\r?\n/);
      const status = parseInt(lines[0], 10) || 0;
      const duration = parseFloat(lines[1]) || 0;
      const finalUrl = lines[2] ? lines[2].trim() : url;

      return {
        ok: status >= 200 && status < 400,
        status,
        duration,
        finalUrl,
        body: '',
        error: res.status !== 0 ? (res.stderr || `curl exit ${res.status}`).trim() : ''
      };
    }
  } catch (err) {
    return { ok: false, status: 0, duration: 0, body: '', error: err.message };
  }
}

// 探测公网出口 IP 与归属地
function getExitInfo(proxy = '') {
  let ipInfo = null;
  const res1 = request('http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query', {
    proxy,
    timeout: 5,
    checkBody: true,
    family: 4
  });

  if (res1.ok && res1.body) {
    try {
      const data = JSON.parse(res1.body);
      if (data.status === 'success') {
        ipInfo = {
          ipv4: data.query,
          country: data.country,
          countryCode: data.countryCode,
          region: data.regionName,
          city: data.city,
          isp: data.isp,
          org: data.org || data.asname,
          asn: data.as,
          isHosting: data.hosting,
          isProxy: data.proxy,
          isMobile: data.mobile,
        };
      }
    } catch {}
  }

  // 备用源: ipwho.is
  if (!ipInfo) {
    const res2 = request('https://ipwho.is/', { proxy, timeout: 5, checkBody: true });
    if (res2.ok && res2.body) {
      try {
        const data = JSON.parse(res2.body);
        if (data.success) {
          ipInfo = {
            ipv4: data.ip,
            country: data.country,
            countryCode: data.country_code,
            region: data.region,
            city: data.city,
            isp: data.connection?.isp,
            org: data.connection?.org,
            asn: data.connection?.asn ? `AS${data.connection.asn}` : '',
            isHosting: null,
            isProxy: null,
            isMobile: null,
          };
        }
      } catch {}
    }
  }

  // 2. 检测 IPv6 (轻量探测，2秒超时)
  let ipv6 = null;
  const res6 = request('https://api6.ipify.org?format=json', { proxy, timeout: 2, checkBody: true, family: 6 });
  if (res6.ok && res6.body) {
    try {
      const d = JSON.parse(res6.body);
      if (d.ip && d.ip.includes(':')) ipv6 = d.ip;
    } catch {}
  }

  return { ipInfo, ipv6 };
}

// 目标检测清单
const SERVICES = [
  // AI 智能
  {
    category: 'AI 智能服务',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      if (r.status === 403) return { ok: false, note: '被 Cloudflare 拦截 (403)' };
      if (r.status === 429) return { ok: false, note: '请求过多限流 (429)' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: 'AI 智能服务',
    name: 'OpenAI API',
    url: 'https://api.openai.com/v1/models',
    check: (r) => {
      if (r.status === 401 || r.status === 200) return { ok: true, note: '正常连通 (端点就绪)' };
      if (r.status === 403) return { ok: false, note: '地区不可用 (403)' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: 'AI 智能服务',
    name: 'Anthropic Claude',
    url: 'https://claude.ai',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      if (r.status === 403) return { ok: false, note: '地区限制或被阻断 (403)' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: 'AI 智能服务',
    name: 'Google Gemini',
    url: 'https://gemini.google.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      if (r.status === 403 || r.status === 451) return { ok: false, note: '地区受限' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: 'AI 智能服务',
    name: 'Microsoft Copilot',
    url: 'https://copilot.microsoft.com',
    check: (r) => {
      if (r.status === 200 || r.status === 302) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: 'AI 智能服务',
    name: 'Grok / xAI',
    url: 'https://grok.com',
    check: (r) => {
      if (r.status === 200 || r.status === 307 || r.status === 302) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },

  // 流媒体与娱乐
  {
    category: '流媒体与娱乐',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '流媒体与娱乐',
    name: 'Netflix',
    url: 'https://www.netflix.com/title/80018499', // 绝命毒师测试片
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '完整解锁 (原生/非自制)' };
      if (r.status === 403) return { ok: false, note: '机房 IP 仅自制剧或阻断' };
      if (r.status === 404) return { ok: false, note: '地区版权不包含该片' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '流媒体与娱乐',
    name: 'Disney+',
    url: 'https://www.disneyplus.com',
    check: (r) => {
      if (r.status === 200 || r.status === 301 || r.status === 302) return { ok: true, note: '正常访问' };
      if (r.status === 403) return { ok: false, note: '地区限制或机房阻断 (403)' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '流媒体与娱乐',
    name: 'Spotify',
    url: 'https://www.spotify.com',
    check: (r) => {
      if (r.status === 200 || r.status === 301 || r.status === 302) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '流媒体与娱乐',
    name: 'TikTok',
    url: 'https://www.tiktok.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      if (r.status === 403) return { ok: false, note: '封锁该地区或 IP' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },

  // 社交与核心服务
  {
    category: '常用服务与社交',
    name: 'Google 搜索',
    url: 'https://www.google.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常 (无拦截)' };
      if (r.status === 429) return { ok: false, note: '遭遇人机验证/验证码 (429)' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '常用服务与社交',
    name: 'GitHub',
    url: 'https://github.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '常用服务与社交',
    name: 'Twitter / X',
    url: 'https://x.com',
    check: (r) => {
      if (r.status === 200 || r.status === 302) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '常用服务与社交',
    name: 'Reddit',
    url: 'https://www.reddit.com',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      if (r.status === 403) return { ok: false, note: '被封锁 (403)' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '常用服务与社交',
    name: 'Wikipedia',
    url: 'https://www.wikipedia.org',
    check: (r) => {
      if (r.status === 200) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  },
  {
    category: '常用服务与社交',
    name: 'Telegram Web',
    url: 'https://web.telegram.org',
    check: (r) => {
      if (r.status === 200 || r.status === 302) return { ok: true, note: '正常访问' };
      return { ok: false, note: `HTTP ${r.status || '超时/无响应'}` };
    }
  }
];

// 并发池调度器
async function runPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function padRight(str, len) {
  let width = 0;
  for (const ch of str) {
    width += ch.charCodeAt(0) > 255 ? 2 : 1;
  }
  const pad = Math.max(0, len - width);
  return str + ' '.repeat(pad);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(`
OpenMili IP Toolkit v${VERSION} · 极简轻量出口质量检测

用法:
  node openmili.js                 交互式启动 (直连 / 代理)
  node openmili.js -d              直接进行直连检测
  node openmili.js -p 7890         使用指定端口代理检测 (默认 HTTP 127.0.0.1:端口)
  node openmili.js -p socks5://127.0.0.1:10808   使用完整代理 URL

选项:
  -d, --direct                     直连模式
  -p, --proxy <port|url>           代理模式
  --no-color                       禁用彩色输出
  -h, --help                       查看帮助信息
`);
    return;
  }

  console.log(`\n${C.cyan}${C.bold}┌────────────────────────────────────────────────────────┐${C.reset}`);
  console.log(`${C.cyan}${C.bold}│          OpenMili IP Toolkit v${VERSION} · 轻量检测              │${C.reset}`);
  console.log(`${C.cyan}${C.bold}└────────────────────────────────────────────────────────┘${C.reset}`);
  console.log(`${C.dim}平台: ${os.platform()} ${os.arch()} | 纯净免依赖版${C.reset}\n`);

  let proxy = '';

  const proxyIdx = args.findIndex(a => a === '-p' || a === '--proxy');
  if (proxyIdx !== -1 && args[proxyIdx + 1]) {
    proxy = normalizeProxy(args[proxyIdx + 1]);
  } else if (args.includes('-d') || args.includes('--direct')) {
    proxy = '';
  } else if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      console.log(`[1] 直连检测`);
      console.log(`[2] 本地代理 (默认 7890，支持 10808 / socks5)`);
      const choice = (await rl.question('\n请选择 [1]: ')).trim() || '1';

      if (choice === '2') {
        const pInput = (await rl.question('请输入代理端口或地址 [7890]: ')).trim() || '7890';
        proxy = normalizeProxy(pInput);
      }
    } finally {
      rl.close();
    }
  }

  const modeText = proxy ? `${C.yellow}代理模式${C.reset} (${C.dim}${proxy}${C.reset})` : `${C.green}直连模式${C.reset}`;
  console.log(`\n[>] 当前检测模式: ${modeText}`);
  console.log(`${C.dim}[*] 正在获取出口 IP 与网络信息...${C.reset}\n`);

  const startTime = Date.now();
  const { ipInfo, ipv6 } = getExitInfo(proxy);

  if (!ipInfo) {
    console.log(`${C.red}✖ 无法获取公网出口 IP。可能原因: 无法连接网络或代理端口不可达。${C.reset}`);
    return;
  }

  // 打印网络信息卡片
  console.log(`${C.cyan}──────────────────────── 出口网络信息 ────────────────────────${C.reset}`);
  console.log(`  公网 IPv4:   ${C.bold}${C.green}${ipInfo.ipv4}${C.reset}`);
  console.log(`  公网 IPv6:   ${ipv6 ? `${C.green}${ipv6}${C.reset}` : `${C.dim}未检测到 (无 IPv6 或代理未开启)${C.reset}`}`);
  console.log(`  地理位置:    ${ipInfo.country} ${ipInfo.region ? ipInfo.region + ' ' : ''}${ipInfo.city || ''} (${ipInfo.countryCode})`);
  console.log(`  运营商/组织: ${ipInfo.asn ? `${ipInfo.asn} · ` : ''}${ipInfo.isp || ipInfo.org || '未知'}`);

  let typeDesc = '未知';
  if (ipInfo.isHosting === true) {
    typeDesc = `${C.yellow}机房 / 数据中心 (Datacenter)${C.reset}`;
  } else if (ipInfo.isMobile === true) {
    typeDesc = `${C.green}移动蜂窝网络 (Cellular/Mobile)${C.reset}`;
  } else if (ipInfo.isHosting === false) {
    typeDesc = `${C.green}住宅宽带 / 商业宽带 (Residential/ISP)${C.reset}`;
  }
  console.log(`  网络类型:    ${typeDesc}`);

  let riskDesc = '正常';
  if (ipInfo.isProxy === true) {
    riskDesc = `${C.yellow}识别为公共代理/VPN节点${C.reset}`;
  }
  console.log(`  风险状态:    ${riskDesc}`);
  console.log(`${C.cyan}──────────────────────────────────────────────────────────────${C.reset}\n`);

  console.log(`[*] 开始检测常用服务与流媒体解锁 (并发测试中...):\n`);

  let passedCount = 0;
  let totalCount = SERVICES.length;

  // 按分类顺序与并发测试
  await runPool(SERVICES, 6, async (svc) => {
    const res = request(svc.url, { proxy, timeout: 5 });
    const checkResult = svc.check(res);

    if (checkResult.ok) passedCount++;

    const statusBadge = checkResult.ok
      ? `${C.green}✔ 通过${C.reset}`
      : `${C.red}✖ 受限${C.reset}`;

    const dur = res.duration > 0 ? `${res.duration.toFixed(2)}s` : '-';
    const line = `  ${statusBadge}  ${padRight(svc.name, 18)} ${C.dim}${dur.padStart(6)}${C.reset}  ${C.gray}${checkResult.note}${C.reset}`;
    console.log(line);
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const unlockRate = Math.round((passedCount / totalCount) * 100);

  console.log(`\n${C.cyan}──────────────────────── 检测结果总结 ────────────────────────${C.reset}`);
  console.log(`  可用服务: ${C.bold}${passedCount} / ${totalCount}${C.reset} (${unlockRate >= 80 ? C.green : unlockRate >= 50 ? C.yellow : C.red}${unlockRate}%${C.reset})   总耗时: ${C.dim}${totalTime}s${C.reset}`);
  console.log(`${C.cyan}──────────────────────────────────────────────────────────────${C.reset}\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`\n${C.red}运行时发生错误: ${err.message}${C.reset}`);
    process.exitCode = 1;
  }).finally(async () => {
    if (process.platform === 'win32' && process.stdin.isTTY && !process.argv.includes('-d') && !process.argv.includes('-p')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        await rl.question('按回车键退出...');
      } finally {
        rl.close();
      }
    }
  });
}

module.exports = { request, getExitInfo, SERVICES };
