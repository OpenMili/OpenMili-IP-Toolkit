'use strict';
const fs=require('node:fs');
const path=require('node:path');
function npmCommand(args) {
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'runtime-npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...String(process.env.PATH||'').split(path.delimiter).map(p=>path.join(p,'node_modules/npm/bin/npm-cli.js'))];
  const cli=candidates.find(p=>p&&/npm-cli\.js$/.test(p)&&fs.existsSync(p));
  if(cli)return {command:process.execPath,args:[cli,...args]};
  if(process.platform==='win32')throw new Error('未找到 npm CLI；可安装 Node.js LTS 后重试浏览器增强');
  return {command:'npm',args};
}
module.exports={npmCommand};
