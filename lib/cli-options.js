'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { parseDocument } = require('yaml');
const { validHost } = require('./port');
const COMMANDS = ['all','ip','dns','identity','reputation','lookup','port','route','websites','doctor','score'];
const HELP = `OpenMili-IP-Toolkit | Node.js 20+ | Windows / Linux / macOS
用法: openmili-ip [all|ip|dns|identity|reputation|lookup|port|route|websites|doctor] [选项]
  lookup --ip 8.8.8.8                只查询公开库，不进行网站/路由检测
  port --host example.org --port 443 [--tls] [--samples 3]
  all --proxy socks5h://127.0.0.1:1080   实测代理出口
  ip --ipv4 / ip --ipv6              系统环境与真实出口
  --interface NAME / --source-ip IP  严格绑定，失败停止
  --config FILE                     YAML 配置（命令行优先）
  --json --output FILE.json          stdout 仅 JSON，并保存报告
  --plain --language zh-CN|en        纯文本/语言
  --redact --offline --yes --no-install --no-pause
  --timeout 12 --concurrency 3 --retries 1
  dns --dns-host example.org --resolver 1.1.1.1 --dns-protocols udp,tcp,doh
  --dot-servername cloudflare-dns.com --doh-url https://dns.google/resolve
  --cache-dir DIR --refresh --community-sources --no-dns
  route --ipv6 --route-protocols auto --isp all --region beijing,shanghai,guangzhou
  websites --mode http|browser       分类规则、预期页面及最终站点核验
  score --input report.json         离线重放评分，不请求网络
  --scoring FILE.json               五维权重/阈值配置
兼容旧参数 --urls --limit --no-browser --no-routes --no-history
旧 --port N 表示本地代理端口；port 子命令表示目标 TCP 端口。`;
function number(value,name,min,max) {
  if (!/^\d+$/.test(String(value)) || +value < min || +value > max) throw new Error(`${name} 必须为 ${min}–${max} 的整数`);
  return +value;
}
function configArgs(file) {
  if (fs.statSync(file).size > 102400) throw new Error('配置文件不能超过 100 KiB');
  const d = parseDocument(fs.readFileSync(file,'utf8'),{uniqueKeys:true});
  if (d.errors.length) throw new Error(`配置 YAML 错误: ${d.errors[0].message}`);
  const c = d.toJS({maxAliasCount:0});
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('配置必须是对象');
  const flags = new Set(['plain','json','redact','offline','yes','no-install','no-browser','no-routes','no-history','no-lookup','skip-ip','no-pause','ignore-env-proxy','refresh','ipv4','ipv6','tls','community-sources','no-dns']);
  const values = new Set(['proxy','family','timeout','concurrency','retries','language','output','urls','limit','interface','source-ip','mode','min-delay','max-delay','browser-path','dns-host','resolver','dns-protocols','doh-url','dot-servername','cache-dir','route-protocols','isp','region','max-hops','route-timeout','origin-country','scoring']);
  return Object.entries(c).flatMap(([key,value]) => {
    if (flags.has(key) && typeof value === 'boolean') return value ? [`--${key}`] : [];
    if (values.has(key) && ['string','number'].includes(typeof value)) return [`--${key}`,String(value)];
    throw new Error(`未知或无效配置字段: ${key}`);
  });
}
function readOptions(args, legacyParser) {
  let command = 'all';
  args = [...args];
  if (args[0] && !args[0].startsWith('-')) {
    command = args.shift(); if (!COMMANDS.includes(command)) throw new Error(`未知子命令: ${command}`);
  }
  const configIndex = args.indexOf('--config');
  if (configIndex >= 0) {
    if (!args[configIndex+1] || args[configIndex+1].startsWith('--')) throw new Error('--config 缺少文件');
    const file = path.resolve(args[configIndex+1]); args.splice(configIndex,2);
    args = [...configArgs(file),...args];
  }
  const extra = { command, plain:false, json:false, offline:false, retries:1, concurrency:3, language:'zh-CN', samples:1 };
  const flags = {'--plain':'plain','--json':'json','--redact':'redact','--offline':'offline','--yes':'yes','--refresh':'refresh','--ignore-env-proxy':'ignoreEnvProxy','--tls':'tls','--community-sources':'communitySources','--no-dns':'noDNS'};
  const values = {'--ip':'lookupIP','--host':'host','--interface':'interface','--source-ip':'sourceIP','--samples':'samples','--concurrency':'concurrency','--retries':'retries','--language':'language','--dns-host':'dnsHost','--resolver':'resolver','--dns-protocols':'dnsProtocols','--doh-url':'dohURL','--dot-servername':'dotServername','--cache-dir':'cacheDir','--route-protocols':'routeProtocols','--isp':'isp','--region':'region','--max-hops':'maxHops','--route-timeout':'routeTimeout','--origin-country':'originCountry','--scoring':'scoring','--input':'input'};
  const legacy = [];
  let v4=false,v6=false;
  for (let i=0;i<args.length;i++) {
    const a=args[i];
    if(command==='websites'&&a==='--mode'){
      const value=args[++i];if(!['http','browser'].includes(value))throw new Error('websites --mode 必须为 http 或 browser');
      extra.browser=value==='browser';continue;
    }
    if (flags[a]) { extra[flags[a]]=true; continue; }
    if (a === '--ipv4' || a === '--ipv6') { if(a === '--ipv4') v4=true; else v6=true; continue; }
    if (a === '--no-install') { extra.noInstall=true; legacy.push('--no-install-browser'); continue; }
    if (values[a] || command === 'port' && a === '--port') {
      if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${a} 缺少参数`);
      extra[values[a] || 'targetPort'] = args[++i]; continue;
    }
    legacy.push(a);
  }
  if (v4 && v6) throw new Error('--ipv4 和 --ipv6 不能同时使用');
  if (v4 || v6) {
    const i=legacy.indexOf('--family');
    if (i >= 0 && legacy[i+1] !== (v6?'6':'4')) throw new Error('IP 协议族参数冲突');
    legacy.push('--family',v6?'6':'4');
  }
  if (extra.lookupIP) legacy.push('--lookup-ip',extra.lookupIP);
  if (legacy.includes('--lookup-ip') || command === 'lookup') legacy.push('--only-lookup');
  const o={...legacyParser(legacy),...extra};
  o.modeExplicit=legacy.includes('--mode');
  if (o.help) return o;
  if(o.command==='score'&&!o.input)throw new Error('score 必须指定 --input report.json');
  if(o.input&&o.command!=='score')throw new Error('--input 仅适用于 score');
  if(o.offline&&o.refresh)throw new Error('--offline 与 --refresh 不能同时使用');
  if (o.lookupIP) { o.command='lookup'; o.onlyLookup=true; }
  if (o.command === 'lookup' && !o.lookupIP) throw new Error('lookup 必须指定 --ip 公网地址');
  if (o.sourceIP && !net.isIP(o.sourceIP)) throw new Error('source-ip 必须为本机 IP 地址');
  if (o.interface && /[\x00-\x1f]/.test(o.interface)) throw new Error('无效网卡名称');
  if (!['zh-CN','en'].includes(o.language)) throw new Error('language 只能为 zh-CN 或 en');
  o.samples=number(o.samples,'samples',1,10); o.concurrency=number(o.concurrency,'concurrency',1,8); o.retries=number(o.retries,'retries',0,3);
  if(o.resolver)require('./dns').resolverAddress(o.resolver);
  if(o.dnsHost)validHost(o.dnsHost);
  if(o.dotServername)validHost(o.dotServername);
  if(o.dnsProtocols){o.dnsProtocols=o.dnsProtocols.split(',');if(!o.dnsProtocols.length||o.dnsProtocols.some(p=>!['udp','tcp','doh','dot'].includes(p)))throw new Error('dns-protocols 只能为 udp,tcp,doh,dot');}
  if(o.dohURL){const u=new URL(o.dohURL);if(u.protocol!=='https:'||u.username||u.password)throw new Error('doh-url 必须是无凭据 HTTPS URL');}
  if(o.routeProtocols){o.routeAuto=o.routeProtocols==='auto';o.routeProtocols=o.routeAuto?['icmp','tcp','udp']:o.routeProtocols.split(',');if(o.routeProtocols.some(p=>!['icmp','tcp','udp'].includes(p)))throw new Error('route-protocols 必须是 auto 或 icmp,tcp,udp');}
  if(o.isp&&!['all','telecom','unicom','mobile'].includes(o.isp))throw new Error('isp 必须是 all/telecom/unicom/mobile');
  if(o.region){o.region=o.region.split(',');if(o.region.some(r=>!['beijing','shanghai','guangzhou'].includes(r)))throw new Error('region 必须是 beijing,shanghai,guangzhou');}
  if(o.maxHops)o.maxHops=number(o.maxHops,'max-hops',1,40);
  if(o.routeTimeout)o.routeTimeout=number(o.routeTimeout,'route-timeout',1,120)*1000;
  if(o.originCountry&&!/^[A-Z]{2}$/.test(o.originCountry))throw new Error('origin-country 必须是两个大写字母；该信息仅作为用户声明');
  if (command === 'port') {
    validHost(o.host); o.targetPort=number(o.targetPort,'port',1,65535);
    if (o.lookupIP) throw new Error('port 与查询 IP 不能混用');
  } else if (o.host || o.targetPort || o.tls) throw new Error('host/目标 port/tls 仅适用于 port 子命令');
  if (/\.json$/i.test(o.output)) { o.outputFile=o.output; o.output=path.dirname(o.output); }
  if (['ip','identity','reputation'].includes(o.command)) { o.onlyLookup=true; o.history=false; }
  if(o.command==='websites'){o.routes=false;o.history=false;o.lookup=false;o.noDNS=true;}
  if (o.json || o.yes || o.offline || o.command !== 'all') o.noPause=true;
  if (o.mode === 'auto' && (o.noPause || o.command !== 'all')) o.mode=o.proxy?'proxy':'direct';
  if (o.onlyLookup && o.lookupIP && (o.interface || o.sourceIP)) throw new Error('lookup 查询目标不能绑定为本机来源地址');
  return o;
}
module.exports = { COMMANDS, HELP, readOptions };
