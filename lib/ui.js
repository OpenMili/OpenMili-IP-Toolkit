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
function logger(options,privacy={}){const started=Date.now();return message=>{if(options.json)return;let safe=sanitizeText(message,{secrets:environmentSecrets(),...privacy});if(options.language==='en')safe=english(safe);console.log(wrap(`[${((Date.now()-started)/1000).toFixed(1)}s] ${safe}`));};}
function summary(report,options={}) {
  const en=options.language==='en';
  return Object.entries(report.modules||{}).map(([name,m])=>`${name}: ${statusLabel(m.status,options)} · ${en?english(m.reason):m.reason}`).join('\n');
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
module.exports={english,wrap,statusLabel,logger,summary,menu};
