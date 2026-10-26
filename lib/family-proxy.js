'use strict';
const http = require('node:http');
const net = require('node:net');

// Chromium has no reliable switch for forcing a single address family. A loopback-only
// CONNECT bridge pins DNS/TCP to that family without inspecting or terminating TLS.
async function startFamilyProxy(family, options = {}) {
  const sockets = new Set(), peers = new Map();
  const track = socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  const hostOf = url => url.hostname.replace(/^\[|\]$/g, '');
  const validHost = host => !net.isIP(host) || net.isIP(host) === family;
  const keyOf = (host, port) => `${host}:${port}`;
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    const host = hostOf(url), port = Number(url.port || 80);
    if (url.protocol !== 'http:' || !validHost(host)) { res.writeHead(502).end(); return; }
    const headers = { ...req.headers, host: url.host };
    delete headers['proxy-connection']; delete headers['proxy-authorization'];
    const upstream = http.request({ hostname: host, port, family, path: url.pathname + url.search,
      method: req.method, headers, agent: false, timeout: 12000, ...(options.sourceIP ? {localAddress:options.sourceIP} : {}) }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('socket', socket => {
      track(socket);
      socket.on('connect', () => peers.set(keyOf(host, port), socket.remoteAddress));
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (req, client, head) => {
    let url;
    try { url = new URL(`http://${req.url}`); } catch { client.destroy(); return; }
    const host = hostOf(url), port = Number(url.port || 443);
    if (!validHost(host)) { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    const upstream = track(net.connect({ host, port, family, ...(options.sourceIP ? {localAddress:options.sourceIP} : {}) }));
    upstream.setTimeout(12000, () => upstream.destroy());
    upstream.once('connect', () => {
      peers.set(keyOf(host, port), upstream.remoteAddress);
      upstream.setTimeout(30000);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    upstream.once('error', () => { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
    upstream.once('close', () => client.destroy()); client.once('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let closed = false;
  return { family, server: `http://127.0.0.1:${server.address().port}`,
    remoteFor(value) { const url = new URL(value); return peers.get(keyOf(hostOf(url), Number(url.port || (url.protocol === 'https:' ? 443 : 80)))) || ''; },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    } };
}

module.exports = { startFamilyProxy };
