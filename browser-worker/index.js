'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createRequire}=require('node:module');
const manifest=require('./package.json');
async function loadPlaywright(options={},log=()=>{}) {
  try{return {api:require('playwright'),resolve:require.resolve('playwright')};}catch{}
  const root=path.join(options.workerDir||path.join(os.homedir(),'.openmili-ip','browser-worker'),manifest.dependencies.playwright);
  const req=createRequire(path.join(root,'package.json'));
  const load=()=>({api:req('playwright'),resolve:req.resolve('playwright')});
  try{return load();}catch{}
  if(options.noInstall||!options.installBrowser||options.offline||options.signal?.aborted)throw new Error('可选浏览器 worker 未安装；本次未下载，HTTP 仍可运行');
  log('正在安装可选浏览器 worker（独立用户缓存，不修改核心依赖）…');
  await fs.mkdir(root,{recursive:true,mode:0o700});
  await fs.copyFile(path.join(__dirname,'package.json'),path.join(root,'package.json'));
  await fs.copyFile(path.join(__dirname,'package-lock.json'),path.join(root,'package-lock.json'));
  const command=require('../lib/npm-runtime').npmCommand(['ci','--prefix',root,'--omit=dev','--ignore-scripts','--no-audit','--no-fund']);
  const r=await require('../lib/transport').runProcess(command.command,command.args,{timeout:180000,signal:options.signal,maxOutput:128*1024});
  if(r.code!==0||r.error)throw new Error('浏览器 worker 安装失败；保留核心 HTTP 能力');
  return load();
}
module.exports={loadPlaywright};
