#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { createInterface } = require('node:readline/promises');
const { parseTargets, normalizeProxy, redactProxy, classify, scoreReport, isPublicIP, canonicalIP } = require('../lib/core');
const { request, runProcess } = require('../lib/transport');
const { discoverIP, discoverFamily, lookupDatabase, lookupHistory } = require('../lib/identity');
const { parseRouteTargets } = require('../lib/routes');
const { measureRoutes:traceRoutes } = require('../lib/route-engine');
const { probeBrowserSites } = require('../lib/browser');
const { saveReport } = require('../lib/report');
const { readOptions, HELP:CLI_HELP } = require('../lib/cli-options');
const { bindSource, inspectSystem } = require('../lib/system');
const { diagnosePort } = require('../lib/port');
const { sanitizeText,environmentSecrets } = require('../lib/privacy');
const { EXIT } = require('../lib/status');
const { inspectDNS } = require('../lib/dns');
const { applyEnvironmentProxy } = require('../lib/proxy-config');
const TOOL_VERSION=require('../package.json').version;

function parseLegacyArgs(args) {
  const o = { mode: 'auto', proxy: '', limit: 0, timeout: 12000, family: 4, browser: false, installBrowser: true,
    routes: true, history: true, lookup: true, minDelay: 300, maxDelay: 500, browserWait: 1800,
    urls: path.join(__dirname, '..', 'domains.yaml'), output: path.resolve('openmili-reports') };
  const booleans = { '--browser':['browser',true], '--no-browser':['browser',false], '--no-install-browser':['installBrowser',false], '--no-routes':['routes',false], '--no-history':['history',false], '--no-lookup':['lookup',false], '--skip-ip':['skipIP',true], '--no-pause':['noPause',true], '--only-lookup':['onlyLookup',true], '--headed':['headed',true], '--screenshots':['screenshots',true], '--lookup':['lookup',true], '--return-routes':['routes',true] };
  const values = { '--mode':'mode', '--proxy':'proxy', '--port':'port', '--family':'family', '--limit':'limit', '--urls':'urls', '--targets-url':'targetsUrl', '--timeout':'timeout', '--output':'output', '--lookup-ip':'lookupIP', '--route-targets':'routeTargets', '--browser-path':'browserPath', '--browser-wait':'browserWait', '--min-delay':'minDelay', '--max-delay':'maxDelay', '--min-delay-ms':'minDelayMs', '--max-delay-ms':'maxDelayMs' };
  for (let i = 0; i < args.length; i++) {
    if (['--help','-h'].includes(args[i])) { o.help = true; continue; }
    if (booleans[args[i]]) { const [key,value] = booleans[args[i]]; o[key] = value; continue; }
    const key = values[args[i]];
    if (!key) throw new Error(`未知参数: ${args[i]}`);
    if (args[i+1] === undefined || args[i+1].startsWith('--')) throw new Error(`${args[i]} 缺少参数`);
    o[key] = args[++i];
  }
  if (!['auto','direct','proxy'].includes(o.mode)) throw new Error('mode 只能是 auto/direct/proxy');
  const num = (value, name, min, max, integer = false) => {
    if (!/^\d+(?:\.\d+)?$/.test(String(value))) throw new Error(`${name} 必须为数字`);
    const n = Number(value);
    if (n < min || n > max || integer && !Number.isInteger(n)) throw new Error(`${name} 必须在 ${min}–${max} 范围内`);
    return n;
  };
  o.limit = num(o.limit, 'limit', 0, 10000, true);
  o.timeout = typeof o.timeout === 'string' ? num(o.timeout, 'timeout', 1, 120) * 1000 : o.timeout;
  o.family = num(o.family, 'family', 4, 6, true); if (o.family === 5) throw new Error('family 只能为 4 或 6');
  o.familyExplicit = args.includes('--family');
  o.browserWait = num(o.browserWait, 'browser-wait', 0, 10000, true);
  for (const key of ['minDelay','maxDelay']) {
    const msKey = `${key}Ms`;
    if (o[msKey] !== undefined) o[key] = num(o[msKey], msKey, 0, 60000);
    else if (typeof o[key] === 'string') {
      const match = o[key].match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
      if (!match) throw new Error('delay 格式错误');
      o[key] = num(match[1], key, 0, match[2] === 'ms' ? 60000 : 60) * (match[2] === 'ms' ? 1 : 1000);
    }
  }
  if (o.maxDelay < o.minDelay) throw new Error('max-delay 不能小于 min-delay');
  if (o.port) {
    if (o.proxy) throw new Error('port 和 proxy 不能同时指定');
    o.proxy = `http://127.0.0.1:${num(o.port, 'port', 1, 65535, true)}`;
  }
  if (o.proxy && o.mode === 'direct') throw new Error('直连模式不能同时指定代理');
  if (o.proxy) { o.proxy = normalizeProxy(o.proxy); o.mode = 'proxy'; }
  if (o.mode === 'proxy' && !o.proxy) o.proxy = 'http://127.0.0.1:7890';
  if (o.lookupIP && (!net.isIP(o.lookupIP) || !isPublicIP(o.lookupIP))) throw new Error('lookup-ip 必须为公网 IPv4/IPv6');
  if (o.lookupIP) o.lookupIP = canonicalIP(o.lookupIP);
  if (o.onlyLookup && o.targetsUrl) throw new Error('only-lookup 不能同时指定 targets-url');
  o.targets = parseRouteTargets(o.routeTargets);
  o.output = path.resolve(o.output);
  return o;
}
function parseArgs(args) { return readOptions(args,parseLegacyArgs); }

