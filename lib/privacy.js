'use strict';
const net = require('node:net');
const SECRET = /^(?:set-cookie|cookie|authorization|proxy-authorization|key|.*(?:api[_-]?key|token|password|passwd|secret|session[_-]?id))$/i;
const SAFE_HEADERS = new Set(['cf-mitigated','content-type','location','retry-after','server','date','x-cache','via','content-length','cf-ray']);
const SECRET_PARAM = /^(?:key|api[_-]?key|token|access_token|refresh_token|password|secret|signature|sig|code|session(?:id)?)$/i;
function hideIP(ip) {
  return net.isIP(ip) === 4 ? ip.split('.').slice(0,2).join('.') + '.x.x' : net.isIP(ip) === 6 ? ip.split(':').slice(0,2).join(':') + ':…' : ip;
}
function sanitizeText(value, { secrets = [], redact = false, hostnames = [] } = {}) {
  let text = String(value);
  for (const secret of secrets.filter(x => typeof x === 'string' && x.length > 2)) {
    text = text.split(secret).join('[redacted]');
    text = text.split(encodeURIComponent(secret)).join('[redacted]');
  }
  text = text.replace(/\b(?:https?|socks5h?):\/\/[^\s<>"']+/gi, candidate => {
    try {
      const u = new URL(candidate);
      if (u.username || u.password) { u.username = 'redacted'; u.password = 'redacted'; }
      for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, '[redacted]');
      if (u.hash && /token|secret|session|password|key=/i.test(u.hash)) u.hash = '[redacted]';
      return u.href;
    } catch { return candidate; }
  });
  text = text.replace(/((?:set-cookie|cookie|authorization|proxy-authorization|x-api-key)\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|session(?:id)?)\s*[=:]\s*)[^\s,;<>"']+/gi, '$1[redacted]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/g, '[redacted]');
  // Terminal control sequences from remote pages must never reach the user's terminal.
  text = text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  if (redact) {
    for (const host of hostnames.filter(Boolean)) text = text.split(host).join('[host]');
    text = text.replace(/(?:\d{1,3}\.){3}\d{1,3}/g, hideIP)
      .replace(/(?:[a-f\d]{0,4}:){2,}[a-f\d:]{0,39}(?:%\w+)?/gi, candidate => net.isIP(candidate) ? hideIP(candidate) : candidate);
  }
  return text;
}
function sanitize(value, options = {}) {
  if (Array.isArray(value)) return value.map(x => sanitize(x, options));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k,v] of Object.entries(value)) {
      if (k.toLowerCase() === 'headers' && v && typeof v === 'object') {
        result[k] = Object.fromEntries(Object.entries(v).filter(([h])=>SAFE_HEADERS.has(h.toLowerCase())).map(([h,x])=>[h,sanitize(x,options)]));
      } else result[k] = SECRET.test(k) ? '[redacted]' : sanitize(v, options);
    }
    return result;
  }
  return typeof value === 'string' ? sanitizeText(value, options) : value;
}
function environmentSecrets(env = process.env) {
  return Object.entries(env).filter(([k]) => /(?:TOKEN|API_KEY|PASSWORD|SECRET)/i.test(k)).map(([,v]) => v);
}
module.exports = { sanitize, sanitizeText, hideIP, environmentSecrets };
