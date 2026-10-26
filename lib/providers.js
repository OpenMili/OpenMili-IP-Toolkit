'use strict';
const net=require('node:net');
const {provider,fetchJSON}=require('./provider');
const {wireQuery,dohQuery}=require('./dns');
const {isPublicIP,sameIP}=require('./core');
const {inPrefix,reverseIP,ipNumber}=require('./ip-network');
const {fuseEvidence}=require('./classification');
function asn(value){const m=String(value||'').match(/^(?:AS)?(\d+)(?:\s|$)/i);return m&&+m[1]>0?+m[1]:null;}
function asns(values){return [...new Set(values.map(asn).filter(Boolean))];}
function normalizeRIPE(d,ip) {
  if(d.status!=='ok'||!Array.isArray(d.data?.asns)||!inPrefix(ip,d.data.prefix))throw new Error('RIPE 未返回匹配目标的前缀/ASN');
  const origins=asns(d.data.asns);if(!origins.length)throw new Error('RIPE 无有效 ASN');
  return {source:'RIPE RIS',status:'ok',kind:'bgp',asns:origins,asn:origins[0],prefix:d.data.prefix,multiOrigin:origins.length>1,granularity:'prefix'};
}
function normalizeCymru(texts,ip) {
  const results=texts.map(text=>String(text).replace(/^"|"$/g,'').split('|').map(x=>x.trim())).filter(x=>x.length>=5&&inPrefix(ip,x[1]));
  if(!results.length)throw new Error('Cymru 未返回匹配目标的前缀');
  const origins=asns(results.flatMap(x=>x[0].split(/\s+/)));if(!origins.length)throw new Error('Cymru 无有效 ASN');
  return {source:'Team Cymru',status:'ok',kind:'bgp',asn:origins[0],asns:origins,prefix:results[0][1],registered_country:results[0][2],registry:results[0][3],allocated_at:results[0][4],multiOrigin:origins.length>1,granularity:'prefix'};
}
function rdapEndpoint(bootstrap,ip) {
  if(!Array.isArray(bootstrap.services))throw new Error('IANA RDAP bootstrap schema 不匹配');
  const matches=bootstrap.services.flatMap(([prefixes,urls])=>prefixes.filter(p=>inPrefix(ip,p)).map(p=>({bits:+p.split('/')[1],urls})) ).sort((a,b)=>b.bits-a.bits);
  const url=matches[0]?.urls.find(u=>{try{return new URL(u).protocol==='https:';}catch{return false;}});
  if(!url)throw new Error('未找到受测地址的 HTTPS 官方 RDAP 服务');
  return new URL(`ip/${encodeURIComponent(ip)}`,url.endsWith('/')?url:url+'/').href;
}
function normalizeRDAP(d,ip,endpoint) {
  if(d.objectClassName!=='ip network'||net.isIP(d.startAddress)!==net.isIP(ip)||net.isIP(d.endAddress)!==net.isIP(ip)||ipNumber(ip)<ipNumber(d.startAddress)||ipNumber(ip)>ipNumber(d.endAddress))throw new Error('官方 RDAP 返回的网段不含目标 IP');
  const organizations=(d.entities||[]).filter(e=>(e.roles||[]).includes('registrant')).flatMap(e=>(e.vcardArray?.[1]||[]).filter(x=>['fn','org'].includes(x[0])).map(x=>Array.isArray(x[3])?x[3].join(' '):x[3]));
  return {source:'Official RIR RDAP',status:'ok',kind:'rdap',endpoint,name:d.name,handle:d.handle,registered_country:d.country||null,organizations,
    startAddress:d.startAddress,endAddress:d.endAddress,events:(d.events||[]).map(e=>({action:e.eventAction,date:e.eventDate})),granularity:'prefix',note:'登记国/分配组织不是实际使用地或住宅会话证明'};
}
function normalizeIPAPI(d,ip) {
  if(d.error||!sameIP(d.ip,ip))throw new Error('ipapi.is 返回其他 IP 或错误');
  const flags={};for(const k of ['is_proxy','is_vpn','is_tor','is_abuser','is_datacenter'])if(typeof d[k]==='boolean')flags[k]=d[k];
  return {source:'ipapi.is',status:'ok',asn:asn(d.asn?.asn||d.asn),owner:d.asn?.org||'',company:d.company?.name||'',
    network_type:d.company?.type||null,granularity:'ip',reliability:.65,type_evidence:'IP 查询结果 company.type；不把 asn.type 视为该前缀使用类型',
    country:d.location?.country||null,city:d.location?.city||null,flags,independence_group:'commercial-upstream-unverified'};
}
function normalizeIPinfo(d,ip) {
  if(!sameIP(d.ip,ip)||d.error)throw new Error('IPinfo 返回其他 IP 或错误');
  const flags={};for(const [key,field] of [['proxy','is_proxy'],['vpn','is_vpn'],['tor','is_tor'],['hosting','is_datacenter']])if(typeof d.privacy?.[key]==='boolean')flags[field]=d.privacy[key];
  return {source:'IPinfo',status:'ok',asn:asn(d.asn?.asn||d.org),owner:d.asn?.name||d.org||'',network_type:d.company?.type||null,granularity:'ip',reliability:.75,country:d.country,city:d.city,flags,
    type_evidence:'按授权套餐实际提供的 company.type；缺字段不推测',independence_group:'commercial-upstream-unverified'};
}
async function lookupIdentity(ip,options={}) {
  if(!isPublicIP(ip))return {status:'untested',reason:'没有有效公网地址',records:[],attribute:fuseEvidence([]),reputation:{tested:false}};
  const tasks=[
    provider('ripe',ip,async()=>normalizeRIPE(await fetchJSON(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`,options),ip),options),
    provider('cymru',ip,async()=>{
      const name=reverseIP(ip,false)+(net.isIP(ip)===4?'.origin.asn.cymru.com':'.origin6.asn.cymru.com');
      const answer=options.proxy?await dohQuery(name,'TXT',options):await wireQuery(name,'TXT',{...options,server:options.resolver,protocol:'udp'});
      if(answer.status!=='success')throw new Error(answer.reason);
      const texts=answer.answers.filter(a=>a.type==='TXT').map(a=>Array.isArray(a.data)?a.data.join(''):a.data);
      return {...normalizeCymru(texts,ip),dns_source:{protocol:answer.protocol,resolver:answer.resolver}};
    },options),
    provider('rdap',ip,async()=>{
      const bootstrap=await provider('iana',net.isIP(ip)===4?'ipv4':'ipv6',async()=>({status:'ok',...(await fetchJSON(`https://data.iana.org/rdap/ipv${net.isIP(ip)}.json`,options))}),options);
      if(bootstrap.status!=='ok')throw new Error(bootstrap.reason);
      const endpoint=rdapEndpoint(bootstrap,ip);return normalizeRDAP(await fetchJSON(endpoint,options),ip,endpoint);
    },options)
  ];
  if(options.communitySources||options.ipapiKey)tasks.push(provider('ipapi',ip,async()=>{
    const url=new URL('https://api.ipapi.is/');url.searchParams.set('q',ip);if(options.ipapiKey)url.searchParams.set('key',options.ipapiKey);
    return normalizeIPAPI(await fetchJSON(url.href,options),ip);
  },options));
  if(options.ipinfoKey)tasks.push(provider('ipinfo',ip,async()=>normalizeIPinfo(await fetchJSON(`https://ipinfo.io/${encodeURIComponent(ip)}/json`,{...options,headers:[`Authorization: Bearer ${options.ipinfoKey}`]}),ip),options));
  const records=await Promise.all(tasks);
  for(const r of records)if(r.source==='ipapi.is'||r.source==='IPinfo')r.independence_group='commercial-upstream-unverified';
  const flags={};for(const r of records.filter(r=>r.status==='ok'&&!r.stale))for(const [k,v] of Object.entries(r.flags||{}))flags[k]=flags[k]||v;
  const reputation={tested:false,risk:null,coverage:0,sources:[],flags,risk_level:'未确定',note:'零记录或 false 标签不证明绝对安全；网络类型不直接加减风险分'};
  const factors={is_abuser:1,is_tor:1,is_proxy:.6,is_vpn:.3},known=Object.keys(factors).filter(k=>typeof flags[k]==='boolean');
  if(known.length){reputation.tested=true;reputation.risk=Math.max(0,...known.map(k=>flags[k]?factors[k]:0));reputation.coverage=known.length/4;reputation.sources.push(...records.filter(r=>r.flags).map(r=>({source:r.source,checked_at:r.checked_at,flags:r.flags})));}
  if(options.abuseKey) {
    const abuse=await provider('abuseipdb',ip,async()=>{
      const d=(await fetchJSON(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,{...options,headers:[`Key: ${options.abuseKey}`,'Accept: application/json']})).data;
      if(!sameIP(d?.ipAddress,ip)||!Number.isFinite(d.abuseConfidenceScore)||d.abuseConfidenceScore<0||d.abuseConfidenceScore>100)throw new Error('AbuseIPDB 响应无效');
      return {status:'ok',source:'AbuseIPDB',days:90,score:d.abuseConfidenceScore,totalReports:d.totalReports,lastReportedAt:d.lastReportedAt};
    },options);
    reputation.sources.push(abuse);
    if(abuse.status==='ok'&&!abuse.stale){reputation.tested=true;reputation.risk=Math.max(reputation.risk||0,abuse.score/100);reputation.coverage=1;}
  }else reputation.sources.push({source:'AbuseIPDB',status:'untested',reason:'未配置 ABUSEIPDB_API_KEY，跳过增强查询'});
  if(reputation.tested)reputation.risk_level=reputation.risk>=.6?'高':reputation.risk>=.25?'中':'低（仅已测来源）';
  const attribute=fuseEvidence(records);attribute.risk_tags=Object.entries(flags).filter(([k,v])=>v&&['is_abuser','is_tor','is_proxy','is_vpn','is_bogon'].includes(k)).map(([k])=>k);
  return {status:records.some(r=>r.status==='ok')?'ok':'untested',ip,records,attribute,reputation,provider_version:require('../data/providers.json').version,
    api_usage:{queried:records.map(r=>({source:r.source||r.provider,cache:Boolean(r.cached),stale:Boolean(r.stale),checked_at:r.checked_at})),disclosure:'向启用的来源提交目标 IP（Cymru 通过 DNS 名称）；商业来源只在显式授权配置后调用'}};
}
module.exports={normalizeRIPE,normalizeCymru,rdapEndpoint,normalizeRDAP,normalizeIPAPI,normalizeIPinfo,lookupIdentity};
