'use strict';
const net = require('node:net');
const { parseDocument } = require('yaml');

const LABELS = {
  reachable: '服务可达', login: '需要登录', challenge: 'CF 浏览器盾', captcha: '人机验证',
  restricted: '访问受限', region: '地区限制', 'rate-limit': '请求限流',
  empty: '响应为空', 'js-required': '需要 JavaScript', network: '网络错误',
  'http-error': '服务异常', untested: '未测试', redirect: '重定向未完成'
};
const FACTORS = { reachable: 1, login: 0.65, challenge: 0, captcha: 0.2, restricted: 0,
  region: 0, 'rate-limit': 0.25, empty: 0, 'js-required': null, network: 0,
  'http-error': 0, untested: null, redirect: 0 };

function canonicalIP(value) {
  const family = net.isIP(value);
  if (family === 6) return new URL(`http://[${value.split('%')[0]}]/`).hostname.slice(1,-1);
  return family === 4 ? value : '';
}

function sameIP(a, b) {
  return Boolean(canonicalIP(a) && canonicalIP(a) === canonicalIP(b));
}

function validUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error('URL 必须是无凭据的 HTTP/HTTPS 地址');
  }
  return url.href;
}

function parseTargets(source) {
  if (Buffer.byteLength(source) > 102400) throw new Error('目标清单不能超过 100 KiB');
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`YAML 格式错误: ${doc.errors[0].message}`);
  const data = doc.toJS({ maxAliasCount: 0 });
  if (!data || Object.keys(data).some(k=>!['domains','version','updated_at','expires_at'].includes(k)) || !Array.isArray(data.domains)) throw new Error('清单需要 domains 数组与有效元数据');
  for(const key of ['updated_at','expires_at'])if(data[key]!==undefined && (typeof data[key]!=='string'||!Number.isFinite(Date.parse(data[key]))))throw new Error(`清单 ${key} 必须是 ISO 日期`);
  if(data.version!==undefined && (typeof data.version!=='string'||data.version.length>100))throw new Error('清单 version 必须为字符串');
  const seen = new Set();
  const targets = [];
  for (const item of data.domains) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || /[\x00-\x1f\x7f]/.test(item.name) || typeof item.url !== 'string' || Object.keys(item).some(k => !['name','url','weight','category','allowed_hosts','expected_text','timeout','rule_version','updated_at','expires_at','notes'].includes(k))) throw new Error('目标必须包含有效 name 和 url 与合法规则字段');
    const url = validUrl(item.url);
    if (item.weight !== undefined && (!Number.isFinite(item.weight) || item.weight < 1 || item.weight > 3)) throw new Error('weight 必须介于 1 和 3');
    if(item.category!==undefined&&!['AI','search','developer','social','video','mail','general','academic','finance'].includes(item.category))throw new Error('未知网站分类');
    for(const key of ['allowed_hosts','expected_text'])if(item[key]!==undefined&&(!Array.isArray(item[key])||item[key].length>20||item[key].some(x=>typeof x!=='string'||!x.trim()||x.length>500)))throw new Error(`无效网站规则 ${key}`);
    if(item.allowed_hosts)for(const host of item.allowed_hosts)require('./port').validHost(host);
    if(item.timeout!==undefined&&(!Number.isFinite(item.timeout)||item.timeout<1||item.timeout>120))throw new Error('站点 timeout 必须为 1–120 秒');
    for(const key of ['updated_at','expires_at'])if(item[key]!==undefined&&(typeof item[key]!=='string'||!Number.isFinite(Date.parse(item[key]))))throw new Error('规则时间无效');
    if (!seen.has(url)) { targets.push({ ...item,name:item.name.trim(),url,weight:item.weight||1,category:item.category||'general',rule_version:item.rule_version||data.version||'legacy',updated_at:item.updated_at||data.updated_at||null,expires_at:item.expires_at||data.expires_at||null }); seen.add(url); }
  }
  if (!targets.length) throw new Error('清单没有可检测目标');
  return targets;
}

