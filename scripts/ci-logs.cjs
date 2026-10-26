'use strict';
const cp=require('node:child_process');
const fs=require('node:fs');
const {sanitizeText}=require('../lib/privacy');
const run=process.argv[2];if(!/^\d+$/.test(run||''))throw new Error('Pass numeric Actions run ID');
const proxy=cp.spawnSync('git',['config','--get-urlmatch','http.proxy','https://api.github.com/'],{encoding:'utf8'}).stdout?.trim();
const credential=cp.spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true}).stdout;
const token=credential?.match(/^password=(.+)$/m)?.[1];
function get(url){
  const r=cp.spawnSync(process.platform==='win32'?'curl.exe':'curl',['-q','--silent','--show-error','--fail','--location','--max-time','45',...(proxy?['--proxy',proxy]:[]),...(token?['--config','-']:[]),'--url',url],{input:token?`header = "Authorization: Bearer ${token.replace(/["\\\r\n]/g,'')}"\n`:undefined,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
  if(r.status!==0)throw new Error('GitHub logs unavailable (credentials hidden)');return r.stdout;
}
const jobs=JSON.parse(get(`https://api.github.com/repos/OpenMili/OpenMili-IP-Toolkit/actions/runs/${run}/jobs`)).jobs;
fs.mkdirSync('.artifacts/ci',{recursive:true});
for(const job of jobs.filter(j=>j.conclusion==='failure')){
  const logs=get(`https://api.github.com/repos/OpenMili/OpenMili-IP-Toolkit/actions/jobs/${job.id}/logs`);
  const safe=sanitizeText(logs,{secrets:[token,proxy].filter(Boolean)});fs.writeFileSync(`.artifacts/ci/${job.id}.log`,safe);
  console.log(job.name+' '+job.id);console.log(safe.split('\n').slice(-95).join('\n'));
}
