'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const install=require('../lib/installation');
const {runProcess}=require('../lib/transport');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-portable-test-'));
  try{
    const dist=path.resolve('dist'),name=(await fs.readdir(dist)).find(n=>n.endsWith(`-${process.platform}-${process.arch}.tar.gz`));assert.ok(name,'native archive missing');
    const archive=path.join(dist,name),checksum=(await fs.readFile(archive+'.sha256','utf8')).split(/\s+/)[0],root=path.join(temp,'openmili-ip');
    const first=await install.installArchive({installRoot:root,archive,checksum});
    const launcher=process.platform==='win32'?{command:'powershell.exe',args:['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'launch.ps1')]}:{command:'sh',args:[path.join(root,'openmili-ip')]};
    const smoke=await runProcess(launcher.command,[...launcher.args,'doctor','--offline','--json','--output',path.join(temp,'reports')],{timeout:30000});assert.equal(smoke.code,0,smoke.stderr);assert.equal(JSON.parse(smoke.stdout).doctor.offline,true);
    const core=path.join(root,'versions',first.version);assert.equal(await fs.stat(path.join(core,'node_modules/playwright')).then(()=>true).catch(()=>false),false);
    const workerCode=`require(${JSON.stringify(path.join(core,'browser-worker'))}).loadPlaywright({installBrowser:true,workerDir:${JSON.stringify(path.join(temp,'optional-worker'))}}).then(r=>{if(!r.api.chromium)process.exit(1);console.log('OPTIONAL_WORKER_REAL_INSTALL_OK')}).catch(e=>{console.error(e.message);process.exit(1)})`;
    const worker=await runProcess(path.join(core,process.platform==='win32'?'node.exe':'node'),['-e',workerCode],{timeout:190000,maxOutput:32768});assert.equal(worker.code,0,worker.stderr);assert.match(worker.stdout,/OPTIONAL_WORKER_REAL_INSTALL_OK/);
    await assert.rejects(()=>install.installArchive({installRoot:root,archive,checksum:'0'.repeat(64)}),/SHA-256/);
    const stage=path.join(temp,'fixture');await fs.cp(core,stage,{recursive:true});
    const pkg=JSON.parse(await fs.readFile(path.join(stage,'package.json'),'utf8'));pkg.version='0.0.0-portable-fixture';await fs.writeFile(path.join(stage,'package.json'),JSON.stringify(pkg));
    const manifest=JSON.parse(await fs.readFile(path.join(stage,'runtime-manifest.json'),'utf8'));manifest.tool=pkg.version;await fs.writeFile(path.join(stage,'runtime-manifest.json'),JSON.stringify(manifest));
    const fixture=path.join(temp,'fixture.tar.gz'),packed=await runProcess('tar',['-czf',fixture,'-C',stage,'.'],{timeout:60000});assert.equal(packed.code,0,packed.stderr);
    const hash=crypto.createHash('sha256').update(await fs.readFile(fixture)).digest('hex');
    await install.installArchive({installRoot:root,archive:fixture,checksum:hash});assert.equal((await install.metadata(root)).current,'v'+pkg.version);
    assert.equal((await install.rollback(root)).version,first.version);
    await fs.writeFile(path.join(root,'keep-user-file.txt'),'user data');
    await install.uninstall(root,{yes:true});assert.equal(await fs.readFile(path.join(root,'keep-user-file.txt'),'utf8'),'user data');
    assert.equal(await fs.stat(path.join(root,'versions',first.version)).then(()=>true).catch(()=>false),false);
    console.log(`REAL portable ${process.platform}/${process.arch}: runtime launch, no core browser dependency, optional worker install, SHA rejection, upgrade, rollback, owned uninstall PASS`);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
