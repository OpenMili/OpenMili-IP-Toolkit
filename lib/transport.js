'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validUrl,sameIP } = require('./core');
const { proxyForURL } = require('./proxy-config');

function runProcess(command, args, { timeout = 20000, maxOutput = 2 * 1024 * 1024, env = process.env, signal } = {}) {
  if (signal?.aborted) return Promise.resolve({code:null,stdout:'',stderr:'',error:'ABORTED'});
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, shell: false, env });
    let stdout = '', stderr = '', bytes = 0, failure = '';
    const timer = setTimeout(() => { failure = '进程超时'; child.kill(); }, timeout);
    const abort = () => { failure = 'ABORTED'; child.kill(); };
    signal?.addEventListener('abort',abort,{once:true});
    const collect = which => data => {
      bytes += data.length;
      if (bytes > maxOutput) { failure = '输出超过大小上限'; child.kill(); return; }
      if (which === 'stdout') stdout += data.toString(); else stderr += data.toString();
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('error', error => { failure = error.message; });
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort',abort); resolve({ code, stdout, stderr, error: failure }); });
  });
}

function finalHeaders(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).filter(x => /^HTTP\//.test(x));
  const headers = {};
  for (const line of (blocks.at(-1) || '').split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':'); if (i > 0) headers[line.slice(0,i).toLowerCase()] = line.slice(i+1).trim();
  }
  return headers;
}

async function request(url, options = {}) {
  validUrl(url);
  if (options.offline || options.signal?.aborted) return {status:0,finalUrl:url,body:'',headers:{},duration:0,error:options.offline?'OFFLINE':'ABORTED'};
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'openmili-'));
  const bodyPath = path.join(temp, 'body'), headerPath = path.join(temp, 'headers');
  const maxBytes = options.maxBytes || 2 * 1024 * 1024;
  const timeout = options.timeout || 10000;
  try {
    const selectedProxy=proxyForURL(url,options);
    const args = ['-q', '--silent', '--show-error', '--location', '--max-redirs', '6', '--proto', '=http,https', '--proto-redir', '=http,https', '--connect-timeout', '5', '--max-time', String(timeout / 1000), '--max-filesize', String(maxBytes), '--compressed'];
    if (selectedProxy.proxy) args.push('--noproxy', '', '--proxy', selectedProxy.proxy);
    else args.push('--noproxy', '*', '--proxy', '');
    if (options.family) args.push(`-${options.family}`);
    if (options.sourceIP) args.push('--interface',options.sourceIP);
    args.push('--user-agent', options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36', '--header', 'Accept-Language: en-US,en;q=0.9', '--header', 'Accept: text/html,application/json;q=0.9,*/*;q=0.8');
    for (const header of options.headers || []) args.push('--header', header);
    args.push('--dump-header', headerPath, '--output', bodyPath, '--write-out', '%{http_code}\n%{url_effective}\n%{time_total}\n%{remote_ip}\n%{local_ip}', '--url', url);
    const result = await runProcess(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { timeout: timeout + 2000, signal:options.signal });
    const [code, finalUrl, elapsed, remoteIP, localIP] = result.stdout.trim().split(/\r?\n/);
    const bindingMismatch=Boolean(options.sourceIP&&result.code===0&&!sameIP(localIP,options.sourceIP));
    const bodySize = await fs.stat(bodyPath).then(s => s.size).catch(() => 0);
    const read = async file => {
      try { const stat = await fs.stat(file); if (stat.size > maxBytes) return ''; return await fs.readFile(file, 'utf8'); } catch { return ''; }
    };
    return { status: Number(code) || 0, finalUrl: finalUrl || url, duration: Math.round((Number(elapsed) || 0) * 1000), remoteIP, localIP, proxyBypassed:selectedProxy.bypassed,
      bindingVerified:options.sourceIP ? sameIP(localIP,options.sourceIP) : undefined,
      body: await read(bodyPath), headers: finalHeaders(await read(headerPath)),
      transport_code:bindingMismatch?'BINDING_VERIFICATION_FAILED':result.code===0?'HTTP_RESPONSE':({5:'PROXY_DNS_FAILED',6:'DNS_FAILED',7:'TCP_CONNECT_FAILED',28:'NETWORK_TIMEOUT',35:'TLS_HANDSHAKE_FAILED',51:'TLS_CERTIFICATE_FAILED',60:'TLS_CERTIFICATE_FAILED',63:'RESPONSE_TOO_LARGE'}[result.code]||'NETWORK_FAILED'),
      tls_verified:!bindingMismatch&&!result.error&&result.code===0&&new URL(finalUrl||url).protocol==='https:',
      error:bindingMismatch?'实际来源地址与绑定配置不符，拒绝归因':bodySize > maxBytes ? '响应超过采集大小上限' : result.error || (result.code !== 0 ? `curl ${result.code}: ${result.stderr.slice(0,300)}` : '') };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

async function jsonRequest(url, options = {}) {
  const response = await request(url, options);
  if (response.error || response.status < 200 || response.status >= 300) throw new Error(response.error || `HTTP ${response.status}`);
  return JSON.parse(response.body);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; results[i] = await fn(items[i], i); }
  }));
  return results;
}

module.exports = { runProcess, request, jsonRequest, finalHeaders, mapLimit };
