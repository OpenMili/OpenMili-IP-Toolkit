'use strict';
const os = require('node:os');
const net = require('node:net');
const dns = require('node:dns');
const fs = require('node:fs/promises');
const { runProcess } = require('./transport');
const { isPublicIP, canonicalIP } = require('./core');
const { state } = require('./status');
function addressType(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number);
    if (a === 100 && b >= 64 && b <= 127) return 'shared-cgnat';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    return isPublicIP(ip) ? 'global' : 'private-or-reserved';
  }
  if (ip === '::1') return 'loopback';
  if (/^f[cd]/i.test(ip)) return 'unique-local';
  if (/^fe[89ab]/i.test(ip)) return 'link-local';
  return isPublicIP(ip) ? 'global' : 'reserved';
}
function bindSource(options, interfaces = os.networkInterfaces()) {
  if (!options.interface && !options.sourceIP) return '';
  if (options.proxy) throw new Error('来源地址/网卡不能和代理同时指定；不会静默忽略绑定');
  const entries = Object.entries(interfaces).flatMap(([name,addresses]) => (addresses || []).map(a => ({ ...a, name })));
  let candidates = entries;
  if (options.interface) candidates = candidates.filter(a => a.name === options.interface);
  if (options.sourceIP) candidates = candidates.filter(a => canonicalIP(a.address) === canonicalIP(options.sourceIP));
  candidates = candidates.filter(a => net.isIP(a.address) === options.family);
  if (!candidates.length) throw new Error('指定网卡/来源 IP 不存在或协议族不匹配；已停止，未回退默认出口');
  return candidates[0].address;
}
async function inspectSystem(options = {}) {
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name,addresses]) => (addresses || []).map(a => ({
    name, address: a.address, family: net.isIP(a.address), internal: a.internal, cidr: a.cidr,
    type: addressType(a.address), privacy_address: 'unknown'
  })));
  const environment = [];
  if (/microsoft/i.test(os.release())) environment.push({ type: 'WSL', evidence: os.release() });
  if (await fs.stat('/.dockerenv').then(() => true).catch(() => false)) environment.push({ type: 'container', evidence: '/.dockerenv exists' });
  let commands;
  if (process.platform === 'win32') commands = [['powershell.exe',['-NoProfile','-NonInteractive','-Command', '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @{routes=@(Get-NetRoute -DestinationPrefix "0.0.0.0/0","::/0" | Select-Object InterfaceAlias,InterfaceIndex,NextHop,RouteMetric); interfaces=@(Get-NetIPInterface | Select-Object InterfaceAlias,InterfaceIndex,AddressFamily,NlMtu,InterfaceMetric); dns=@(Get-DnsClientServerAddress | Select-Object InterfaceAlias,AddressFamily,ServerAddresses); search=@((Get-DnsClientGlobalSetting).SuffixSearchList)} | ConvertTo-Json -Depth 5']]];
  else if (process.platform === 'linux') commands = [['ip',['-j','route','show','default']],['ip',['-j','-6','route','show','default']],['ip',['-j','link','show']]];
  else commands = [['route',['-n','get','default']],['scutil',['--dns']]];
  const details = await Promise.all(commands.map(async ([cmd,args]) => {
    const r = await runProcess(cmd,args,{ timeout:5000, signal:options.signal, maxOutput:128*1024 });
    if (r.error || r.code !== 0) return state('unknown','SYSTEM_DETAILS_UNAVAILABLE',r.error || r.stderr.trim(),{ command:cmd });
    let data; try { data = JSON.parse(r.stdout); } catch { data = r.stdout.trim(); }
    return state('success','SYSTEM_DETAILS','从系统只读获取',{ command:cmd, data });
  }));
  let resolvConf;
  if (process.platform !== 'win32') resolvConf = await fs.readFile('/etc/resolv.conf','utf8').then(s => s.split('\n').filter(l => /^\s*(?:nameserver|search|domain)\s/.test(l))).catch(() => undefined);
  return state('success','SYSTEM_INSPECTED','系统只读检查完成；无法取得的字段保留 unknown',{
    os:os.type(), release:os.release(), arch:os.arch(), hostname:os.hostname(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    node:process.versions.node, interfaces, dns_servers:dns.getServers(), resolver_config:resolvConf, details, environment,
    cgnat:interfaces.some(a => a.type === 'shared-cgnat') ? '发现共享地址空间：CGNAT 迹象，尚不能确认' : '未发现共享接口地址；不能排除上级 CGNAT'
  });
}
module.exports = { addressType, bindSource, inspectSystem };
