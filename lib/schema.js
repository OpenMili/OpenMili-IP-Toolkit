'use strict';
const Ajv = require('ajv');
const { state } = require('./status');
const { scoreReport } = require('./core');
const { defaults,normalizeScoreInput,validateModel } = require('./scoring');
const { websiteState } = require('./status');
const version = require('../package.json').version;
const validate = new Ajv({allErrors:true,strict:true}).compile(require('../schemas/report-v1.schema.json'));
function finalizeReport(report, options = {}) {
  report.database ||= {status:'untested',records:[]}; report.routes ||= {status:'untested',results:[]}; report.sites ||= [];
  report.history ||= {status:'untested'};
  report.schema_version='1.0.0'; report.tool_version=version;
  report.timestamp=report.startedAt || new Date().toISOString();
  report.mode=options.command === 'lookup' || report.mode === 'lookup' ? 'lookup' : options.command === 'port' ? 'port' : report.mode === 'proxy' ? 'proxy' : 'local';
  report.command=options.command||report.command||'all';
  report.score_model=validateModel(options.scoringModel||report.score_model||defaults);
  report.score_input=normalizeScoreInput(report,report.score_model);
  report.score=scoreReport(report);
  report.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const exit = report.exit?.[`v${report.family}`];
  report.target={ ip:report.selectedIP || null,family:report.family || null,exit_ip:report.mode === 'lookup' ? null : exit?.ip || null,exit_verified:report.mode !== 'lookup' && Boolean(exit?.stable), ...(options.host ? {host:options.host,port:options.targetPort} : {}) };
  const moduleOf = (value,code) => value?.checked_at && ['success','limited','failure','unknown','skipped'].includes(value.status) ? value : state(value?.status === 'ok' ? 'success' : value ? 'unknown' : 'skipped',code,value?.reason || (value ? '详见模块证据' : '本次未执行'),{evidence:value || null});
  report.modules={
    system:moduleOf(report.environment,'SYSTEM'), identity:moduleOf(report.database,'IDENTITY'),
    routing:moduleOf(report.routes,'ROUTING'), history:moduleOf(report.history,'HISTORY'),
    websites:aggregate(report.sites.map(s=>s.browser&&s.browser.kind!=='untested'?websiteState(s.browser.kind):websiteState(s.http?.kind)),'WEBSITES',{results:report.sites}),
    reputation:moduleOf(report.database.reputation?.tested ? {status:'ok',...report.database.reputation} : null,'REPUTATION'),
    dns:moduleOf(report.dns,'DNS'),
    ...(report.port ? {port:moduleOf(report.port,'PORT')} : {})
  };
  if(report.routes.results.length)report.modules.routing=aggregate(report.routes.results.map(r=>r.reached?'success':r.hops?.some(h=>h.ip)?'limited':'unknown'),'ROUTING',{evidence:report.routes});
  if(report.dns?.checks)report.modules.dns=aggregate(report.dns.checks.map(c=>c.status),'DNS',{evidence:report.dns});
  if(report.database.attribute?.type==='UNKNOWN')report.modules.identity.status='unknown';
  else if(report.database.attribute?.conflict)report.modules.identity.status='limited';
  const scoreEnabled=report.score_input.eligible;
  report.scores={ overall:report.score.overall,
    observed:scoreEnabled ? report.score.reference : null, coverage_percent:scoreEnabled ? report.score.coverage : 0,
    model_version:report.score.model, type_confidence:report.database.attribute?.confidence || null,
    risk_level:report.database.reputation?.risk_level||'未确定',
    data_freshness:report.database.attribute?.coverage||null,
    unknown_reason:scoreEnabled ? report.score.grade_code === 'insufficient' ? '覆盖率不足，未提供综合等级' : null : '此模式不提供实际出口综合评分' };
  report.errors ||= [];
  if (options.signal?.aborted) report.errors.push({code:'ABORTED',reason:'用户中止；保留已完成结果'});
  if (!validate(report)) throw new Error(`报告 schema 校验失败: ${JSON.stringify(validate.errors)}`);
  return report;
}
function aggregate(statuses,code,details={}) {
  const observed=statuses.filter(s=>['success','limited','failure'].includes(s));
  const status=!statuses.length?'skipped':!observed.length?'unknown':observed.every(s=>s==='failure')&&observed.length===statuses.length?'failure':observed.every(s=>s==='success')&&observed.length===statuses.length?'success':'limited';
  return state(status,code,`${observed.length}/${statuses.length} 项有明确观测；详见各项判据`,details);
}
module.exports = { validateReport:validate,finalizeReport };
