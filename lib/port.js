'use strict';
const net = require('node:net');
const tls = require('node:tls');
const { state } = require('./status');
function validHost(host) {
  if (typeof host !== 'string' || host.length > 253 || !host || /[\s/@?#\\\x00-\x1f]/.test(host)) throw new Error('host 必须是 IP 或有效域名');
  if (!net.isIP(host) && !host.split('.').every(x => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(x))) throw new Error('host 必须是 IP 或有效域名');
  return host;
}
function stats(values) {
  if (!values.length) return null;
  const a = [...values].sort((x,y) => x-y), round = x => Math.round(x*100)/100;
  return { min:round(a[0]), avg:round(a.reduce((s,x)=>s+x,0)/a.length), p95:round(a[Math.ceil(a.length*.95)-1]), samples:a.length };
}
async function probePort(options) {
  const { host, port, signal, sourceIP, family, timeout = 5000 } = options;
  validHost(host);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port 必须为 1–65535');
  const target = { host, port, endpoint:`${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`, protocol:options.tls ? 'tls' : 'tcp', family:net.isIP(host) || family || null, through_proxy:Boolean(options.proxy) };
  if (options.offline) return state('skipped','OFFLINE','离线模式不会连接目标',target);
  if (options.proxy) return state('skipped','PROXY_PORT_UNSUPPORTED','当前 TCP 诊断仅支持直接连接；不会绕过指定代理',target);
  if (signal?.aborted) return state('skipped','ABORTED','用户中止',target);
  return new Promise(resolve => {
    const start = performance.now();
    let tcpReady = false, socket, finished = false;
    const finish = result => {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort',abort);
      socket?.destroy(); resolve({ ...target,...result, latency_ms:Math.round((performance.now()-start)*100)/100 });
    };
    const abort = () => finish(state('skipped','ABORTED','用户中止'));
    const timer = setTimeout(() => finish(state('failure',tcpReady && options.tls ? 'TLS_TIMEOUT' : 'CONNECT_TIMEOUT',tcpReady ? 'TLS 握手超时' : 'TCP 连接超时')),timeout);
    const connect = { host,port, ...(family ? {family}:{}), ...(sourceIP ? {localAddress:sourceIP}:{}) };
    try {
      socket = options.tls ? tls.connect({ ...connect, rejectUnauthorized:true, ...(net.isIP(host) ? {} : {servername:host}) }) : net.connect(connect);
      signal?.addEventListener('abort',abort,{once:true});
      socket.once('connect',() => {
        tcpReady = true;
        if (!options.tls) finish(state('success','TCP_CONNECTED','TCP 可连接；未验证应用层功能',{ remote_ip:socket.remoteAddress, source_ip:socket.localAddress }));
      });
      if (options.tls) socket.once('secureConnect',() => {
        const cert = socket.getPeerCertificate();
        finish(state('success','TLS_CONNECTED','TCP 与可信 TLS 握手成功；未验证应用功能',{
          remote_ip:socket.remoteAddress, source_ip:socket.localAddress, tls_version:socket.getProtocol(), certificate:{ subject:cert.subject, issuer:cert.issuer, valid_from:cert.valid_from, valid_to:cert.valid_to, fingerprint256:cert.fingerprint256 }
        }));
      });
      socket.once('error',error => {
        const code = error.code === 'ECONNREFUSED' ? 'CONNECT_REFUSED' : ['ENOTFOUND','EAI_AGAIN','ENODATA'].includes(error.code) ? 'DNS_FAILED'
          : tcpReady && options.tls ? 'TLS_FAILED' : ['EADDRNOTAVAIL','EINVAL'].includes(error.code) ? 'SOURCE_BIND_FAILED' : 'CONNECT_FAILED';
        finish(state('failure',code,error.message,{ native_code:error.code, tcp_connected:tcpReady }));
      });
    } catch (error) { finish(state('failure','CONNECT_FAILED',error.message)); }
  });
}
async function diagnosePort(options) {
  const results = [];
  for (let i=0;i<(options.samples || 1);i++) {
    results.push(await probePort(options));
    if (options.signal?.aborted || ['skipped','unknown'].includes(results.at(-1).status)) break;
  }
  const successes = results.filter(r => r.status === 'success');
  return state(successes.length === results.length ? 'success' : successes.length ? 'limited' : results[0].status,'PORT_DIAGNOSIS',results[0].reason,{
    target:{host:options.host,port:options.port}, checks:results, latency:stats(successes.map(r=>r.latency_ms)),
    connection_success_percent:Math.round(successes.length/results.length*100), note:'样本是 TCP/TLS 连接，不是 ICMP 丢包率或服务完整可用性'
  });
}
module.exports = { validHost, stats, probePort, diagnosePort };
