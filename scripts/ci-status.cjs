'use strict';
// Read-only, public GitHub Actions status. Never print Git proxy credentials.
const cp=require('node:child_process');
const sha=cp.execFileSync('git',['rev-parse','--verify','--end-of-options',(process.argv[2]||'HEAD')+'^{commit}'],{encoding:'utf8'}).trim();
const proxy=cp.spawnSync('git',['config','--get-urlmatch','http.proxy','https://api.github.com/'],{encoding:'utf8'}).stdout?.trim();
const args=['-q','--silent','--show-error','--max-time','25',...(proxy?['--proxy',proxy]:[]),'--url',`https://api.github.com/repos/OpenMili/OpenMili-IP-Toolkit/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=5`];
const r=cp.spawnSync(process.platform==='win32'?'curl.exe':'curl',args,{encoding:'utf8',windowsHide:true});
if(r.status !== 0) throw new Error('GitHub API request failed');
const data=JSON.parse(r.stdout);
const runs=[];
for(const x of data.workflow_runs || []) {
  const jr=cp.spawnSync(process.platform==='win32'?'curl.exe':'curl',['-q','--silent','--show-error','--max-time','25',...(proxy?['--proxy',proxy]:[]),'--url',x.jobs_url],{encoding:'utf8',windowsHide:true});
  const jobs=jr.status===0 ? JSON.parse(jr.stdout).jobs?.map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,active:j.steps?.filter(s=>s.status==='in_progress').map(s=>s.name),failed:j.steps?.filter(s=>s.conclusion==='failure').map(s=>s.name)})) : undefined;
  runs.push({id:x.id,status:x.status,conclusion:x.conclusion,url:x.html_url,jobs});
}
console.log(JSON.stringify({sha,runs,message:data.message}));
