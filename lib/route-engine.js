'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {canonicalIP,isPublicIP}=require('./core');
const {wireQuery}=require('./dns');
const {provider,fetchJSON}=require('./provider');
const {normalizeRIPE}=require('./providers');
const {runProcess,mapLimit}=require('./transport');
const {state}=require('./status');
const {stats}=require('./port');
const directory=require('../data/route-nodes.json');
const LINE_ASNS={4134:'电信 163',4809:'电信 CN2 相关（不能证明 GIA/GT）',4837:'联通 4837',9929:'联通 9929',9808:'移动骨干',58453:'移动 CMI',58807:'移动 CMIN2'};
function parseHops(raw,destination) {
  const hops=[];
  for(const line of String(raw).split(/\r?\n/)) {
    const m=line.match(/^\s*(\d+)\s+(.+)$/);if(!m)continue;
    const tokens=m[2].replace(/[()[\],]/g,' ').split(/\s+/);
    const ips=[...new Set(tokens.filter(t=>net.isIP(t)).map(canonicalIP))];
    const samples=[...m[2].matchAll(/(<)?\s*(\d+(?:\.\d+)?)\s*(?:ms\b|毫秒)/gi)].map(r=>({ms:Number(r[2]),upper_bound:Boolean(r[1])}));
    const anonymous=(m[2].match(/\*/g)||[]).length;
    hops.push({hop:+m[1],ip:ips[0]||null,ips,rtt_samples:samples,rtt_ms:samples.filter(x=>!x.upper_bound).map(x=>x.ms),
      rtt:stats(samples.filter(x=>!x.upper_bound).map(x=>x.ms)),anonymous_probes:anonymous,anonymous:!ips.length,
      response_samples:samples.length,line:line.trim().slice(0,1000)});
  }
  return {hops,reached:hops.some(h=>h.ips.includes(canonicalIP(destination)))};
}
function routeDirection(options={}) {
  const country=options.originCountry||null;
  return country==='CN'?{kind:'outbound',label:'本机出站/去程',warning:'发起地声明在中国；这不是海外目标服务器的回程',source:'user-declared',verified:false}
    :country?{kind:'return-candidate',label:'向中国方向的单向路径',warning:'发起地来自用户声明，单向路径不能证明双向对称或所有省份',source:'user-declared',verified:false,country}
      :{kind:'unknown',label:'本机出站路径（回程方向未核实）',warning:'发起地未得到可核验地理证据；这不能冒充目标服务器的回程',source:'unknown',verified:false};
}
function traceCommand(ip,protocol,options={}) {
  const platform=options.platform||process.platform,family=net.isIP(ip),maxHops=options.maxHops||20;
  if(!family)throw new Error('traceroute 必须使用已解析的 IP');
  if(!['icmp','tcp','udp'].includes(protocol))throw new Error('无效 traceroute 协议');
  if(platform==='win32') {
    if(protocol!=='icmp')return null;
    if(options.sourceIP&&family!==6)return null;
    return {command:'tracert.exe',args:[`-${family}`,'-d','-h',String(maxHops),'-w','300',...(options.sourceIP?['-S',options.sourceIP]:[]),ip],method:'icmp',backend:'Windows tracert'};
  }
  if(platform==='linux')return {command:'traceroute',args:[`-${family}`,'-n','-m',String(maxHops),'-q','3','-w','1',...(protocol==='icmp'?['-I']:protocol==='tcp'?['-T','-p','443']:['-U','-p','33434']),...(options.sourceIP?['-s',options.sourceIP]:[]),ip],method:protocol,backend:'Linux traceroute'};
  if(platform==='darwin') {
    if(family===6&&protocol==='tcp')return null;
    return {command:family===6?'traceroute6':'traceroute',args:['-n','-m',String(maxHops),'-q','3','-w','1',...(protocol==='icmp'?['-I']:protocol==='tcp'?['-P','tcp','-p','443']:[]),...(options.sourceIP?['-s',options.sourceIP]:[]),ip],method:protocol,backend:'macOS traceroute'};
  }
  return null;
}
async function runTraceroute(ip,protocol,options={}) {
  const command=traceCommand(ip,protocol,options),meta={target:ip,family:net.isIP(ip),protocol,source_ip:options.sourceIP||null,started_at:new Date().toISOString()};
  if(options.proxy||options.offline||options.signal?.aborted)return state('skipped',options.offline?'OFFLINE':options.proxy?'PROXY_ROUTE_UNSUPPORTED':'ABORTED','不会绕过指定代理或离线约束',{...meta,hops:[]});
  if(!command)return state('skipped','ROUTE_UNSUPPORTED','本平台系统工具不支持所选协议/来源绑定；未回退其他方法',{...meta,hops:[]});
  const r=await (options.runProcess||runProcess)(command.command,command.args,{timeout:options.routeTimeout||25000,maxOutput:128*1024,signal:options.signal});
  const parsed=parseHops(r.stdout,ip),visible=parsed.hops.some(h=>h.ips.length);
  if(r.error?.includes('ENOENT'))return state('skipped','ROUTE_TOOL_MISSING',`缺少 ${command.command}；请使用系统包管理器安装`,{...meta,hops:[],backend:command.backend});
  return state(parsed.reached?'success':visible?'limited':'unknown',parsed.reached?'ROUTE_REACHED':visible?'ROUTE_PARTIAL':'ROUTE_UNDETERMINED',
    r.error||(!parsed.reached?'未到达；权限、节点、ICMP 限制或路径原因均可能，不能认定线路差':'已到达本次目标'),
    {...meta,...parsed,backend:command.backend,exit_code:r.code,raw:r.stdout.slice(0,32000),stderr:r.stderr.slice(0,1000),
      sampling:'系统工具请求每跳 3 次；RTT <1ms 作为上界保留，不虚构精确值；无返回不能证明链路丢包'});
}
async function hopASN(ip,options={}) {
  if(!isPublicIP(ip))return {asns:[],source:'非公网跳点，不查询外部库'};
  const r=await provider('ripe',ip,async()=>normalizeRIPE(await fetchJSON(`https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(ip)}`,{...options,timeout:5000}),ip),options);
  return {asns:r.status==='ok'&&!r.stale?r.asns:[],source:'RIPE RIS',prefix:r.prefix,checked_at:r.checked_at,status:r.status,reason:r.reason};
}
async function resolveNode(node,family,options={}) {
  if(node.ip)return {...node,family:net.isIP(node.ip),health:{status:'unknown',reason:'用户指定的实际目标，尚未核验运营商'}};
  const host=node[`ipv${family}`];
  if(!host)return {...node,family,health:{status:'unknown',reason:'目录没有该协议族目标'}};
  const r=await (options.queryDNS||wireQuery)(host,family===6?'AAAA':'A',{...options,server:options.resolver,protocol:'udp'});
  const addresses=r.answers?.filter(a=>a.type===(family===6?'AAAA':'A')&&net.isIP(a.data)===family&&isPublicIP(a.data)).map(a=>a.data)||[];
  if(!addresses.length)return {...node,family,host,health:{status:'unknown',reason:r.reason||'没有对应公网地址',dns:r}};
  const ip=addresses[0],origin=await hopASN(ip,options),matches=origin.asns.some(a=>node.expected_asns.includes(a));
  return {...node,family,host,ip,health:{status:matches?'verified':origin.asns.length?'mismatch':'unknown',verification_scope:'DNS + BGP，尚未证明探测可达或实际城市',region_status:'unknown',geography_warning:node.geography_warning||'目录标注城市，尚未独立定位；ASN 登记地不等于实际终点城市',reason:matches?'DNS 目标与当前 BGP 归属匹配':'尚未证明目录目标的运营商归属',origin,dns:r,last_routing_verified_at:matches?new Date().toISOString():null,last_successful_at:null}};
}
async function measureRoutes(customTargets,options={},log=()=>{}) {
  const direction=routeDirection(options);
  if(options.offline||options.proxy||options.signal?.aborted)return {status:'untested',reason:options.offline?'离线模式':options.proxy?'系统路由不能穿过 HTTP/SOCKS 代理；请在授权主机本机执行':'用户中止',direction,results:[]};
  let nodes=customTargets||directory.nodes;
  if(options.region)nodes=nodes.filter(n=>options.region.includes(n.region));
  if(options.isp&&options.isp!=='all')nodes=nodes.filter(n=>n.isp===options.isp);
  const family=options.family||4,protocols=options.routeProtocols||['icmp','tcp','udp'];
  const results=await mapLimit(nodes,Math.min(options.concurrency||3,3),async node=>{
    const target=await resolveNode(node,family,options);
    if(!target.ip||target.family!==family||target.health.status==='mismatch')return {...target,status:'untested',reason:target.health.reason,hops:[]};
    const attempts=[];
    for(const protocol of protocols){if(options.signal?.aborted)break;attempts.push(await runTraceroute(target.ip,protocol,options));if((options.routeAuto??!options.routeProtocols)&&attempts.at(-1).reached)break;}
    const best=attempts.find(a=>a.reached)||attempts.find(a=>a.hops?.some(h=>h.ip))||attempts[0]||{hops:[],status:'unknown',reason:'未执行'};
    const allIPs=[...new Set(attempts.flatMap(a=>a.hops||[]).flatMap(h=>h.ips||[]))];
    const entries=await mapLimit(allIPs,2,async ip=>[ip,await hopASN(ip,options)]),asnMap=new Map(entries);
    for(const attempt of attempts)for(const hop of attempt.hops||[])hop.asn_evidence=(hop.ips||[]).map(ip=>({ip,...asnMap.get(ip)}));
    const transit=entries.filter(([ip])=>ip!==target.ip).flatMap(([,r])=>r.asns),lines=[...new Set(transit.filter(a=>LINE_ASNS[a]).map(a=>LINE_ASNS[a]))];
    const operators=new Set(transit.map(a=>[4134,4809].includes(a)?'telecom':[4837,9929].includes(a)?'unicom':[9808,58453,58807].includes(a)?'mobile':null).filter(Boolean));
    if(attempts.some(a=>a.reached))target.health.last_successful_at=new Date().toISOString();
    const result={...target,status:attempts.some(a=>a.hops?.some(h=>h.ip))?'ok':'untested',hops:best.hops||[],reached:attempts.some(a=>a.reached),attempts,lines,direction,
      mixed_operators:operators.size>1,mixed_backbones:lines.length>1,detour:'unknown（缺少可验证的逐跳地理证据）',reason:best.reason,
      rtt:stats(attempts.flatMap(a=>a.hops?.filter(h=>h.ips.includes(target.ip)).flatMap(h=>h.rtt_ms)||[]))};
    log(`路径 ${target.name} IPv${family}: ${result.reached?'已到达':'未确定/部分可见'} | ${lines.join(' / ')||'线路未识别'}`);return result;
  });
  try{
    const dir=options.cacheDir||path.join(os.homedir(),'.openmili-ip','cache');await fs.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,'route-health.json'),temp=file+`.${process.pid}.tmp`;
    let previous;try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
    const key=n=>`${n.family}:${n.host||n.ip||n.name}`;
    const records=new Map((previous?.nodes||[]).map(n=>[key(n),n]));
    for(const r of results){
      const old=records.get(key(r)),checked_at=new Date().toISOString();
      records.set(key(r),{host:r.host,ip:r.ip,family:r.family,name:r.name,health:r.health,
        last_successful_at:r.health?.last_successful_at||(old?.ip===r.ip?old.last_successful_at:null)||null,checked_at,
        history:[...(old?.history||[]),{checked_at,ip:r.ip,reached:Boolean(r.reached),status:r.status}].slice(-10)});
    }
    await fs.writeFile(temp,JSON.stringify({version:directory.version,source:directory.source,nodes:[...records.values()]}),{mode:0o600});await fs.rename(temp,file);
  }catch{/* Read-only or low-permission environments retain in-memory evidence. */}
  return {status:results.some(r=>r.status==='ok')?'ok':'untested',results,direction,directory_version:directory.version,source:directory.source,
    note:direction.warning+'；路径/时段/节点只是样本，ASN 命中不能证明 CN2 GIA，ICMP 静默不等于信誉差。'};
}
module.exports={parseHops,routeDirection,traceCommand,runTraceroute,hopASN,resolveNode,measureRoutes};
