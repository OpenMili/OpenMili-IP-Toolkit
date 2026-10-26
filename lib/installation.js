'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {runProcess}=require('./transport');
const APP='OpenMili-IP-Toolkit';
const VERSION=/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const MARKER='.openmili-install.json';
async function metadata(root) {
  root=path.resolve(root);
  if(root===path.parse(root).root||root===os.homedir()||root===process.cwd())throw new Error('拒绝将根目录/用户目录/当前仓库作为安装根目录');
  const stat=await fs.lstat(root).catch(()=>null);if(stat?.isSymbolicLink())throw new Error('安装根目录不能是符号链接');
  if((await fs.lstat(path.join(root,'versions')).catch(()=>null))?.isSymbolicLink())throw new Error('版本目录不能是符号链接');
  let data;try{data=JSON.parse(await fs.readFile(path.join(root,MARKER),'utf8'));}catch{}
  if(stat&&!data&&(await fs.readdir(root)).length)throw new Error('非空且不是本工具管理的目录，拒绝修改');
  if(data&&(data.app!==APP||data.format!==1||!Array.isArray(data.versions)||data.versions.some(v=>!VERSION.test(v))))throw new Error('安装元数据无效');
  if(data){const current=(await fs.readFile(path.join(root,'current.txt'),'utf8').catch(()=>data.current||'')).trim();if(!VERSION.test(current)||!data.versions.includes(current))throw new Error('安装版本指针无效');data.current=current;}
  return data||null;
}
async function checkArchive(archive,sha) {
  if(!/^[a-f0-9]{64}$/i.test(sha||''))throw new Error('必须提供 SHA-256 校验和');
  const file=await fs.readFile(archive);if(file.length>150*1024*1024)throw new Error('安装包超过150MiB');
  if(crypto.createHash('sha256').update(file).digest('hex')!==sha.toLowerCase())throw new Error('SHA-256 不匹配，未执行安装');
  const listing=await runProcess('tar',['-tzf',archive],{maxOutput:4*1024*1024});
  if(listing.code!==0||listing.error)throw new Error('无法读取安装包');
  const names=listing.stdout.trim().split(/\r?\n/);
  if(names.some(n=>!n||/^[\\/]|:|\\|[\x00-\x1f]/.test(n)||n.split('/').includes('..')))throw new Error('安装包含越界路径');
  const types=await runProcess('tar',['-tvzf',archive],{maxOutput:4*1024*1024});
  if(types.code!==0||types.stdout.trim().split(/\r?\n/).some(line=>!/^[-d]/.test(line)))throw new Error('安装包含符号链接或特殊文件');
}
function launchers() {
  return {'openmili-ip':'#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nVERSION=$(cat "$ROOT/current.txt")\ncase "$VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) exit 2;; esac\ncase "$VERSION" in *[!a-zA-Z0-9.-]*|*..*) exit 2;; esac\nexec "$ROOT/versions/$VERSION/node" "$ROOT/versions/$VERSION/bin/openmili.js" "$@"\n',
    'openmili-ip.cmd':'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*\r\n',
    'launch.ps1':"$ErrorActionPreference='Stop'\n$v=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current.txt') -Raw).Trim()\nif($v -notmatch '^v\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?$'){throw 'Invalid version pointer'}\n& (Join-Path $PSScriptRoot \"versions/$v/node.exe\") (Join-Path $PSScriptRoot \"versions/$v/bin/openmili.js\") @args\nexit $LASTEXITCODE\n"};
}
async function activate(root,data,version) {
  const metadataFile=path.join(root,MARKER);await fs.writeFile(metadataFile+'.tmp',JSON.stringify({...data,current:version},null,2),{mode:0o600});await fs.rename(metadataFile+'.tmp',metadataFile);
  const pointer=path.join(root,'current.txt');await fs.writeFile(pointer+'.tmp',version+'\n',{mode:0o600});await fs.rename(pointer+'.tmp',pointer);
}
async function installArchive({installRoot,archive,checksum,signal}) {
  const root=path.resolve(installRoot),old=await metadata(root);
  await checkArchive(path.resolve(archive),checksum);
  await fs.mkdir(path.join(root,'versions'),{recursive:true,mode:0o700});
  const stage=await fs.mkdtemp(path.join(root,'versions','.staging-'));
  try{
    const extracted=await runProcess('tar',['-xzf',path.resolve(archive),'-C',stage],{timeout:60000,signal});
    if(extracted.code!==0||extracted.error)throw new Error('解包失败，上一版本未改变');
    const pkg=JSON.parse(await fs.readFile(path.join(stage,'package.json'),'utf8')),version='v'+pkg.version;
    if(pkg.name!=='openmili-ip-toolkit'||!VERSION.test(version))throw new Error('安装包身份不匹配');
    const executable=path.join(stage,process.platform==='win32'?'node.exe':'node');
    const runtime=JSON.parse(await fs.readFile(path.join(stage,'runtime-manifest.json'),'utf8'));
    if(runtime.tool!==pkg.version||runtime.platform!==process.platform||runtime.arch!==process.arch||runtime.runtime_sha256!==crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex'))throw new Error('运行时身份/架构/哈希不符，未执行');
    if(process.platform!=='win32')await fs.chmod(executable,0o755);
    const check=await runProcess(executable,[path.join(stage,'bin/openmili.js'),'doctor','--offline','--json','--output',path.join(stage,'.smoke')],{timeout:30000,signal});
    if(check.code!==0||check.error)throw new Error('新版本离线自检失败，保留上一可用版本');
    await fs.rm(path.join(stage,'.smoke'),{recursive:true,force:true});await fs.rm(path.join(stage,'latest.json'),{force:true});
    const destination=path.join(root,'versions',version);
    if(await fs.stat(destination).catch(()=>null))throw new Error('此版本已安装，可使用 rollback 激活上一版本');
    await renameWithRetry(stage,destination);
    const data={app:APP,format:1,versions:[...new Set([...(old?.versions||[]),version])],previous:old?.current||null};
    for(const [name,content] of Object.entries(launchers()))await fs.writeFile(path.join(root,name),content,{mode:0o755});
    await activate(root,data,version);return {status:'success',version,previous:old?.current||null,root};
  }finally{await fs.rm(stage,{recursive:true,force:true});if(!old){await fs.rmdir(path.join(root,'versions')).catch(()=>{});await fs.rmdir(root).catch(()=>{});}}
}
async function renameWithRetry(source,destination,{attempts=12,delay=250}={}) {
  for(let attempt=0;;attempt++) {
    try { return await fs.rename(source,destination); }
    catch(error) {
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=attempts-1)throw error;
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
}
function managedRoot(){return path.basename(path.resolve(__dirname,'../..'))==='versions'?path.resolve(__dirname,'../../..'):null;}
async function rollback(root=managedRoot()) {
  if(!root)throw new Error('源码运行不支持安装回滚');
  const data=await metadata(root);if(!data?.previous||!data.versions.includes(data.previous))throw new Error('没有受管理的上一版本');
  const previous=data.previous;await activate(root,{...data,previous:data.current},previous);return {status:'success',version:previous};
}
async function uninstall(root=managedRoot(),{yes=false,purgeCache=false}={}) {
  if(root)root=path.resolve(root);
  const data=root?await metadata(root):null;
  if(!data)return {status:'skipped',reason:'源码目录不是受管理安装；源代码、系统依赖、配置和报告均未删除'};
  if(!yes)throw new Error('卸载需 --yes；默认保留报告、配置和密钥，可加 --purge-cache 删除专属缓存');
  if(purgeCache)await fs.rm(path.join(os.homedir(),'.openmili-ip','cache'),{recursive:true,force:true});
  const targets=data.versions.map(v=>path.join(root,'versions',v));
  for(const p of targets){const real=await fs.realpath(p).catch(()=>p);if(!real.startsWith((await fs.realpath(root))+path.sep))throw new Error('卸载目标越界');}
  if(process.platform==='win32'&&targets.some(p=>process.execPath.startsWith(p+path.sep))){
    const script=path.join(os.tmpdir(),`openmili-uninstall-${crypto.randomUUID()}.ps1`),q=s=>"'"+s.replace(/'/g,"''")+"'";
    const ready=script+'.ready',errorFile=path.join(root,'.openmili-uninstall-error.txt');
    const paths=[...targets,...Object.keys(launchers()).map(n=>path.join(root,n)),path.join(root,'current.txt'),path.join(root,MARKER),errorFile];
    if(paths.some(p=>!p.startsWith(root+path.sep)))throw new Error('卸载目标越界');
    const cleanEmpty=[path.join(root,'versions'),root].map(p=>`if((Test-Path -LiteralPath ${q(p)}) -and @(Get-ChildItem -LiteralPath ${q(p)} -Force).Count -eq 0){Remove-Item -LiteralPath ${q(p)} -Force}`).join('\n');
    await fs.writeFile(script,'\uFEFF'+`$ErrorActionPreference='Stop'\ntry {\n[IO.File]::WriteAllText(${q(ready)},'ready')\nWait-Process -Id ${process.pid} -Timeout 60 -ErrorAction SilentlyContinue\nif(Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue){throw 'Parent process did not exit; no files removed'}\n${paths.map(p=>`if(Test-Path -LiteralPath ${q(p)}){Remove-Item -LiteralPath ${q(p)} -Recurse -Force}`).join('\n')}\n${cleanEmpty}\n} catch {[IO.File]::WriteAllText(${q(errorFile)},$_.Exception.Message); exit 1}\nfinally {Remove-Item -LiteralPath ${q(ready)},$PSCommandPath -Force -ErrorAction SilentlyContinue}\n`);
    // Windows PowerShell exits without running scripts under Node's DETACHED_PROCESS.
    // Start-Process creates an independent hidden process; a ready file confirms startup.
    const encoded=Buffer.from(`& ${q(script)}`,'utf16le').toString('base64');
    const started=await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}')`],{timeout:10000});
    if(started.code!==0||started.error)throw new Error('无法启动卸载清理进程；安装保留');
    const deadline=Date.now()+10000;
    while(!await fs.stat(ready).catch(()=>null)){
      if(Date.now()>=deadline)throw new Error('卸载清理进程未确认启动；安装保留');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    return {status:'success',deferred:true,reason:'清理进程已启动，退出后删除自有版本与启动器；配置/报告保留',error_file:errorFile};
  }
  for(const p of targets)await fs.rm(p,{recursive:true,force:true});
  for(const name of [...Object.keys(launchers()),'current.txt',MARKER])await fs.rm(path.join(root,name),{force:true});
  await fs.rmdir(path.join(root,'versions')).catch(()=>{});await fs.rmdir(root).catch(()=>{});
  return {status:'success',reason:'已清理自有安装；配置/报告/系统软件保留'};
}
async function update(options={}) {
  const root=options.installRoot||managedRoot(),data=root?await metadata(root):null;if(!data)throw new Error('源码/npx运行请重新获取main；update只升级受管理安装');
  if(options.offline||options.signal?.aborted)throw new Error('离线/中止状态不能在线升级');
  const {jsonRequest,request}=require('./transport');
  const release=await jsonRequest('https://api.github.com/repos/OpenMili/OpenMili-IP-Toolkit/releases/latest',options);
  if(!VERSION.test(release.tag_name)||release.draft||release.prerelease)throw new Error('没有有效稳定版本');
  if(release.tag_name===data.current)return {status:'success',reason:'当前已是最新发布版本',version:data.current};
  const name=`OpenMili-IP-Toolkit-${release.tag_name}-${process.platform}-${process.arch}.tar.gz`,asset=release.assets.find(a=>a.name===name);
  if(!asset)throw new Error('该系统/架构尚无发布包；保留旧版本');
  const base=`https://github.com/OpenMili/OpenMili-IP-Toolkit/releases/download/${release.tag_name}/`;
  const sums=await request(base+'SHA256SUMS',options);if(sums.error||sums.status!==200)throw new Error('无法取得校验清单');
  const line=sums.body.split(/\r?\n/).find(l=>l.trim().endsWith('  '+name)),checksum=line?.split(/\s+/)[0];
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-update-'));
  try{
    const archive=path.join(temp,name),proxy=require('./proxy-config').proxyForURL(base+name,options).proxy;
    const downloaded=await runProcess(process.platform==='win32'?'curl.exe':'curl',['-q','--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--max-time','180',...(proxy?['--proxy',proxy]:['--proxy','']),'--output',archive,base+name],{timeout:185000,signal:options.signal,maxOutput:32768});
    if(downloaded.code!==0||downloaded.error)throw new Error('安装包下载失败；旧版本保留');
    return installArchive({installRoot:root,archive,checksum,signal:options.signal});
  }finally{await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={APP,VERSION,MARKER,metadata,checkArchive,launchers,installArchive,managedRoot,rollback,uninstall,update};
