'use strict';
const crypto=require('node:crypto');
const defaults=require('../data/scoring-v1.json');
const NAMES=['reputation','websites','routes','dns','network'];
const round=n=>Math.round(n*10)/10;
const unit=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
function validateModel(model) {
  if(!model||typeof model.version!=='string'||!model.version||!model.weights||Object.keys(model.weights).sort().join()!==[...NAMES].sort().join())throw new Error('评分模型必须包含版本及五个维度');
  if(Object.values(model.weights).some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)||Math.abs(Object.values(model.weights).reduce((a,b)=>a+b,0)-100)>1e-8)throw new Error('评分权重必须非负且合计 100');
  if(!Number.isFinite(model.minimum_coverage)||model.minimum_coverage<0||model.minimum_coverage>100)throw new Error('评分覆盖率阈值必须为 0–100');
  if(!model.grades||!['excellent','good','fair'].every(k=>Number.isFinite(model.grades[k])&&model.grades[k]>=0&&model.grades[k]<=100)||model.grades.excellent<model.grades.good||model.grades.good<model.grades.fair)throw new Error('评分等级阈值无效');
  if(!model.website_factors||Object.values(model.website_factors).some(n=>!unit(n))||['route_partial_factor','dns_limited_factor','network_single_source_factor'].some(k=>!unit(model[k])))throw new Error('评分比例必须为 0–1');
  return structuredClone(model);
}
function normalizeScoreInput(report,model=defaults) {
  const sample=(factor,weight,ref,reason)=>({factor,weight,ref,reason});
  const data=Object.fromEntries(NAMES.map(n=>[n,[]]));
  const r=report.database?.reputation;
  const coverage=r?.tested&&unit(r.coverage)?r.coverage:0;
  data.reputation=[sample(coverage&&unit(r.risk)?1-r.risk:null,coverage,'/database/reputation','仅采用实际可用的风险字段及来源覆盖；类型与注册年龄不计分')];
  data.websites=(report.sites||[]).map((s,i)=>{
    const method=['browser','http'].find(k=>s[k]?.identityVerified===true&&!s[k]?.identityMismatch&&Object.hasOwn(model.website_factors,s[k]?.kind));
    return sample(method?model.website_factors[s[method].kind]:null,s.weight||1,`/sites/${i}/${method||'http'}`,method?`${method}: ${s[method].kind}`:'实际出口未核实或页面证据未知');
  });
  data.routes=(report.routes?.results||[]).map((r,i)=>sample(r.reached?1:r.hops?.some(h=>h.ip)?model.route_partial_factor:null,1,`/routes/results/${i}`,r.reached?'实际到达':r.hops?.some(h=>h.ip)?'仅部分路径可见':'匿名跳/工具缺失/无响应，原因未知'));
  data.dns=(report.dns?.checks||[]).map((c,i)=>sample(c.status==='success'?1:c.status==='limited'?model.dns_limited_factor:c.status==='failure'?0:null,1,`/dns/checks/${i}`,c.code||c.reason||'DNS 未知'));
  const families=report.familyExplicit?[report.family]:[4,6];
  data.network=families.map(f=>{
    const e=report.exit?.[`v${f}`];
    return sample(e?.stable?1:e?.rotating?0:e?.ip?model.network_single_source_factor:null,1,`/exit/v${f}`,e?.stable?'至少两个独立 HTTPS 回显源一致（包含 DNS/TCP/TLS）':e?.rotating?'实际出口不一致':'独立网络观测不足');
  });
  return {version:'score-input-v1',eligible:!['lookup','port','doctor'].includes(report.mode)&&!['lookup','port','doctor'].includes(report.command),dimensions:data};
}
function calculateScore(input,model=defaults) {
  model=validateModel(model);
  if(input?.version!=='score-input-v1'||typeof input.eligible!=='boolean'||!input.dimensions)throw new Error('不支持的评分输入');
  const components=NAMES.map(name=>{
    const samples=input.dimensions[name];
    if(!Array.isArray(samples)||samples.some(s=>!(s.factor===null||unit(s.factor))||!Number.isFinite(s.weight)||s.weight<0||typeof s.ref!=='string'))throw new Error(`无效评分样本 ${name}`);
    const totalWeight=name==='reputation'?1:samples.reduce((s,x)=>s+x.weight,0);
    const known=samples.filter(x=>x.factor!==null),testedWeight=known.reduce((s,x)=>s+x.weight,0);
    if(name==='reputation'&&testedWeight>1)throw new Error('风险覆盖率超过 1');
    const measured=totalWeight?model.weights[name]*testedWeight/totalWeight:0;
    const earned=totalWeight?model.weights[name]*known.reduce((s,x)=>s+x.weight*x.factor,0)/totalWeight:0;
    return {name,weight:model.weights[name],measured,earned,testedWeight,totalWeight,reference:measured?round(earned/measured*100):null,evidence:samples};
  });
  const coverage=input.eligible?components.reduce((s,c)=>s+c.measured,0):0,earned=input.eligible?components.reduce((s,c)=>s+c.earned,0):0;
  const reference=coverage?round(earned/coverage*100):null,enough=input.eligible&&coverage>=model.minimum_coverage&&coverage>0;
  const gradeCode=!input.eligible?'not-applicable':!enough?'insufficient':reference>=model.grades.excellent?'excellent':reference>=model.grades.good?'good':reference>=model.grades.fair?'fair':'limited';
  return {model:model.version,model_hash:crypto.createHash('sha256').update(JSON.stringify(model)).digest('hex'),earned:round(earned),coverage:round(coverage),reference,overall:enough?reference:null,
    range:[round(earned),round(Math.min(100,earned+100-coverage))],grade_code:gradeCode,
    grade:{'not-applicable':'不提供实测综合评分',insufficient:'证据不足',excellent:'优秀（本次样本）',good:'良好（本次样本）',fair:'一般（本次样本）',limited:'受限较多（本次样本）'}[gradeCode],
    components:components.map(c=>({...c,earned:round(c.earned),measured:round(c.measured)})),
    note:'已测部分重新归一化，未知项不按失败处理；覆盖不足不评级。网络类型不加减分，网页成功不代表注册、播放或绝对安全。'};
}
function scoreReport(report,model=report.score_model||defaults) {return calculateScore(report.score_input||normalizeScoreInput(report,model),model);}
module.exports={defaults,validateModel,normalizeScoreInput,calculateScore,scoreReport};