function normalizeProxy(value) {
  if (/^\d+$/.test(value)) value = `http://127.0.0.1:${value}`;
  if (!value.includes('://')) value = `http://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || url.pathname !== '' && url.pathname !== '/' || url.search || url.hash || /[\s\x00-\x1f\x7f]/.test(value)) throw new Error('代理格式错误，只支持 HTTP/HTTPS/SOCKS5');
  if (url.port === '0') throw new Error('代理端口必须在 1–65535 范围内');
  if (!url.port && !['http:', 'https:'].includes(url.protocol)) throw new Error('SOCKS5 代理必须指定端口');
  return url.href.replace(/\/$/, '');
}

function redactProxy(value) {
  if (!value) return '';
  const url = new URL(value);
  if (url.username || url.password) { url.username = '***'; url.password = '***'; }
  return url.href.replace(/\/$/, '');
}

function plainText(body) {
  return String(body || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function classify(response) {
  const { status = 0, error = '', finalUrl = '', headers = {}, dom = false, visibleCaptcha = false } = response;
  const raw = String(response.body || '');
  const title = response.title ?? plainText(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const text = dom ? raw : plainText(raw);
  const t = `${title} ${text}`;
  const result = (kind, evidence) => ({ kind, label: LABELS[kind], outcome:require('./status').websiteState(kind),code:response.transport_code && response.transport_code!=='HTTP_RESPONSE'?response.transport_code:kind.toUpperCase().replace(/-/g,'_'),checked_at:new Date().toISOString(),evidence, title: title.slice(0, 300), snippet: text.slice(0, 500) });
  if (/^curl 63:|大小上限/.test(error)) return result('untested', '响应超过采集大小上限；不据此认定 IP 被限制');
  if(['ABORTED','OFFLINE'].includes(error))return result('untested',error==='ABORTED'?'用户中止':'离线模式');
  if (error) return result('network', error);
  const rules=response.rules||{};
  if(rules.expires_at && Date.parse(rules.expires_at)<(response.now??Date.now()))return result('untested',`网站规则 ${rules.rule_version||''} 已过期；保留协议证据，不据旧规则判定成功`);
  if (response.requestUrl && finalUrl) {
    try {
      const normalize = value => new URL(value).hostname.replace(/^www\./,'').toLowerCase();
      const allowed = [normalize(response.requestUrl),...(response.allowedHosts || []).map(x=>x.replace(/^www\./,'').toLowerCase())];
      if (!allowed.includes(normalize(finalUrl))) return result('untested','最终站点不在目标或允许跳转域中，未证明目标网站可访问');
      if(new URL(response.requestUrl).protocol==='https:'&&new URL(finalUrl).protocol!=='https:')return result('redirect','HTTPS 目标重定向到明文 HTTP，未满足 TLS 终点条件');
    } catch { return result('untested','无法校验最终站点'); }
  }
  if (headers['cf-mitigated']?.toLowerCase() === 'challenge' || /^(just a moment|attention required!.*cloudflare|checking your browser)/i.test(title.trim()) || /performing security verification|verifying you are human.*(?:few seconds|wait)|checking if the site connection is secure/i.test(t)) return result('challenge', '响应头、标题或可见文字表明浏览器验证');
  if (status === 451 || /not available in your country|unavailable in (?:your |this )?(?:country|region)|only available in certain regions|unsupported (?:country|region)|geographic restriction|地区不支持|所在地区.*不可用/i.test(t) || /\/(?:unsupported|app[-_]?unavailable)(?:[/?#_-]|$)/i.test(finalUrl)) return result('region', 'HTTP 451、地区限制文字或地区限制跳转');
  if (visibleCaptcha || /(?:verify (?:that )?you (?:are|'re) (?:a )?human|complete the (?:security check|captcha)|unusual traffic from your computer network|请完成.*(?:验证码|人机验证)|验证您是真人)/i.test(t) || /\/sorry\/(?:index|challenge)/i.test(finalUrl)) return result('captcha', '当前页面显示人机验证');
  if (status === 429) return result('rate-limit', 'HTTP 429');
  if ([401, 407].includes(status)) return result('login', `HTTP ${status} 需要身份验证`);
  if (status === 403 || /^(access denied|request blocked|sorry, you have been blocked)/i.test(title)) return result('restricted', `HTTP ${status} 或阻断标题`);
  if (status >= 300 && status < 400) return result('redirect', `HTTP ${status} 没有完成跳转`);
  if (status < 200 || status >= 400) return result('http-error', `HTTP ${status}`);
  if (!raw.trim() || dom && !text.trim()) return result('empty', `HTTP ${status} 没有页面内容`);
  if (/enable javascript|javascript (?:is )?required|turn on javascript/i.test(t) && text.length < 2000) return result('js-required', '页面要求 JavaScript，等待浏览器实测');
  if (/\/(?:login|signin|sign-in)(?:[/?#]|$)/i.test(finalUrl) || /^(?:log ?in|sign ?in)(?:\s|[|–—-]|$)/i.test(title)) return result('login', '跳转登录页；尚未证明账户功能可用');
  if(rules.expected_text?.length&&!rules.expected_text.some(marker=>t.toLowerCase().includes(marker.toLowerCase())))return result('untested','未匹配站点预期页面标记，可能规则变化/维护页；不将 HTTP 200 算作成功');
  return result('reachable', dom ? '浏览器加载后可见内容，无已知拦截特征' : '非空 HTTP 成功响应，无已知拦截特征');
}

function scoreReport(report) {
  const components = [];
  const sites = report.sites || [];
  for (const [method, weight] of [['http', 30], ['browser', 40]]) {
    const total = sites.reduce((s, x) => s + x.weight, 0);
    let tested = 0, earned = 0;
    for (const site of sites) {
      const r = site[method];
      if (!r || r.identityMismatch || r.identityVerified === false || FACTORS[r.kind] == null) continue;
      tested += site.weight;
      earned += site.weight * FACTORS[r.kind];
    }
    components.push({ name: method, weight, earned: total ? weight * earned / total : 0,
      measured: total ? weight * tested / total : 0, testedWeight: tested, totalWeight: total });
  }
  const reputation = report.database?.reputation;
  const reputationCoverage = reputation?.tested ? reputation.coverage ?? 1 : 0;
  components.push({ name: 'reputation', weight: 20, earned: 20 * reputationCoverage * (1 - (reputation?.risk || 0)), measured: 20 * reputationCoverage });
  const routes = report.routes?.results || [];
  // ICMP silence is missing evidence; it does not prove bad routing or blacklist status.
  const observed = routes.filter(r => r.hops?.some(h=>h.ip)).length;
  const reached = routes.filter(r => r.reached).length;
  components.push({ name: 'routes', weight: 10, measured: routes.length ? 10 * observed / routes.length : 0,
    earned: routes.length ? routes.reduce((s, r) => s + (r.reached ? 1 : r.hops?.some(h=>h.ip) ? 0.5 : 0), 0) * 10 / routes.length : 0, observed, reached });
  const round = n => Math.round(n * 10) / 10;
  const earned = components.reduce((s, x) => s + x.earned, 0);
  const coverage = components.reduce((s, x) => s + x.measured, 0);
  const reference = coverage ? round(earned / coverage * 100) : null;
  const browser = components.find(c => c.name === 'browser');
  const enough = coverage >= 70 && sites.length >= 5 && browser.measured >= 20;
  return { model: 'v2-evidence', earned: round(earned), coverage: round(coverage),
    range: [round(earned), round(Math.min(100, earned + 100 - coverage))], reference,
    grade: !enough ? '证据不足' : reference >= 90 ? '优秀（本次样本）' : reference >= 75 ? '良好（本次样本）' : reference >= 55 ? '一般（本次样本）' : '受限较多（本次样本）',
    components: components.map(c => ({ ...c, earned: round(c.earned), measured: round(c.measured) })),
    note: '分值只适用于本次目标、出口和时间；未知项不计满分，住宅/机房类型不直接加减分；不代表登录、播放或绝对无风控。' };
}

function isPublicIP(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !([0,10,127].includes(a) || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 192 && b === 0 && [0,2].includes(c) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18,19].includes(b) || a === 198 && b === 51 && c === 100 || a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    return /^[23]/i.test(normalized) && !normalized.toLowerCase().startsWith('2001:db8:');
  }
  return false;
}

module.exports = { LABELS, FACTORS, canonicalIP, sameIP, validUrl, parseTargets, normalizeProxy, redactProxy, plainText, classify, scoreReport, isPublicIP };
