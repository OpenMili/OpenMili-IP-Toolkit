'use strict';
// Dispatch native release verification; uses the existing Git credential helper without logging credentials.
const cp=require('node:child_process');
const workflow=process.argv[2]||'release.yml',ref=process.argv[3]||'main';
if(!/^[a-z-]+\.yml$/.test(workflow)||!/^[a-zA-Z0-9_./-]+$/.test(ref))throw new Error('Invalid workflow/ref');
const credential=cp.spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true});
const token=credential.stdout?.match(/^password=(.+)$/m)?.[1];if(!token)throw new Error('GitHub credential helper unavailable');
const proxy=cp.spawnSync('git',['config','--get-urlmatch','http.proxy','https://api.github.com/'],{encoding:'utf8',windowsHide:true}).stdout?.trim();
const result=cp.spawnSync(process.platform==='win32'?'curl.exe':'curl',['-q','--silent','--show-error','--max-time','30',...(proxy?['--proxy',proxy]:[]),'--config','-','--request','POST','--header','Accept: application/vnd.github+json','--header','Content-Type: application/json','--data',JSON.stringify({ref}),'--write-out','\n%{http_code}','--url',`https://api.github.com/repos/OpenMili/OpenMili-IP-Toolkit/actions/workflows/${workflow}/dispatches`],{input:`header = "Authorization: Bearer ${token.replace(/["\\\r\n]/g,'')}"\n`,encoding:'utf8',windowsHide:true});
const status=result.stdout?.trim().split('\n').at(-1);
if(result.status!==0||status!=='204')throw new Error(`Workflow dispatch failed HTTP ${status||'unavailable'} (credentials hidden)`);
console.log(`Dispatched ${workflow} at ${ref}; no release is published by a main-branch dispatch.`);
