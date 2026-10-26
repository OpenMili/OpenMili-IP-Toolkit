'use strict';
const net = require('node:net');
const { jsonRequest, request } = require('./transport');
const { isPublicIP, canonicalIP, sameIP } = require('./core');
const asnTypes = require('../data/asn-types.json');

const IP_ENDPOINTS = {
  4: ['https://api4.ipify.org', 'https://ipv4.icanhazip.com', 'https://api-ipv4.ip.sb/ip'],
  6: ['https://api6.ipify.org', 'https://ipv6.icanhazip.com', 'https://api-ipv6.ip.sb/ip']
};

async function discoverFamily(family, options) {
  options ||= {};
  const observations = [];
  for (const url of options.endpoints?.[family] || IP_ENDPOINTS[family]) {
    if (options.signal?.aborted || options.offline) break;
    try {
      const r = await request(url, { ...options, family, timeout: 4000, maxBytes: 4096 });
      const value = canonicalIP(r.body.trim());
      if (!r.error && r.status === 200 && net.isIP(value) === family && isPublicIP(value)) observations.push({ ip: value, source: url,checked_at:new Date().toISOString(),proxy_path_verified:!r.proxyBypassed });
    } catch { /* Try an independent public endpoint. */ }
    if (observations.length === 2) break;
  }
  const ips = [...new Set(observations.map(x => x.ip))];
  const independent = new Set(observations.map(x => new URL(x.source).hostname.split('.').slice(-2).join('.'))).size;
  return { ip: ips[0] || '', observations, stable: ips.length === 1 && independent >= 2 && observations.every(x=>x.proxy_path_verified), rotating: ips.length > 1,
    reason:options.offline?'离线模式':ips.length>1?'多个回显源观测到不同出口':independent<2?'独立回显来源不足，未核实稳定出口':'' };
}

async function discoverIP(options = {}) {
  const [v4, v6] = await Promise.all([discoverFamily(4, options), discoverFamily(6, options)]);
  return { v4, v6 };
}

function asnNumber(value) {
  const m = String(value || '').match(/^(?:AS)?(\d+)(?:\s|$)/i);
  return m ? Number(m[1]) : null;
}

function ownerInference(owner) {
  if (/\b(?:hosting|datacenter|data center|cloud|digitalocean|hetzner|ovh|vultr|linode|amazon|cloudflare)\b/i.test(owner)) return 'hosting';
  if (/\b(?:mobile|wireless|cellular)\b/i.test(owner)) return 'mobile';
  if (/\b(?:telecom|telecommunications|comcast|broadband|unicom|verizon|communications|cable)\b/i.test(owner)) return 'isp';
  return 'unknown';
}

function inferAttribute(records) {
  const claims = [];
  const labels = { hosting: '机房/云网络倾向', mobile: '移动网络倾向', isp: '运营商网络（住宅/企业/机房未定）', residential: '住宅倾向（库标注）', unknown: '未知' };
  for (const record of records.filter(x => x.status === 'ok')) {
    const owner = record.owner || '';
    const first = ownerInference(owner);
    if (first !== 'unknown') claims.push({ method: 'ASN 所有者名称', source: record.source, type: first, evidence: owner });
    const asn = record.asn;
    for (const type of ['hosting', 'mobile', 'isp']) {
      if (asnTypes[type][asn]) claims.push({ method: 'ASN 映射复核', source: `内置映射 ${asnTypes.updated}`, type, evidence: `AS${asn} ${asnTypes[type][asn]}` });
    }
    const rawType = String(record.companyType || '').toLowerCase();
    const type = /hosting|datacenter/.test(rawType) ? 'hosting' : /residential/.test(rawType) ? 'residential' : /mobile/.test(rawType) ? 'mobile' : /isp/.test(rawType) ? 'isp' : 'unknown';
    if (type !== 'unknown') claims.push({ method: '公开库网络类型', source: record.source, type, evidence: rawType });
  }
  const asns = [...new Set(records.filter(x => x.status === 'ok' && x.asn).map(x => x.asn))];
  const types = [...new Set(claims.map(c => c.type))];
  const conflict = asns.length > 1 || types.includes('hosting') && types.some(t => ['residential','mobile','isp'].includes(t));
  const type = conflict ? 'unknown' : types.includes('hosting') ? 'hosting' : types.includes('residential') ? 'residential' : types.includes('mobile') ? 'mobile' : types.includes('isp') ? 'isp' : 'unknown';
  const uniqueClaims = claims.filter((c,i) => claims.findIndex(x => x.method === c.method && x.source === c.source && x.evidence === c.evidence) === i);
  return { type, label: conflict ? '来源存在分歧，属性待定' : labels[type], conflict, asns, claims: uniqueClaims, confidence: conflict || !claims.length ? '低' : '参考', note: asnTypes.note };
}

