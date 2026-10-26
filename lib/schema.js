'use strict';
const Ajv = require('ajv');
const { state } = require('./status');
const { scoreReport } = require('./core');
const version = require('../package.json').version;
const validate = new Ajv({allErrors:true,strict:true}).compile(require('../schemas/report-v1.schema.json'));
function finalizeReport(report, options = {}) {
  report.score ||= scoreReport(report);
  report.database ||= {status:'untested',records:[]}; report.routes ||= {status:'untested',results:[]}; report.sites ||= [];
  report.history ||= {status:'untested'};
  report.schema_version='1.0.0'; report.tool_version=version;
  report.timestamp=report.startedAt || new Date().toISOString();
  report.mode=options.command === 'lookup' || report.mode === 'lookup' ? 'lookup' : options.command === 'port' ? 'port' : report.mode === 'proxy' ? 'proxy' : 'local';
  const exit = report.exit?.[`v${report.family}`];
  report.target={ ip:report.selectedIP || null,family:report.family || null,exit_ip:report.mode === 'lookup' ? null : exit?.ip || null,exit_verified:report.mode !== 'lookup' && Boolean(exit?.stable), ...(options.host ? {host:options.host,port:options.targetPort} : {}) };
  const moduleOf = (value,code) => value?.checked_at && ['success','limited','failure','unknown','skipped'].includes(value.status) ? value : state(value?.status === 'ok' ? 'success' : value ? 'unknown' : 'skipped',code,value?.reason || (value ? '详见模块证据' : '本次未执行'),{evidence:value || null});
  report.modules={
    system:moduleOf(report.environment,'SYSTEM'), identity:moduleOf(report.database,'IDENTITY'),
    routing:moduleOf(report.routes,'ROUTING'), history:moduleOf(report.history,'HISTORY'),
    websites:state(report.sites.length?'success':'skipped',report.sites.length?'WEBSITE_OBSERVED':'WEBSITE_SKIPPED',report.sites.length?'汇总状态表示已执行，具体成功/受限/失败见每站证据':'本次未执行',{results:report.sites}),
    reputation:moduleOf(report.database.reputation?.tested ? {status:'ok',...report.database.reputation} : null,'REPUTATION'),
    dns:moduleOf(report.dns,'DNS'),
    ...(report.port ? {port:moduleOf(report.port,'PORT')} : {})
  };
  const scoreEnabled = !['lookup','port'].includes(report.mode);
  if (!scoreEnabled) report.score={model:report.score.model,earned:0,coverage:0,range:[0,100],reference:null,components:[],grade:'不提供实测综合评分',note:'数据库查询或目标端口诊断不代表通过该 IP 完成全部实测。'};
  report.scores={ overall:scoreEnabled && report.score.grade !== '证据不足' ? report.score.reference : null,
    observed:scoreEnabled ? report.score.reference : null, coverage_percent:scoreEnabled ? report.score.coverage : 0,
    model_version:report.score.model, type_confidence:report.database.attribute?.confidence || null,
    unknown_reason:scoreEnabled ? report.score.grade === '证据不足' ? '覆盖率不足，未提供综合等级' : null : '此模式不提供实际出口综合评分' };
  report.errors ||= [];
  if (options.signal?.aborted) report.errors.push({code:'ABORTED',reason:'用户中止；保留已完成结果'});
  if (!validate(report)) throw new Error(`报告 schema 校验失败: ${JSON.stringify(validate.errors)}`);
  return report;
}
module.exports = { validateReport:validate,finalizeReport };
