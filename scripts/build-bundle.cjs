'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {npmCommand,npmEnvironment}=require('../lib/npm-runtime');
const {runProcess}=require('../lib/transport');
const pkg=require('../package.json');
async function command(cmd,args,options={}){const r=await runProcess(cmd,args,{timeout:180000,maxOutput:1024*1024,...options});if(r.code!==0||r.error)throw new Error(`${cmd} failed: ${r.error||r.stderr.slice(0,2000)+'\n'+r.stderr.slice(-1000)}`);return r;}
async function removeLinks(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())await fs.unlink(p);else if(e.isDirectory())await removeLinks(p);}}
(async()=>{
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-bundle-')),dist=path.resolve('dist');
  try{
    for(const name of [...pkg.files,'package.json','package-lock.json','LICENSE'])await fs.cp(path.resolve(name),path.join(stage,name),{recursive:true,dereference:true});
    const npm=npmCommand(['ci','--prefix',stage,'--omit=dev','--ignore-scripts','--no-audit','--no-fund']);await command(npm.command,npm.args,{cwd:stage,env:npmEnvironment()});
    const cli=npm.args[0];if(!/npm-cli\.js$/.test(cli))throw new Error('Cannot locate npm source for portable worker installer');
    await fs.cp(path.resolve(path.dirname(cli),'..'),path.join(stage,'runtime-npm'),{recursive:true,dereference:true});
    await fs.copyFile(process.execPath,path.join(stage,process.platform==='win32'?'node.exe':'node'));
    const license=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,{signal:AbortSignal.timeout(30000)});if(!license.ok)throw new Error('Node runtime license unavailable');
    await fs.writeFile(path.join(stage,'NODE-LICENSE.txt'),await license.text());
    await removeLinks(stage);
    await fs.writeFile(path.join(stage,'runtime-manifest.json'),JSON.stringify({tool:pkg.version,node:process.version,platform:process.platform,arch:process.arch,source_commit:process.env.GITHUB_SHA||'local-build',runtime_sha256:crypto.createHash('sha256').update(await fs.readFile(process.execPath)).digest('hex')},null,2));
    await fs.mkdir(dist,{recursive:true});const name=`OpenMili-IP-Toolkit-v${pkg.version}-${process.platform}-${process.arch}.tar.gz`,file=path.join(dist,name);
    await command('tar',['-czf',file,'-C',stage,'.']);
    const checksum=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');await fs.writeFile(file+'.sha256',`${checksum}  ${name}\n`);
    console.log(JSON.stringify({file,checksum,bytes:(await fs.stat(file)).size}));
  }finally{await fs.rm(stage,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