function parseIPAPI(data, ip) {
  if (data.error || !sameIP(data.ip, ip)) throw new Error('公开库拒绝查询或返回其他 IP');
  const asn = typeof data.asn === 'object' ? data.asn : {};
  const company = typeof data.company === 'object' ? data.company : {};
  const flags = {};
  for (const field of ['is_abuser','is_tor','is_proxy','is_vpn','is_datacenter','is_bogon']) {
    if (typeof data[field] === 'boolean') flags[field] = data[field];
  }
  return { source: 'ipapi.is', status: 'ok', asn: asnNumber(asn.asn || data.asn), owner: asn.org || company.name || data.company || '',
    companyType: company.type || asn.type || '', country: data.location?.country || data.country || '', city: data.location?.city || data.city || '', flags };
}

async function lookupDatabase(ip, options = {}) {
  return require('./providers').lookupIdentity(ip,options);
}

// Retained parser/inference helpers support v2 report consumers. Active lookups use
// the independent, cached provider adapters above, never these owner-name heuristics.
function summarizeRouting(data, prefix, windowStart, windowEnd) {
  const asUTC = value => new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`).getTime();
  const from = windowStart ? asUTC(windowStart) : -Infinity;
  const until = windowEnd ? asUTC(windowEnd) : Infinity;
  const origins = [];
  for (const origin of data.by_origin || []) {
    for (const item of origin.prefixes || []) {
      if (item.prefix !== prefix || !Array.isArray(item.timelines) || !item.timelines.length) continue;
      // Enforce the requested window locally too: a provider/cache can return its full history.
      const timelines = item.timelines.filter(t => t.starttime && t.endtime && asUTC(t.endtime) >= from && asUTC(t.starttime) <= until);
      if (!timelines.length) continue;
      const first = Math.max(from, Math.min(...timelines.map(t => asUTC(t.starttime))));
      const last = Math.min(until, Math.max(...timelines.map(t => asUTC(t.endtime))));
      origins.push({ asn: asnNumber(origin.origin), prefix, firstSeenInWindow: new Date(first).toISOString(),
        lastSeenInWindow: new Date(last).toISOString(), intervals: timelines.length });
    }
  }
  return { origins, originCount: new Set(origins.map(x => x.asn)).size, start: windowStart || data.query_starttime, end: windowEnd || data.query_endtime,
    providerWindow: { start: data.query_starttime, end: data.query_endtime } };
}

async function lookupHistory(ip, database, options = {}) {
  if (!isPublicIP(ip)) return { status: 'untested', reason: '没有有效公网 IP' };
  const end = new Date(), start = new Date(end.getTime() - 90 * 86400000);
  const [registration, routing] = await Promise.all([
    (async () => {
      try {
        const d=database.records?.find(r=>r.kind==='rdap'&&r.status==='ok');
        if(!d)throw new Error('没有匹配目标地址的官方 RIR RDAP 结果');
        return { ...d, note:'网段注册/修改事件，不能等同于该 IP 的使用和滥用历史' };
      } catch (error) { return { status: 'untested', reason: error.message }; }
    })(),
    (async () => {
      try {
        const prefix = database.records?.find(r => r.source === 'RIPE RIS' && r.status === 'ok')?.prefix;
        if (!prefix) throw new Error('没有已验证的当前宣告前缀');
        const params = new URLSearchParams({ resource: prefix, starttime: start.toISOString(), endtime: end.toISOString(), min_peers: '10' });
        const d = await jsonRequest(`https://stat.ripe.net/data/routing-history/data.json?${params}`, { ...options, timeout: 18000 });
        if (d.status !== 'ok' || !Array.isArray(d.data?.by_origin)) throw new Error('RIPE 历史响应无效');
        const summary = summarizeRouting(d.data, prefix, start.toISOString(), end.toISOString());
        return { status: summary.origins.length ? 'ok' : 'untested', reason: summary.origins.length ? '' : '窗口内无精确前缀记录', source: 'RIPE RIS', days: 90, prefix, ...summary,
          note: '仅比较当前精确前缀近 90 天 BGP 起源；多起源不直接等同劫持或滥用。' };
      } catch (error) { return { status: 'untested', reason: error.message }; }
    })()
  ]);
  return { status: registration.status === 'ok' || routing.status === 'ok' ? 'ok' : 'untested', registration, routing };
}

module.exports = { IP_ENDPOINTS, discoverFamily, discoverIP, asnNumber, inferAttribute, parseIPAPI, lookupDatabase, summarizeRouting, lookupHistory };
