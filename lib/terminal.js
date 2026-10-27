'use strict';
const {sanitize, sanitizeText, environmentSecrets} = require('./privacy');

const TONES = {green:32, yellow:33, red:31, gray:90, cyan:36};
const METHODS = [['httpPlain','普通 HTTP'], ['http','浏览器标头'], ['browser','真实浏览器']];
function websiteMethods(options,sites=[]) {
  const browser=options.browser??sites.some(site=>site.browser&&site.browser.kind!=='untested');
  return browser?METHODS:METHODS.slice(0,2);
}
const RESULTS = {
  reachable:['通过','green'], challenge:['验证','yellow'], captcha:['验证','yellow'],
  restricted:['阻断','red'], region:['阻断','red'], 'rate-limit':['限流','red'],
  network:['失败','red'], 'http-error':['异常','red'], login:['登录','yellow'],
  'js-required':['需JS','yellow'], partial:['部分','yellow'], empty:['空白','yellow'],
  redirect:['跳转','yellow'], untested:['未测','gray']
};
const oneLine = value => sanitizeText(value ?? '').replace(/\s+/g,' ').trim();
function widthOf(value) {
  let width=0;
  for(const ch of String(value).replace(/\x1b\[[0-9;]*m/g,'')) {
    const n=ch.codePointAt(0);
    if(/\p{Mark}/u.test(ch)||n===0x200d||n===0xfe0f)continue;
    width += n>=0x1100&&(n<=0x115f||n>=0x2329&&n<=0x232a||n>=0x2e80&&n<=0xa4cf||n>=0xac00&&n<=0xd7a3||n>=0xf900&&n<=0xfaff||n>=0xfe10&&n<=0xfe6f||n>=0xff01&&n<=0xff60||n>=0xffe0&&n<=0xffe6||n>=0x1f300)?2:1;
  }
  return width;
}
function fit(value,width) {
  const text=oneLine(value);
  if(widthOf(text)<=width)return text;
  let output='';for(const ch of text){if(widthOf(output+ch)>width-1)break;output+=ch;}
  return output+'…';
}
function pad(value,width){return value+' '.repeat(Math.max(0,width-widthOf(value)));}
function colors(options={}) {
  if(options.plain||Object.hasOwn(process.env,'NO_COLOR'))return false;
  return options.color ?? Boolean(process.stdout.isTTY);
}
function paint(value,tone,options={}){return colors(options)&&TONES[tone]?`\x1b[${TONES[tone]}m${value}\x1b[0m`:String(value);}
function pageWidth(options={}){return Math.max(32,Math.min(132,options.width||process.stdout.columns||100));}
function splitLines(value,width) {
  const lines=[];let line='';
  for(const ch of oneLine(value)){if(widthOf(line+ch)>width){lines.push(line);line='';}line+=ch;}
  if(line||!lines.length)lines.push(line);return lines;
}
function resultStyle(result){return result?RESULTS[result.kind]||['未知','gray']:['待测','gray'];}
function siteCell(result,options={}) {
  const [label,tone]=resultStyle(result);
  const duration=Number.isFinite(result?.duration)?` ${(result.duration/1000).toFixed(1)}s`:'';
  return paint(fit(`${label}${result?.status?` ${result.status}`:''}${duration}`,14),tone,options);
}
function websiteHeader(options={}) {
  const width=pageWidth(options),methods=websiteMethods(options);
  if(width<26+methods.length*16)return '  网站检测结果';
  const nameWidth=Math.min(30,width-methods.length*16-3);
  return ('  '+pad('网站',nameWidth)+'  '+methods.map(([,name])=>pad(name,14)).join('  ')).trimEnd();
}
function websiteRow(site,index,options={}) {
  const width=pageWidth(options),methods=websiteMethods(options,[site]),name=`${String(index).padStart(2,'0')} ${oneLine(site.name)}`;
  if(width<26+methods.length*16)return ['  '+fit(name,width-2),...methods.map(([key,label])=>'    '+pad(label,12)+' '+siteCell(site[key],options))].join('\n');
  const nameWidth=Math.min(30,width-methods.length*16-3);
  return ('  '+pad(fit(name,nameWidth),nameWidth)+'  '+methods.map(([key])=>pad(siteCell(site[key],options),14)).join('  ')).trimEnd();
}

function renderReport(input,options={}) {
  const report=sanitize(input,{secrets:environmentSecrets(),redact:options.redact,hostnames:[input.environment?.hostname].filter(Boolean)});
  const width=pageWidth(options),lines=[];
  const paragraph=(text,tone='',indent=2)=>{for(const line of splitLines(text,width-indent))lines.push(' '.repeat(indent)+paint(line,tone,options));};
  const field=(label,value,tone='')=>{
    if(widthOf(label)>12){paragraph(`${label} : ${value??'未知'}`,tone);return;}
    const prefix='  '+pad(label,12)+' : ',available=width-widthOf(prefix);
    splitLines(value??'未知',available).forEach((line,i)=>lines.push((i?' '.repeat(widthOf(prefix)):prefix)+paint(line,tone,options)));
  };
  const section=(number,title)=>{
    lines.push('');paragraph(`${number}  ${title}`,'cyan');lines.push('  '+paint('─'.repeat(width-4),'gray',options));
  };
  paragraph('OpenMili-IP-Toolkit · 终端检测结果','cyan');
  let legend='';
  for(const [text,tone] of [['通过','green'],['验证 / 需登录','yellow'],['阻断 / 失败','red'],['未知 / 跳过','gray']]){
    const item=paint(text,tone,options);
    if(widthOf(legend)+widthOf(item)+5>width-2){lines.push('  '+legend);legend='';}
    legend+=(legend?'  |  ':'')+item;
  }
  if(legend)lines.push('  '+legend);
  field('检测时间',report.startedAt||report.timestamp||'未知');
  const elapsed=Date.parse(report.finishedAt)-Date.parse(report.startedAt);
  if(Number.isFinite(elapsed))field('总耗时',`${(elapsed/1000).toFixed(1)} 秒`);
  field('连接方式',report.mode==='proxy'?`代理 ${report.proxy}`:report.mode==='lookup'?'指定 IP 数据查询':'本机直连');

  section('01','公网出口与网络属性');
  field('系统',report.system||report.environment?.os||'未知');
  for(const family of [4,6]) {
    const exit=report.exit?.[`v${family}`];field(`公网 IPv${family}`,exit?.ip||exit?.reason||'未获取',exit?.ip?'green':'gray');
    if(exit?.ip&&!exit.stable)paragraph(`IPv${family} 稳定性未核实：${exit.reason||'独立回显证据不足'}`,'yellow');
  }
  field('本次实测',`IPv${report.family||'?'} ${report.selectedIP||'出口未确定'}`);
  const database=report.database||{},attribute=database.attribute||{};
  for(const record of database.records||[]) {
    if(record.status!=='ok'){field(record.source||record.provider||'来源',record.reason||'未取得数据','gray');continue;}
    field(record.source||record.provider||'来源',[(record.asns||[record.asn]).filter(Boolean).map(a=>`AS${a}`).join(', '),record.owner||record.name,record.prefix,record.country||record.registered_country].filter(Boolean).join(' · '));
    if(record.company&&record.company!==record.owner)field('组织',record.company);
    if(record.checked_at)field('来源查询时间',`${record.checked_at}${record.cached?'（缓存）':''}${record.stale?'（已过期）':''}`,record.stale?'yellow':'gray');
  }
  field('IP 属性',attribute.label||'未知',attribute.type&&attribute.type!=='UNKNOWN'?'yellow':'gray');
  field('属性可信度',`${attribute.confidence_label||'未知'}${attribute.confidence!==undefined?` · ${attribute.confidence}/100`:''}`);
  if(attribute.reason)paragraph(attribute.reason,'gray');
  for(const claim of attribute.claims||[])paragraph(`类型证据：${claim.source} · ${claim.type} · ${claim.granularity} · ${claim.evidence}`);

  section('02','公开库风险');
  const reputation=database.reputation||{};
  field('风险结论',reputation.risk_level||'未知',reputation.tested?(reputation.risk>=.6?'red':'yellow'):'gray');
  for(const [key,label] of Object.entries({is_proxy:'代理标签',is_vpn:'VPN 标签',is_tor:'Tor 标签',is_abuser:'滥用标签',is_datacenter:'机房标签'})){
    const flag=reputation.flags?.[key];field(label,typeof flag==='boolean'?(flag?'来源标记为是':'来源标记为否'):'未知：来源未返回该字段',typeof flag!=='boolean'?'gray':flag?(key==='is_datacenter'?'yellow':'red'):'green');
  }
  for(const source of reputation.sources||[]) {
    if(source.reason)field(source.source||'来源',source.reason,'gray');
    if(source.totalReports!==undefined)field(source.source||'举报记录',`近 ${source.days} 天举报 ${source.totalReports}；来源风险值 ${source.score}/100`);
  }
  if(!reputation.tested)paragraph(report.modules?.reputation?.reason||'已启用来源未返回风险字段；保留未知。','gray');

  section('03','DNS 与 PTR');
  const dns=report.dns;
  if(!dns)paragraph('本次未执行','gray');
  else {
    field('系统 DNS',(dns.system_servers||[]).join(' / ')||'未知');
    const checks=dns.checks||[],measured=checks.filter(c=>c.status!=='skipped');
    field('实际查询',`${measured.length} 项；成功 ${measured.filter(c=>c.status==='success').length} 项；能力限制跳过 ${checks.length-measured.length} 项`);
    const skipped=new Map();
    for(const check of checks) {
      if(check.status==='skipped'){const key=`${String(check.protocol).toUpperCase()}：${check.reason}`;skipped.set(key,(skipped.get(key)||0)+1);continue;}
      const tone=check.status==='success'?'green':check.status==='failure'?'red':check.status==='limited'?'yellow':'gray';
      paragraph(`${String(check.protocol).toUpperCase()} ${check.type} ${check.name} · ${check.resolver||''} · ${check.rcode||check.reason||'未知'}${Number.isFinite(check.latency_ms)?` · ${check.latency_ms}ms`:''}`,tone);
      const answers=(check.answers||[]).filter(a=>a.type===check.type||a.type==='CNAME');
      for(const answer of answers)paragraph(`${answer.type} ${typeof answer.data==='object'?JSON.stringify(answer.data):answer.data} · TTL ${answer.ttl??'未知'}`,'',4);
      if(!answers.length)paragraph(check.reason||'没有取得该类型记录','gray',4);
    }
    for(const [reason,count] of skipped)paragraph(`跳过 ${count} 项 ${reason}`,'gray');
    for(const result of dns.forward_reverse||[])field('正反向回查',`${result.hostname||''} · ${result.reason}`,result.status==='success'?'green':'gray');
    for(const difference of dns.differences||[])paragraph(`${difference.type}：${difference.reason}`,'yellow');
    if(dns.leak)field('DNS 泄漏',dns.leak.reason,'gray');
  }

  section('04','三网路径');
  const routes=report.routes||{};
  if(routes.direction?.label)field('探测方向',routes.direction.label);
  if(routes.reason||routes.note)paragraph(routes.reason||routes.note,routes.results?.length?'':'gray');
  if(!routes.results?.length&&!routes.reason)paragraph('本次未取得路径证据','gray');
  for(const route of routes.results||[]) {
    paragraph(`${route.name} · IPv${route.family} ${route.ip||'未解析'} · ${route.reached?'到达目标':'未确定/部分可见'}`,route.reached?'green':'gray');
    if(route.lines?.length)field('线路 ASN',route.lines.join(' / '));
    if(route.reason)paragraph(route.reason,'gray');
    for(const attempt of route.attempts||[{hops:route.hops||[]}]) {
      paragraph(`${(attempt.protocol||'icmp').toUpperCase()} · ${attempt.reason||'逐跳结果'}`,'gray',4);
      for(const hop of attempt.hops||[]) {
        const asns=(hop.asn_evidence||[]).flatMap(x=>x.asns||[]).map(a=>`AS${a}`);
        paragraph(`${hop.ttl??hop.hop??'?'}  ${(hop.ips||[hop.ip]).filter(Boolean).join(' / ')||'*'}  ${(hop.rtt_ms||[]).map(n=>`${n}ms`).join(' / ')||'*'}  ${[...new Set(asns)].join(' / ')}`,'',4);
      }
    }
  }

  section('05','IP 历史');
  const history=report.history||{},registration=history.registration||{},routing=history.routing||{};
  field('注册来源',registration.status==='ok'?registration.source:registration.reason||history.reason||'未知',registration.status==='ok'?'':'gray');
  const actions={registration:'注册时间','last changed':'修改时间',expiration:'到期时间'};
  for(const event of registration.events||[])field(actions[event.action]||event.action,event.date);
  field('近 90 天 BGP',routing.status==='ok'?`${routing.prefix} · 起源 ASN ${routing.originCount} 个`:routing.reason||history.reason||'未知',routing.status==='ok'?'':'gray');
  for(const origin of routing.origins||[])paragraph(`AS${origin.asn} · ${origin.prefix||routing.prefix||''} · ${origin.start||routing.start||''} → ${origin.end||routing.end||''}`);
  if(history.note||registration.note)paragraph(history.note||registration.note,'gray');

  const methods=websiteMethods(options,report.sites),browser=methods.length===3,websiteOptions={...options,width,browser};
  section('06',`网站实测 · ${browser?'三种方式':'HTTP 双方式'}对照`);
  field('出口核验',`HTTP ${report.httpIdentity?.verified?'起止一致':'未证实稳定'}${browser?`；浏览器 ${report.browser?.identityVerified?'起止一致':'未证实稳定'}`:''}`,report.httpIdentity?.verified&&(!browser||report.browser?.identityVerified)?'green':'yellow');
  paragraph('浏览器标头通过 curl 发送，不执行 JavaScript。','gray');
  lines.push(websiteHeader(websiteOptions));
  (report.sites||[]).forEach((site,i)=>lines.push(websiteRow(site,i+1,websiteOptions)));
  if(browser&&report.browser?.reason)field('浏览器说明',report.browser.reason,'gray');
  paragraph('验证、阻断与未测原因','cyan');
  let notes=0;
  for(const site of report.sites||[]) {
    const groups=new Map();
    for(const [key,label] of methods) {
      const result=site[key];if(!result||result.kind==='reachable')continue;
      const reason=result.reason||result.evidence||result.error||result.label||'本次未取得证据';
      const keyText=[result.kind,reason,result.finalUrl,result.title].join('|');
      if(!groups.has(keyText))groups.set(keyText,{result,reason,methods:[]});groups.get(keyText).methods.push(label);
    }
    if(!groups.size)continue;notes++;
    paragraph(site.name);
    for(const {result,reason,methods} of groups.values()) {
      const [label,tone]=resultStyle(result);paragraph(`${methods.join(' / ')}：${label}${result.status?` (${result.status})`:''} · ${reason}`,tone,4);
      if(result.title)paragraph(`页面：${result.title}`,'gray',4);
      if(result.finalUrl&&result.finalUrl!==site.url)paragraph(`跳转：${result.finalUrl}`,'gray',4);
      if(result.identityNote)paragraph(result.identityNote,'yellow',4);
      for(const failed of result.resourceFailures||[])paragraph(`资源：${failed.type} ${failed.status||failed.error||'失败'} ${failed.url}`,'yellow',4);
    }
  }
  if(!notes)paragraph('本次没有额外的验证、阻断或未测记录。','gray');

  section('07','综合评分');
  for(const part of report.score?.components||[]) {
    const label={reputation:'信誉与风险',websites:'网站访问',routes:'三网路径',dns:'DNS 健康',network:'基础网络'}[part.name]||part.name;
    const tone=part.reference==null?'gray':part.reference>=80?'green':part.reference>=60?'yellow':'red';
    field(label,`${part.reference??'未知'}/100 · 已测权重 ${part.measured}/${part.weight}`,tone);
  }
  if(report.score){
    field('已测参考分',`${report.score.reference??'未知'}/100`,report.score.grade_code==='insufficient'?'gray':report.score.reference>=80?'green':'yellow');
    field('证据覆盖',`${report.score.coverage}% · ${report.score.grade}`,report.score.grade_code==='insufficient'?'gray':'');
    // 保留明确的覆盖说明，低覆盖率的参考分不能显示为综合等级。
    paragraph(`证据覆盖 ${report.score.coverage}%；${report.score.note||'未知项不按失败处理，低覆盖率不评级。'}`,'gray');
  }
  lines.push('');return lines.join('\n');
}

module.exports={renderReport,paint,widthOf,pageWidth,websiteHeader,websiteRow,resultStyle};
