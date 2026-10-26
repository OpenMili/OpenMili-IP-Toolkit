'use strict';
const TYPES=['UNKNOWN','MOBILE','RESIDENTIAL','SUSPECTED_RESIDENTIAL','BUSINESS','DATACENTER','OTHER'];
const LABELS={UNKNOWN:'未知（证据不足或冲突）',MOBILE:'移动网络倾向',RESIDENTIAL:'住宅网络倾向',SUSPECTED_RESIDENTIAL:'疑似住宅标签冲突',BUSINESS:'企业/商业宽带倾向',DATACENTER:'机房/云网络倾向',OTHER:'其他网络'};
function networkType(value) {
  const t=String(value||'').toLowerCase();
  return /hosting|datacenter|data_center|cloud/.test(t)?'DATACENTER':/residential|fixed.?broadband/.test(t)?'RESIDENTIAL':/mobile|cellular/.test(t)?'MOBILE':/business|enterprise/.test(t)?'BUSINESS':/education|government|cdn/.test(t)?'OTHER':'UNKNOWN';
}
function fuseEvidence(records,{now=Date.now()}={}) {
  const successful=records.filter(r=>r.status==='ok'),claims=[],asnSet=new Set();
  for(const r of successful) {
    if(!r.stale)for(const asn of r.asns||[r.asn])if(Number.isInteger(asn)&&asn>0)asnSet.add(asn);
    const type=networkType(r.network_type);
    if(type==='UNKNOWN')continue;
    const age=now-new Date(r.checked_at).getTime();
    const fresh=!r.stale && Number.isFinite(age) && age>=-60000 && age<=7*86400000;
    const strong=['ip','prefix'].includes(r.granularity);
    const sourceAge=now-new Date(r.source_updated_at).getTime();
    const sourceFresh=r.source_updated_at&&Number.isFinite(sourceAge)&&sourceAge>=-60000&&sourceAge<=30*86400000;
    const freshness=fresh?(sourceFresh?1:.5):0,granularity=r.granularity==='prefix'?1:r.granularity==='ip'?.8:.15;
    claims.push({id:`${r.provider||r.source}:${type}`,type,source:r.source,independence_group:r.independence_group||'unknown-dependency',granularity:r.granularity||'asn',
      checked_at:r.checked_at,source_updated_at:r.source_updated_at||null,data_freshness:sourceFresh?'recent-source-timestamp':'source-update-unknown-or-old',weight:Math.round(100*freshness*granularity*(r.reliability||.6)),
      admissible:strong&&fresh,evidence:r.type_evidence||r.network_type});
  }
  const groups=new Map();
  for(const c of claims.filter(c=>c.admissible)) {
    const key=`${c.independence_group}:${c.type}`;
    if(!groups.has(key)||groups.get(key).weight<c.weight)groups.set(key,c);
  }
  const votes={};for(const c of groups.values())votes[c.type]=(votes[c.type]||0)+c.weight;
  const ranked=Object.entries(votes).sort((a,b)=>b[1]-a[1]);
  const candidate=ranked[0]?.[0]||'UNKNOWN',supports=claims.filter(c=>c.type===candidate),opposes=claims.filter(c=>c.type!==candidate);
  const independent=new Set(supports.filter(c=>c.admissible).map(c=>c.independence_group)).size;
  const conflict=ranked.length>1,asnConflict=asnSet.size>1;
  const residentialConflict=claims.some(c=>c.type==='RESIDENTIAL'&&c.admissible) && (claims.some(c=>c.type==='DATACENTER'&&c.admissible)||successful.some(r=>!r.stale&&r.flags?.is_proxy===true));
  let type=residentialConflict?'SUSPECTED_RESIDENTIAL':!conflict&&independent>=2?candidate:'UNKNOWN';
  if(!TYPES.includes(type))type='UNKNOWN';
  const confidence=type==='UNKNOWN'?Math.min(40,ranked[0]?.[1]||0):residentialConflict?45:Math.min(90,Math.round((ranked[0]?.[1]||0)/independent));
  return {type,label:LABELS[type],candidate,subtype:null,risk_tags:[],confidence,confidence_label:confidence>=75?'高':confidence>=50?'中':'低',
    conflict,asn_conflict:asnConflict,asns:[...asnSet],claims,supporting:supports,opposing:opposes,
    coverage:{queried:records.length,available:successful.length,type_sources:claims.length,independent_supports:independent,stale:records.filter(r=>r.stale).length},
    reason:type==='UNKNOWN'?'缺少两组独立且新鲜的 IP/前缀使用类型证据，或来源冲突':residentialConflict?'住宅标签与托管/代理证据矛盾，仅提示疑似':'多源 IP/前缀级证据一致；仍非确定使用者身份',
    note:'BGP ASN/组织名称是网络归属信息，不单独证明住宅、移动、企业或云主机。商业来源的上游依赖未核实时合为同一组，查询时间不等于数据库更新时间。'};
}
module.exports={TYPES,networkType,fuseEvidence};
