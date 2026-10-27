'use strict';
const os=require('node:os');
const {createInterface}=require('node:readline/promises');
const {sanitizeText,environmentSecrets}=require('./privacy');
const LABELS={success:['成功','SUCCESS',32],limited:['受限','LIMITED',33],failure:['失败','FAILURE',31],unknown:['未知','UNKNOWN',90],skipped:['跳过','SKIPPED',90]};
const MESSAGES=[['服务可达','Reachable'],['需要登录','Login required'],['CF 浏览器盾','Browser challenge'],['人机验证','CAPTCHA'],['访问受限','Restricted'],['地区限制','Region restriction'],['请求限流','Rate limited'],['响应为空','Empty response'],['需要 JavaScript','JavaScript required'],['网络错误','Network error'],['服务异常','HTTP error'],['未测试','Not tested'],['未获取','Unavailable'],['用户跳过','Skipped by user'],['用户中止','Interrupted'],['离线模式','Offline'],['正在获取本机直连 IPv4 / IPv6…','Discovering direct IPv4 / IPv6…'],['直连出口:','Direct egress:'],['代理出口:','Proxy egress:'],['浏览器出口:','Browser egress:'],['模式:','Mode:'],['直连','Direct'],['代理','Proxy'],['查询公开 IP 库与 ASN','Querying public IP and ASN sources'],['查询公开库与 ASN 归属…','Querying public IP and ASN sources…'],['IP 数据库:','IP database:'],['三网路径：目录节点逐跳探测，方向单独核验…','Tracing operator targets; direction verified separately…'],['三网回程:','Operator routes:'],['查询网段注册事件与近 90 天 BGP 历史…','Querying registration events and 90-day BGP history…'],['IP 历史:','IP history:'],['网站 HTTP 检测','Website HTTP checks'],['个目标','targets'],['完成 HTTP','HTTP completed'],['已测项目参考分:','Observed score:'],['证据覆盖','Coverage'],['证据不足','Insufficient evidence'],['优秀（本次样本）','Excellent (sample)'],['良好（本次样本）','Good (sample)'],['一般（本次样本）','Fair (sample)'],['受限较多（本次样本）','Limited (sample)'],['报告:','Report:'],['浏览器','Browser'],['原始','Raw'],['查询模式：未通过所查 IP 实测，不提供实际出口综合评分','Lookup only: no live capability score for the queried IP']];
function english(message){for(const [a,b] of MESSAGES)message=message.split(a).join(b);return message;}
function wrap(message,width=process.stdout.columns||100){
  const lines=[];for(const line of String(message).split('\n')){let current='',n=0;for(const ch of line){const w=/[\u2e80-\uffff]/u.test(ch)?2:1;if(n+w>Math.max(20,width)){lines.push(current);current='';n=0;}current+=ch;n+=w;}lines.push(current);}return lines.join('\n');
}
function statusLabel(status,options={}){const item=LABELS[status]||LABELS.unknown,text=options.language==='en'?item[1]:`${item[0]} ${item[1]}`;return !options.plain&&process.stdout.isTTY&&!Object.hasOwn(process.env,'NO_COLOR')?`\x1b[${item[2]}m${text}\x1b[0m`:text;}
function logger(options,privacy={}){const started=Date.now();return message=>{if(options.json)return;let safe=sanitizeText(message,{secrets:environmentSecrets(),...privacy});if(options.language==='en')safe=english(safe);const line=`[${((Date.now()-started)/1000).toFixed(1)}s] ${safe}`;console.log(options.plain||!process.stdout.isTTY||/^(?:报告:|Report:|JSON:|TXT:)/.test(safe)?line:wrap(line));};}
function summary(report,options={}) {
  const en=options.language==='en';
  const modules=Object.entries(report.modules||{}).map(([name,m])=>`${name}: ${statusLabel(m.status,options)} · ${en?english(m.reason):m.reason}`).join('\n');
  return en?modules:`${sanitizeText(details(report),{secrets:environmentSecrets()})}\n\n${modules}`;
}
function details(report) {
  const lines=[],database=report.database||{},attribute=database.attribute||{},reputation=database.reputation||{};
  lines.push('【公网出口与 IP 属性】');
  for(const family of [4,6]){const value=report.exit?.[`v${family}`];lines.push(`IPv${family}：${value?.ip||'未获取'}${value?.reason?`（${value.reason}）`:''}`);}
  lines.push(`本次网站实测：IPv${report.family} ${report.selectedIP||'出口未确定'}`);
  for(const r of database.records||[]) lines.push(`  ${r.source||r.provider}：${r.status==='ok'?`${(r.asns||[r.asn]).filter(Boolean).map(a=>`AS${a}`).join(', ')} ${r.owner||r.name||''} ${r.prefix||''} ${r.country||r.registered_country||''}`.trim():`未取得（${r.reason||'来源不可用'}）`}`);
  lines.push(`属性：${attribute.label||'未知'}；可信度 ${attribute.confidence_label||'未知'}${attribute.confidence!==undefined?` (${attribute.confidence}%)`:''}`);
  if(attribute.reason)lines.push(`  ${attribute.reason}`);
  for(const claim of attribute.claims||[])lines.push(`  类型证据 ${claim.source}：${claim.type} / ${claim.granularity}；${claim.evidence}`);
  lines.push('\n【公开库风险】',`风险：${reputation.risk_level||'未确定'}；已测字段覆盖 ${Math.round((reputation.coverage||0)*100)}%`);
  const flagNames={is_proxy:'代理',is_vpn:'VPN',is_tor:'Tor',is_abuser:'滥用',is_datacenter:'数据中心标签'};
  for(const [key,name] of Object.entries(flagNames))lines.push(`  ${name}：${typeof reputation.flags?.[key]==='boolean'?(reputation.flags[key]?'来源标记为是':'来源标记为否'):'未知'}`);
  for(const source of reputation.sources||[])if(source.reason||source.totalReports!==undefined)lines.push(`  ${source.source}：${source.reason||`近 ${source.days} 天举报 ${source.totalReports}；来源风险值 ${source.score}/100`}`);
  lines.push('\n【DNS 与三网路径】');
  if(report.dns){
    const protocols={};for(const check of report.dns.checks||[])(protocols[check.protocol]||=[]).push(check);
    for(const [protocol,checks] of Object.entries(protocols)){
      lines.push(`  ${protocol}：成功 ${checks.filter(c=>c.status==='success').length}/${checks.length}；跳过 ${checks.filter(c=>c.status==='skipped').length}`);
      for(const reason of [...new Set(checks.filter(c=>c.status!=='success').map(c=>c.reason).filter(Boolean))].slice(0,2))lines.push(`    ${reason}`);
    }
    if(report.dns.leak)lines.push(`  DNS 泄漏：${report.dns.leak.reason}`);
  }else lines.push('DNS：本次未执行');
  const routes=report.routes||{};
  lines.push(`三网路径：${routes.direction?.label||'本机路径'}；${routes.reason||routes.note||'本次未执行'}`);
  for(const route of routes.results||[])lines.push(`  ${route.name}：${route.reached?'已到达':'未确定/部分可见'}；${route.lines?.join(' / ')||route.reason||'线路未识别'}`);
  const history=report.history||{},registration=history.registration,routing=history.routing;
  lines.push('\n【IP 历史】');
  lines.push(`注册事件：${registration?.status==='ok'?registration.source:registration?.reason||history.reason||'未取得'}`);
  for(const event of registration?.events||[])lines.push(`  ${event.action}：${event.date}`);
  lines.push(`近 90 天 BGP：${routing?.status==='ok'?`${routing.prefix}；起源 ASN ${routing.originCount} 个`:routing?.reason||history.reason||'未取得'}`);
  lines.push('\n【网站实测与评分】');
  for(const [key,name] of [['httpPlain','原始 HTTP'],['http','桌面请求头'],['browser','真实浏览器']]){
    const counts={};for(const site of report.sites||[]){const result=site[key],label=result?.label||'未测试';counts[label]=(counts[label]||0)+1;}
    lines.push(`${name}：${Object.entries(counts).map(([label,count])=>`${label} ${count}`).join(' / ')||'无目标'}`);
  }
  if(report.browser?.reason)lines.push(`浏览器说明：${report.browser.reason}`);
  for(const component of report.score?.components||[])lines.push(`  ${{reputation:'信誉与风险',websites:'网站访问',routes:'三网路径',dns:'DNS 健康',network:'基础网络'}[component.name]||component.name}：${component.reference??'未知'}/100；已测权重 ${component.measured}/${component.weight}`);
  if(report.score)lines.push(`参考分：${report.score.reference??'未知'}/100；证据覆盖 ${report.score.coverage}%；${report.score.grade}`);
  return lines.join('\n');
}
async function menu({signal,language='zh-CN',last}={}) {
  const en=language==='en',rl=createInterface({input:process.stdin,output:process.stdout});
  const ask=prompt=>rl.question(prompt,{signal});
  try{
    console.log(wrap(`\nOPENMILI / IP TOOLKIT ${require('../package.json').version} | ${os.platform()} ${os.arch()}\n${en?'Egress is verified when each task starts.':'出口在每次任务开始时核验；结果仅保存本地。'}\n[1] ${en?'All (direct)':'一键检测'}  [2] ${en?'Proxy port':'自定义代理端口'}\n[3] IPv4/IPv6  [4] DNS  [5] ${en?'Identity/ASN':'属性/ASN'}\n[6] ${en?'Reputation':'信誉/风险'}  [7] ${en?'Routes':'三网路径'}  [8] ${en?'Websites':'网站访问'}\n[9] ${en?'TCP/TLS port':'目标端口'}  [R] ${en?'Retry previous module':'重试上次模块'}\n[V] ${en?'View report':'查看报告'}  [D] ${en?'Expand evidence':'展开证据'}\n[L] 中文/English  [0] ${en?'Exit':'退出'}`));
    const choice=(await ask(en?'Select [1]: ':'请选择 [1]: ')).trim().toLowerCase()||'1';
    if(choice==='0')return null;
    if(choice==='l')return {language:en?'zh-CN':'en'};
    if(choice==='v'||choice==='d')return {action:choice,language};
    if(choice==='r')return {args:last||['all','--mode','direct'],language};
    const args=({'1':['all','--mode','direct'],'3':['ip'],'4':['dns'],'5':['identity'],'6':['reputation'],'7':['route'],'8':['websites','--mode','http']})[choice];
    if(args)return {args,language};
    if(choice==='2')return {args:['all','--proxy',(await ask(en?'Proxy port or URL [7890]: ':'代理端口或 URL [7890]: ')).trim()||'7890'],language};
    if(choice==='9')return {args:['port','--host',(await ask(en?'Host: ':'目标主机: ')).trim(),'--port',(await ask(en?'Port [443]: ':'目标端口 [443]: ')).trim()||'443',...((await ask(en?'TLS? [Y/n]: ':'检查 TLS? [Y/n]: ')).trim().toLowerCase()==='n'?[]:['--tls'])],language};
    return {language};
  }finally{rl.close();}
}
module.exports={english,wrap,statusLabel,logger,summary,details,menu};
