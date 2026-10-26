'use strict';
const cp=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
  const output=path.join(root,'.artifacts','websites-'+new Date().toISOString().replace(/[:.]/g,'-'));
  const proxy=process.argv.includes('--git-proxy')?cp.spawnSync('git',['config','--get-urlmatch','http.proxy','https://api.github.com/'],{encoding:'utf8'}).stdout?.trim():'';
  const args=[path.join(root,'bin/openmili.js'),'websites','--mode',process.argv.includes('--browser')?'browser':'http','--no-install-browser','--redact','--no-pause','--timeout','8','--min-delay','.5','--max-delay','.5','--output',output,...(proxy?['--proxy',proxy]:[])];
  // CLI numeric parsing requires an explicit integer part.
  for(let i=0;i<args.length;i++)if(args[i]==='.5')args[i]='0.5';
  await new Promise((resolve,reject)=>{
    const child=cp.spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>process.stderr.write(b));
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`Probe exit ${code}`)));
  });
  const report=JSON.parse(await fs.readFile(path.join(output,'latest.json'),'utf8'));
  const counts={};for(const site of report.sites)counts[site.http.kind]=(counts[site.http.kind]||0)+1;
  console.log(JSON.stringify({artifact:output,sites:report.sites.length,counts,coverage:report.score.coverage,exitVerified:report.httpIdentity?.verified,proxy:Boolean(proxy)}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