async function chooseMode(options) {
  if (options.mode !== 'auto') return;
  options.mode = 'direct';
  if (options.noPause || options.onlyLookup || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let choice;
    do { choice = (await rl.question('输入 1 直接开始；输入 2 自定义代理端口 [1]: ')).trim() || '1'; } while (!['1','2'].includes(choice));
    if (choice === '2') {
      const input = (await rl.question('代理端口或完整 URL [7890；如 socks5h://127.0.0.1:10808]: ')).trim() || '7890';
      if (/^\d+$/.test(input) && (Number(input) < 1 || Number(input) > 65535)) throw new Error('端口必须在 1–65535 范围内');
      options.proxy = normalizeProxy(input); options.mode = 'proxy';
    }
  } finally { rl.close(); }
}

async function main(args = process.argv.slice(2), runtime = {}) {
  const options = parseArgs(args);
  if (options.help) { console.log(CLI_HELP); return; }
  if(['install','update','rollback','uninstall'].includes(options.command)){
    options.signal=runtime.signal;applyEnvironmentProxy(options);
    const installer=require('../lib/installation');
    const result=options.command==='install'?await installer.installArchive(options):options.command==='update'?await installer.update(options):options.command==='rollback'?await installer.rollback(options.installRoot||installer.managedRoot()):await installer.uninstall(options.installRoot||installer.managedRoot(),options);
    console.log(JSON.stringify(result));return result;
  }
  if(options.scoring){
    if((await fs.stat(options.scoring)).size>102400)throw new Error('评分配置不能超过 100 KiB');
    options.scoringModel=require('../lib/scoring').validateModel(JSON.parse(await fs.readFile(options.scoring,'utf8')));
  }
  if(options.command==='score'){
    if((await fs.stat(options.input)).size>16*1024*1024)throw new Error('评分报告不能超过 16 MiB');
    const input=JSON.parse(await fs.readFile(options.input,'utf8'));
    if(!require('../lib/schema').validateReport(input))throw new Error('输入报告未通过 JSON Schema');
    const score=options.scoringModel?require('../lib/scoring').scoreReport({...input,score_input:undefined},options.scoringModel):scoreReport(input);
    if(options.outputFile)await fs.writeFile(options.outputFile,JSON.stringify(score,null,2),{mode:0o600});
    console.log(options.json?JSON.stringify(score):`Score: ${score.reference??'UNKNOWN'}/100 | Coverage: ${score.coverage}% | ${score.grade_code}`);return score;
  }
  options.signal=runtime.signal;
  if(options.command==='agent'){
    const remote=await require('../lib/agent').runAgent(options);
    const output=path.join(options.output,new Date().toISOString().replace(/[:.]/g,'-')+`-agent-${process.pid}`);
    const safe=await saveReport(remote,output,{...options,command:remote.command});
    console.log(options.json?JSON.stringify(safe):require('../lib/ui').summary(safe,options));return safe;
  }
  applyEnvironmentProxy(options);
  if (options.lookupIP) options.family=net.isIP(options.lookupIP);
  if(!options.familyExplicit&&options.sourceIP)options.family=net.isIP(options.sourceIP);
  if(options.command==='port'&&net.isIP(options.host))options.family=net.isIP(options.host);
  options.sourceIP=bindSource(options);
  const privacy={secrets:environmentSecrets(),redact:options.redact,hostnames:[os.hostname()]};
  const log = require('../lib/ui').logger(options,privacy);
  const curl = await runProcess(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-q','--version']);
  if (curl.code !== 0 && !options.offline && !['doctor','port'].includes(options.command)) throw new Error('未找到 curl。Windows 10/11 通常自带；Linux 请安装 curl。');
  const startedAt = new Date().toISOString();
  const environment=await inspectSystem(options);
  const output = path.join(options.output, new Date().toISOString().replace(/[:.]/g,'-') + `-${process.pid}`);
  if (['port','doctor'].includes(options.command)) {
    const report={startedAt,environment,system:`${os.type()} ${os.release()} ${os.arch()}`,mode:options.command,family:options.family,sites:[]};
    if (options.command === 'port') report.port=await diagnosePort({...options,port:options.targetPort});
    else report.doctor={node:process.versions.node,curl:{available:curl.code===0,version:curl.stdout.split('\n')[0]},binding:options.sourceIP||null,offline:options.offline};
    report.finishedAt=new Date().toISOString();
    const safe=await saveReport(report,output,options);
    if(options.json) console.log(JSON.stringify(safe)); else { log(JSON.stringify(safe.port || safe.doctor,null,2)); if(!options.terminalOnly)log(`报告: ${path.join(output,'report.html')}`); }
    if(options.signal?.aborted) process.exitCode=EXIT.INTERRUPTED;
    else if(report.port?.status === 'failure') process.exitCode=EXIT.FAILED;
    return safe;
  }
  log(`OpenMili-IP-Toolkit | ${process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : process.platform} | v${TOOL_VERSION}`);
  let direct, exit;
  if (!options.skipIP && !(options.onlyLookup && options.lookupIP)) {
    log('正在获取本机直连 IPv4 / IPv6…');
    direct = await discoverIP({...options,proxy:'',envProxies:undefined});
    log(`直连出口: IPv4 ${direct.v4.ip || '未获取'} | IPv6 ${direct.v6.ip || '未获取'}`);
  }
  await chooseMode(options);
  if(options.sourceIP&&options.proxy)throw new Error('来源绑定不能和代理同时使用；已停止，未忽略绑定');
  log(`模式: ${options.mode === 'proxy' ? `代理 ${redactProxy(options.proxy)}` : '直连'}`);
  const transport = { ...options, family:options.command === 'lookup' ? undefined : options.family };
  exit = direct;
  if (!options.skipIP && options.mode === 'proxy' && !(options.onlyLookup && options.lookupIP)) {
    exit = await discoverIP(transport);
    log(`代理出口: IPv4 ${exit.v4.ip || '未获取'} | IPv6 ${exit.v6.ip || '未获取'}`);
  }
  if (!options.lookupIP && !options.familyExplicit && !options.sourceIP && !exit?.v4.ip && exit?.v6.ip) { options.family = 6; transport.family = 6; }
  const selected = exit?.[`v${options.family}`];
  const selectedIP = selected?.ip || '';
  // A lookup of an arbitrary address never lends its metadata/reputation to live tests of another address.
  if (options.lookupIP && !options.onlyLookup && options.lookupIP !== selectedIP) throw new Error('lookup-ip 与实际出口不同；请加 --only-lookup 单独查询，避免混合评分');
  const checkedIP = options.onlyLookup && options.lookupIP ? options.lookupIP : selectedIP;
  const report = { schemaVersion: 2, startedAt, system: `${os.type()} ${os.release()} ${os.arch()}`, mode: options.mode,
    environment,command:options.command,familyExplicit:options.familyExplicit,proxy: redactProxy(options.proxy),proxyOrigin:options.proxyOrigin||'explicit-or-direct',envProxyRules:options.envProxies?{http:redactProxy(options.envProxies.http),https:redactProxy(options.envProxies.https),noProxy:options.envProxies.noProxy}:undefined, family: options.family, selectedIP: checkedIP, direct, exit, sites: [] };
  if(options.command === 'dns'){
    report.dns=await inspectDNS({...transport,publicIP:checkedIP});report.finishedAt=new Date().toISOString();
    const safe=await saveReport(report,output,options);if(options.json)console.log(JSON.stringify(safe));else if(options.terminalOnly)console.log(require('../lib/ui').summary(safe,options));else{log(`DNS: ${report.dns.reason}`);log(`报告: ${path.join(output,'report.html')}`);}return safe;
  }
  if(options.command === 'route'){
    report.routes=await traceRoutes(options.routeTargets?options.targets:undefined,transport,log);report.finishedAt=new Date().toISOString();
    const safe=await saveReport(report,output,options);if(options.json)console.log(JSON.stringify(safe));else if(options.terminalOnly)console.log(require('../lib/ui').summary(safe,options));else{log(report.routes.note||report.routes.reason);log(`报告: ${path.join(output,'report.html')}`);}if(options.signal?.aborted)process.exitCode=EXIT.INTERRUPTED;return safe;
  }
  log('查询公开 IP 库与 ASN 归属…');
  report.database = options.lookup && options.command !== 'ip' && !options.signal?.aborted ? await lookupDatabase(checkedIP, { ...transport, abuseKey: process.env.ABUSEIPDB_API_KEY,ipapiKey:process.env.IPAPI_API_KEY,ipinfoKey:process.env.IPINFO_TOKEN }) : { status: 'untested', reason:'用户跳过或本次只检查 IP', records: [] };
  log(`IP 数据库: ${checkedIP || '未获取'} | ${report.database.attribute?.label || '未测试'}`);
  for (const r of report.database.records || []) log(`  ${r.source||r.provider}: ${r.status === 'ok' ? `AS${r.asns?.join(',') || r.asn || '?'} ${r.owner||r.name||''} ${r.country || r.registered_country || ''} ${r.city || ''}` : `未测试（${r.reason}）`}`);
  if(!options.onlyLookup && !options.noDNS && !options.skipIP){
    log('DNS：正在检测解析协议、PTR 与正反向回查…');
    report.dns=await inspectDNS({...transport,publicIP:checkedIP});
    log(`DNS：${report.dns.reason}；响应 ${report.dns.checks?.filter(c=>c.status==='success').length||0}/${report.dns.checks?.length||0}`);
  }
  if (!options.onlyLookup) {
    log('三网路径：目录节点逐跳探测，方向单独核验…');
    report.routes = options.routes ? await traceRoutes(options.routeTargets?options.targets:undefined, transport, log) : { status: 'untested', reason: '用户跳过', results: [] };
    if (report.routes.reason) log(`三网回程: 未测试（${report.routes.reason}）`);
  } else report.routes = { status: 'untested', reason: '仅查询数据库', results: [] };
  log('查询网段注册事件与近 90 天 BGP 历史…');
  report.history = options.history && !options.offline && !options.signal?.aborted ? await lookupHistory(checkedIP, report.database, transport) : { status: 'untested', reason: options.offline?'离线模式':'用户跳过' };
  log(`IP 历史: RDAP ${report.history.registration?.status==='ok'?'完成':'未取得'} | BGP ${report.history.routing?.status==='ok'?'完成':'未取得'}${report.history.routing?.originCount ? `，起源 ASN ${report.history.routing.originCount} 个` : ''}`);
  if (!options.onlyLookup) {
    let source;
    if (options.targetsUrl) {
      if (new URL(options.targetsUrl).protocol !== 'https:') throw new Error('targets-url 必须使用 HTTPS');
      const response = await request(options.targetsUrl, { ...transport, maxBytes: 102400 });
      if (response.error || response.status !== 200 || new URL(response.finalUrl).protocol !== 'https:') {
        report.websiteSource={status:'unknown',code:'TARGET_LIST_UNAVAILABLE',reason:`目标清单未取得: ${response.error || response.status}`};
        log(report.websiteSource.reason);
      } else source = response.body;
    } else source = await fs.readFile(options.urls, 'utf8');
    report.sites = source===undefined?[]:parseTargets(source);
    report.site_rules={version:report.sites[0]?.rule_version||null,updated_at:report.sites[0]?.updated_at||null,expires_at:report.sites[0]?.expires_at||null,sha256:source?require('node:crypto').createHash('sha256').update(source).digest('hex'):null};
    if (options.limit) report.sites = report.sites.slice(0, options.limit);
    log(`网站 HTTP 检测 | IPv${options.family} | ${report.sites.length} 个目标`);
    for (let i = 0; i < report.sites.length; i++) {
      if (options.signal?.aborted || options.offline) break;
      const site = report.sites[i];
      for (const [key, userAgent] of [['httpPlain','curl/8 OpenMili-IP-Toolkit/2.0'], ['http',undefined]]) {
        const response = await request(site.url, { ...transport, timeout:site.timeout?site.timeout*1000:transport.timeout,userAgent });
        const judgment = classify({...response,requestUrl:site.url,allowedHosts:site.allowed_hosts,rules:site});
        site[key] = { ...response, ...judgment }; delete site[key].body;
      }
      if(log.site)log.site(site,i+1,report.sites.length,'http');
      else log(`[${i+1}/${report.sites.length}] ${site.name}: ${site.http.label} ${site.http.status} ${site.http.duration}ms | 原始 ${site.httpPlain.label}`);
      if (i < report.sites.length - 1) await require('node:timers/promises').setTimeout(options.minDelay + Math.random() * (options.maxDelay - options.minDelay),undefined,{signal:options.signal}).catch(()=>{});
    }
    const after = options.skipIP ? null : await discoverFamily(options.family, transport);
    const verified = Boolean(selectedIP && after?.ip === selectedIP && selected?.stable && after.stable);
    report.httpIdentity = { before: selected, after, verified, note: 'HTTP 请求固定 IP 协议；起止公网观测一致仍不能排除代理按目标分流。' };
    for (const site of report.sites) for (const key of ['http','httpPlain']) { site[key] ||= {kind:'untested',label:'未测试',reason:options.offline?'离线模式':'用户中止'}; site[key].identityVerified = verified && !site[key].proxyBypassed; }
    log(`完成 HTTP | 服务可达 ${report.sites.filter(s => s.http?.kind === 'reachable').length}/${report.sites.length}`);
    report.browser = options.browser && report.sites.length ? await probeBrowserSites(report.sites, { ...options, expectedIP: selectedIP, evidenceDir: options.terminalOnly?undefined:path.join(output,'evidence') }, log) : { status: 'untested', reason: report.sites.length?'用户跳过':'没有可用目标清单' };
    if (!options.browser) for (const site of report.sites) site.browser = { kind: 'untested', label: '未测试', reason: '用户跳过' };
  } else report.browser = { status: 'untested', reason: '仅查询数据库' };
  report.score_model=options.scoringModel;
  report.score = scoreReport(report);
  report.finishedAt = new Date().toISOString();
  const safe=await saveReport(report, output,options);
  if (options.json) console.log(JSON.stringify(safe));
  else console.log(require('../lib/ui').summary(safe,options));
  if (safe.mode === 'lookup') log('查询模式：未通过所查 IP 实测，不提供实际出口综合评分');
  else if(!options.terminalOnly)log(`已测项目参考分: ${report.score.reference ?? '未知'}/100 | 证据覆盖 ${report.score.coverage}% | ${report.score.grade}`);
  if(!options.terminalOnly){
    log(`报告: ${path.join(output, 'report.html')}`);
    log(`JSON: ${path.join(output, 'report.json')}`);
    log(`TXT: ${path.join(output, 'report.txt')}`);
  }
  if(options.signal?.aborted) process.exitCode=EXIT.INTERRUPTED;
  return safe;
}

if (require.main === module) {
  const controller=new AbortController();
  const abort=()=>controller.abort(); process.on('SIGINT',abort); process.on('SIGTERM',abort);
  const run=async()=>{
    if(process.argv.length>2||!process.stdin.isTTY||!process.stdout.isTTY)return main(undefined,{signal:controller.signal});
    let language='zh-CN',last,lastReport;
    while(!controller.signal.aborted){
      const selection=await require('../lib/ui').menu({signal:controller.signal,language,last});
      if(!selection)break;language=selection.language;
      if(selection.action){
        if(!lastReport)try{lastReport=JSON.parse(await fs.readFile(path.resolve('openmili-reports/latest.json'),'utf8'));}catch{}
        if(lastReport){const text=selection.action==='d'?JSON.stringify(lastReport.modules,null,2):require('../lib/ui').summary(lastReport,{plain:true,language});console.log(sanitizeText(text,{secrets:environmentSecrets()}));}
        else console.log(language==='en'?'No local report yet.':'尚无本地报告。');
      }
      if(selection.args){last=selection.args;try{lastReport=await main([...last,'--language',language],{signal:controller.signal});}catch(error){console.error(sanitizeText(error.message,{secrets:environmentSecrets()}));}}
    }
  };
  run().catch(error => { console.error(sanitizeText(`[!] ${error.message}`,{secrets:environmentSecrets()})); process.exitCode=controller.signal.aborted?EXIT.INTERRUPTED:EXIT.ARGUMENT; })
    .finally(()=>{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);});
}
module.exports = { parseArgs, chooseMode, main };
