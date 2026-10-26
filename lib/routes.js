'use strict';
const net = require('node:net');
const { runProcess, mapLimit, jsonRequest } = require('./transport');
const { isPublicIP } = require('./core');

// Target list and prefix heuristics adapted from zhanghanyun/backtrace (MIT).
// Prefixes are a fallback hint, never sufficient evidence for a guaranteed product class.
const DEFAULT_TARGETS = [
  ['北京电信','219.141.140.10'], ['北京联通','202.106.195.68'], ['北京移动','221.179.155.161'],
  ['上海电信','202.96.209.133'], ['上海联通','210.22.97.1'], ['上海移动','211.136.112.200'],
  ['广州电信','58.60.188.222'], ['广州联通','210.21.196.6'], ['广州移动','120.196.165.24'],
  ['成都电信','61.139.2.69'], ['成都联通','119.6.6.6'], ['成都移动','211.137.96.205']
].map(([name, ip]) => ({ name, ip }));
const LINES = { 4134: '电信 163', 4809: '电信 CN2（不能据此区分 GIA/GT）', 4837: '联通 4837', 9929: '联通 9929',
  58807: '移动 CMIN2', 9808: '移动骨干', 58453: '移动 CMI' };

function prefixHint(ip) {
  const [a,b,c] = ip.split('.').map(Number);
  if (a === 59 && b === 43) return 4809;
  if (a === 202 && b === 97) return 4134;
  if (a === 218 && b === 105 || a === 210 && b === 51) return 9929;
  if (a === 219 && b === 158) return 4837;
  if (a === 223 && b === 120 && [16,17,19].includes(c)) return 58807;
  if (a === 223 && [118,119,120,121].includes(b)) return 58453;
  return null;
}

function parseTrace(raw, destination) {
  const hops = [];
  // Ignore traceroute/tracert header: it already contains the destination even on total failure.
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const ips = [...new Set((m[2].match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []).filter(ip => net.isIP(ip) === 4))];
    for (const ip of ips) hops.push({ hop: Number(m[1]), ip, line: line.trim().slice(0,500) });
  }
  return { hops, reached: hops.some(h => h.ip === destination) };
}

function parseRouteTargets(value) {
  if (!value) return DEFAULT_TARGETS;
  return String(value).split(/[\s,]+/).filter(Boolean).map(entry => {
    const match = entry.match(/^([^=]+)=(.+)$/);
    if (!match || net.isIP(match[2]) !== 4 || !isPublicIP(match[2])) throw new Error(`无效回程目标: ${entry}，需要 名称=公网IPv4`);
    return { name: match[1], ip: match[2] };
  });
}

async function traceRoutes(targets, options = {}, log = () => {}) {
  if (options.proxy) return { status: 'untested', reason: '系统 traceroute 无法穿过 HTTP/SOCKS5 代理；请在被测 VPS 本机运行', results: [] };
  if (options.family === 6) return { status: 'untested', reason: '当前三网参考节点是 IPv4，不将 IPv4 回程混入 IPv6 评分', results: [] };
  const command = process.platform === 'win32' ? 'tracert.exe' : 'traceroute';
  const cache = new Map();
  // Promise caching also prevents simultaneous traces querying the same hop repeatedly.
  const resolveASN = ip => {
    if (!cache.has(ip)) cache.set(ip, (async () => {
      try {
        const d = await jsonRequest(`https://stat.ripe.net/data/network-info/data.json?resource=${ip}`, { timeout: 5000, family: options.family });
        const values = d.data?.asns?.map(Number).filter(n => Number.isInteger(n) && n > 0) || [];
        if (d.status === 'ok' && values.length) return { asns: values, source: 'RIPE RIS' };
      } catch { /* Prefix hints remain explicitly lower-confidence evidence. */ }
      return { asns: [], source: '未测试' };
    })());
    return cache.get(ip);
  };
  const results = await mapLimit(targets, 3, async target => {
    const args = process.platform === 'win32' ? ['-4','-d','-h','20','-w','300',target.ip] : ['-n','-m','20','-q','1','-w','1',target.ip];
    const trace = await runProcess(command, args, { timeout: 25000, maxOutput: 65536 });
    if (trace.error?.includes('ENOENT')) {
      const result = { ...target, status: 'untested', reason: `缺少 ${command}，请安装系统路由跟踪工具`, hops: [] };
      log(`回程 ${target.name}: 未测试（${result.reason}）`); return result;
    }
    const parsed = parseTrace(trace.stdout, target.ip);
    // Prefer interior hops; exclude the endpoint to avoid identifying the endpoint's ASN as transit.
    const candidates = parsed.hops.filter(h => h.ip !== target.ip && isPublicIP(h.ip));
    const selected = [...candidates.filter(h => prefixHint(h.ip)), ...candidates.slice(-5)]
      .filter((h,i,a) => a.findIndex(x => x.ip === h.ip) === i).slice(0,8);
    const evidence = await mapLimit(selected, 2, async hop => {
      const resolved = await resolveASN(hop.ip);
      const hint = prefixHint(hop.ip);
      const confirmed = resolved.asns.filter(asn => LINES[asn]);
      return { ...hop, ...resolved, hint, lines: confirmed.map(asn => LINES[asn]),
        hintLabel: hint ? LINES[hint] : '', conflict: Boolean(hint && resolved.asns.length && !resolved.asns.includes(hint)) };
    });
    const lines = [...new Set(evidence.flatMap(e => e.lines))];
    const hints = [...new Set(evidence.filter(e => !e.asns.length && e.hint).map(e => e.hintLabel))];
    const result = { ...target, status: parsed.hops.length ? 'ok' : 'untested', ...parsed, evidence, lines, hints,
      reason: trace.error || (!parsed.hops.length ? trace.stderr.slice(0,500) || '未收到 ICMP 跳点响应' : ''), raw: trace.stdout.slice(0,16000) };
    log(`回程 ${target.name}: ${parsed.reached ? '到达目标' : '未到达目标'} | ${lines.join(' / ') || (hints.length ? `${hints.join(' / ')}（前缀提示，未验证）` : '线路未识别')}`);
    return result;
  });
  return { status: results.some(r => r.status === 'ok') ? 'ok' : 'untested', results,
    note: '本机到三网参考节点的出向路径，适合在海外 VPS 观察回中国方向；非客户端到 VPS 的双向证明，不能保证 CN2 GIA、带宽或商用线路等级。' };
}

module.exports = { DEFAULT_TARGETS, LINES, prefixHint, parseTrace, parseRouteTargets, traceRoutes };
