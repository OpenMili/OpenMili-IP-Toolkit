'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { sanitize,environmentSecrets } = require('./privacy');
const { finalizeReport } = require('./schema');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function renderHTML(report, {images={}} = {}) {
  report = sanitize(report,{secrets:environmentSecrets()});
  const e = escapeHtml;
  const json = e(JSON.stringify(report, null, 2));
  const cards = report.score.components.map(c => `<div class="card"><b>${e({reputation:'信誉与风险',websites:'网站访问',routes:'三网路径',dns:'DNS 健康',network:'基础网络',http:'HTTP',browser:'Chromium'}[c.name]||c.name)}</b><strong>${c.reference??'未知'} / 100</strong><progress max="100" value="${c.reference??0}"></progress><small>已测权重 ${c.measured} / ${c.weight}；贡献 ${c.earned}</small></div>`).join('');
  const result = r => !r ? '未测试' : `<span class="${r.kind === 'reachable' ? 'good' : ['network','http-error'].includes(r.kind) ? 'failed' : ['untested','js-required','empty'].includes(r.kind) ? 'muted' : 'bad'}">${e(r.label)}</span><small>${e(r.status || '')} ${r.duration === undefined ? '' : `${e(r.duration)}ms`}<br>${e(r.evidence || r.reason || '')}${r.identityNote ? `<br>${e(r.identityNote)}` : ''}</small>`;
  const rows = report.sites.map(s => `<tr><td><a href="${e(s.url)}" target="_blank" rel="noreferrer">${e(s.name)}</a><small>权重 ${s.weight}</small></td><td>${result(s.httpPlain)}</td><td>${result(s.http)}</td><td>${result(s.browser)}${s.browser?.screenshot ? `<details><summary>查看截图</summary>${images[s.browser.screenshot]?`<img alt="本次页面截图" loading="lazy" src="${images[s.browser.screenshot]}">`:'截图未嵌入'}</details>` : ''}</td><td>${e(s.browser?.title || s.http?.title || '')}<small>${e(s.browser?.finalUrl || s.http?.finalUrl || '')}</small></td></tr>`).join('');
  const records = (report.database.records || []).map(r => `<li><b>${e(r.source)}</b>：${e(r.status === 'ok' ? `AS${r.asns?.join(',')||r.asn||'?'} ${r.owner||r.name||''} | ${r.country || ''} ${r.city || ''}` : `未测试：${r.reason}`)}</li>`).join('');
  const routes = (report.routes.results || []).map(r => `<tr><td>${e(r.name)}<small>${e(r.health?.geography_warning||'')}</small></td><td>${e(r.ip)}<small>IPv${e(r.family)} · ${e(r.health?.status)}</small></td><td>${r.reached ? '到达目标' : '未确定/部分可见'}</td><td>${e(r.lines?.join(' / ') || r.hints?.map(h => `${h}（前缀提示）`).join(' / ') || r.reason || '未识别')}<details><summary>逐跳 IP / RTT / ASN / 协议</summary><pre>${e(JSON.stringify(r.attempts||r.hops,null,2))}</pre></details></td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'"><title>OpenMili IP 质量报告</title><style>
  :root{color-scheme:dark}body{font:15px/1.65 system-ui,sans-serif;background:#101722;color:#dbe5f1;max-width:1220px;margin:40px auto;padding:0 20px}h1{font-size:30px}h2{font-size:20px;margin-top:32px}a{color:#78bdff;overflow-wrap:anywhere}.hero{padding:24px;background:#182638;border:1px solid #30465b;border-radius:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:20px 0}.card{padding:18px;background:#182638;border-radius:12px}.card strong{display:block;font-size:28px}small{display:block;color:#a4b4c6;font-size:12px;overflow-wrap:anywhere}.good{color:#74e6ba}.bad{color:#ffc078}.muted{color:#a4b4c6}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #304052;vertical-align:top}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer}.tag{font-size:24px;color:#8dcfff}
  .failed{color:#ff8b8b}progress{width:100%;accent-color:#4bba9b}img{max-width:100%;height:auto}.theme{display:block;text-align:right}body:has(#light:checked){color-scheme:light;background:#f7f9fc;color:#162438}body:has(#light:checked) .hero,body:has(#light:checked) .card{background:#e7eef6}body:has(#light:checked) small{color:#40546b}body:has(#light:checked) a{color:#075ea8}body:has(#light:checked) .good{color:#087550}body:has(#light:checked) .failed{color:#bb2525}@media(max-width:600px){body{margin:16px auto;padding:0 10px}.hero{padding:16px}h1{font-size:24px}td,th{padding:8px}}@media print{body{background:white;color:black;margin:0;max-width:none}.hero,.card{background:white;border:1px solid #999}small{color:#333}.theme{display:none}details[open]{break-inside:avoid}a{color:#145587}}</style><label class="theme"><input id="light" type="checkbox"> 浅色主题 / Light</label><main><h1>OpenMili · IP 质量报告</h1><div class="hero"><div class="tag">${e(report.score.grade)}</div><p>${['lookup','port'].includes(report.mode) ? '本模式不提供实际出口综合评分' : `已测项目参考分 ${report.score.reference ?? '未知'}/100 · 证据覆盖 ${report.score.coverage}% · 可能范围 ${report.score.range.join('–')} 分`}</p><p>${report.mode === 'lookup'?'查询目标':'出口'} ${e(report.selectedIP || '未获取')} · ${e(report.mode)} · ${e(report.database.attribute?.label || '属性未知')}</p><small>${e(report.startedAt)} | ${e(report.system)} | ${e(report.score.note)}</small></div><div class="cards">${cards}</div>
  <h2>出口与属性</h2><ul>${records}</ul><p>${e(report.database.attribute?.note || '')}</p><p>HTTP 出口核验：${report.httpIdentity?.verified ? '起止观测一致' : '未证实稳定，HTTP 不计入该 IP 评分'}；浏览器出口核验：${report.browser?.identityVerified ? '起止观测一致' : '未证实与目标 IP 一致，浏览器不计入该 IP 评分'}</p>
  <h2>网站实际访问</h2><p>HTTP 原始请求、桌面浏览器请求头、真实 Chromium 分别记录。登录页、地区限制、验证码和网络错误单独呈现。</p><div class="scroll"><table><thead><tr><th>网站</th><th>HTTP 原始</th><th>HTTP 桌面头</th><th>Chromium</th><th>标题 / 最终地址</th></tr></thead><tbody>${rows}</tbody></table></div>
  <h2>${e(report.routes.direction?.label||'三网路径')}</h2><p>${e(report.routes.note || report.routes.reason || '')}</p><div class="scroll"><table><thead><tr><th>目标（目录标注）</th><th>IP</th><th>状态</th><th>观测 ASN 线路</th></tr></thead><tbody>${routes}</tbody></table></div>
  <h2>IP 历史</h2><p>注册事件、近 90 天 BGP 起源、可选举报记录详见以下原始结果；未知历史不推断为干净。</p><pre>${e(JSON.stringify(report.history, null, 2))}</pre>
  ${report.port ? `<h2>目标端口诊断</h2><pre>${e(JSON.stringify(report.port,null,2))}</pre>` : ''}
  ${report.dns ? `<h2>DNS 协议与差异</h2><pre>${e(JSON.stringify(report.dns,null,2))}</pre>` : ''}
  <h2>来源与评分规则</h2><p>工具 ${e(report.tool_version)} · ${e(report.timezone)} · ${e(report.score.model)} · ${e(report.score.model_hash)}</p><p>状态：绿色成功 · 黄色受限 · 红色有证据的失败 · 灰色未知/跳过。低覆盖率不提供综合等级。</p><details><summary>权重、阈值、每项依据与引用</summary><pre>${e(JSON.stringify({model:report.score_model,input:report.score_input},null,2))}</pre></details><h2>与上一次本机报告比较</h2><pre>${e(JSON.stringify(report.comparison, null, 2))}</pre><details><summary>展开全部证据 JSON</summary><pre>${json}</pre></details></main></html>`;
}

async function saveReport(report, output, options = {}) {
  if(options.terminalOnly){
    finalizeReport(report,options);
    return sanitize(report,{secrets:[...environmentSecrets(),...(options.secrets||[])],redact:options.redact,hostnames:[report.environment?.hostname].filter(Boolean)});
  }
  await fs.mkdir(output, { recursive: true });
  const previousPath = path.join(output, '..', 'latest.json');
  let previous;
  try { previous = JSON.parse(await fs.readFile(previousPath, 'utf8')); } catch { /* First run. */ }
  if (previous?.selectedIP === report.selectedIP && report.selectedIP) {
    const changes = report.sites.flatMap(site => {
      const old = previous.sites?.find(s => s.url === site.url);
      if (!old) return [];
      return ['http','browser'].filter(method => old[method]?.kind && site[method]?.kind && old[method].kind !== site[method].kind)
        .map(method => ({ site: site.name, method, before: old[method].kind, after: site[method].kind }));
    });
    report.comparison = { status: 'ok', previousAt: previous.startedAt, changes,
      note: '本机先前报告的观测差异；检测目标、方式和环境变化也会影响结果' };
  } else report.comparison = { status: 'untested', reason: '没有相同出口 IP 的上一次报告' };
  finalizeReport(report,options);
  const safe = sanitize(report,{secrets:[...environmentSecrets(),...(options.secrets || [])],redact:options.redact,hostnames:[report.environment?.hostname].filter(Boolean)});
  const json = JSON.stringify(safe, null, 2);
  await fs.writeFile(path.join(output, 'report.json'), json);
  const images={};
  if(!options.redact)for(const site of safe.sites){
    const name=site.browser?.screenshot;
    if(!/^evidence\/[a-z0-9._-]+\.png$/i.test(name||''))continue;
    try{
      const file=await fs.realpath(path.join(output,name)),root=await fs.realpath(path.join(output,'evidence'));
      if(!file.startsWith(root+path.sep)||(await fs.stat(file)).size>3*1024*1024)continue;
      images[name]='data:image/png;base64,'+(await fs.readFile(file)).toString('base64');
    }catch{/* Missing evidence is explicitly shown as not embedded. */}
  }
  await fs.writeFile(path.join(output, 'report.html'), renderHTML(safe,{images}));
  await fs.writeFile(path.join(output,'report.md'),renderMarkdown(safe));
  const text=renderText(safe);await fs.writeFile(path.join(output,'report.txt'),'\uFEFF'+text);
  await fs.writeFile(path.join(output,'report.ansi'),options.plain||Object.hasOwn(process.env,'NO_COLOR')?text:text.replace(/\b(success|limited|failure|unknown|skipped)\b/gi,x=>`\x1b[${{success:32,limited:33,failure:31,unknown:90,skipped:90}[x.toLowerCase()]}m${x}\x1b[0m`));
  if (options.outputFile) await fs.writeFile(options.outputFile,json,{mode:0o600});
  const latestTemp = `${previousPath}.${process.pid}.tmp`;
  await fs.writeFile(latestTemp, json);
  await fs.rename(latestTemp, previousPath);
  return safe;
}

function renderText(report){
  return `OpenMili-IP-Toolkit ${report.tool_version}\n${report.timestamp} ${report.timezone}\n${report.mode} IPv${report.family} ${report.selectedIP||'UNKNOWN'}\nObserved: ${report.score.reference??'UNKNOWN'}/100 | Coverage: ${report.score.coverage}% | ${report.score.grade_code}\n`+
    require('./ui').summary(report,{plain:true})+'\n';
}
function renderMarkdown(report){
  const cell=x=>escapeHtml(x).replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
  return `# OpenMili-IP-Toolkit ${report.tool_version}\n\n${cell(report.timestamp)} · ${cell(report.mode)} · IPv${report.family}\n\n已测参考分 ${report.score.reference??'未知'}/100；覆盖率 ${report.score.coverage}%；${cell(report.score.grade)}。\n\n| 模块 | 状态 | 判据 |\n|---|---|---|\n`+
    Object.entries(report.modules).map(([k,v])=>`| ${k} | ${v.status} | ${cell(v.reason)} |`).join('\n')+'\n\n| 网站 | HTTP | Chromium |\n|---|---|---|\n'+
    report.sites.map(s=>`| ${cell(s.name)} | ${cell(s.http?.kind||'untested')} | ${cell(s.browser?.kind||'untested')} |`).join('\n')+'\n\n'+cell(report.score.note)+'\n\n完整逐跳、来源、协议与评分输入见同目录 JSON/HTML。\n';
}
module.exports = { escapeHtml, renderHTML, renderMarkdown, renderText, saveReport };
