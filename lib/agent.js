'use strict';
const path=require('node:path');
const {runProcess}=require('./transport');
const {validateReport}=require('./schema');
const TASKS=['all','ip','dns','identity','reputation','route','websites','doctor'];
const quote=value=>`'${String(value).replace(/'/g,"'\\''")}'`;
function agentCommand(options) {
  if(!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[a-fA-F0-9:]+\])$/.test(options.ssh||''))throw new Error('--ssh 必须为 [user@]host，拒绝 SSH 选项或 shell 片段');
  if(!/^\/[a-zA-Z0-9_./ -]+$/.test(options.remotePath||'')||options.remotePath.split('/').includes('..'))throw new Error('--remote-path 必须是已授权远端安装的绝对 POSIX 路径');
  const task=options.task||'all';if(!TASKS.includes(task))throw new Error('Agent task 不受支持');
  const port=Number(options.sshPort||22);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('SSH 端口无效');
  const tokens=[options.remotePath,task,'--json','--no-pause',...(options.offline?['--offline']:[]),...(options.redact?['--redact']:[]),...(options.browser?['--browser']:[]),...(options.familyExplicit?[options.family===6?'--ipv6':'--ipv4']:[])];
  const args=['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-p',String(port)];
  if(options.sshKey)args.push('-i',path.resolve(options.sshKey));
  if(options.knownHosts)args.push('-o',`UserKnownHostsFile=${path.resolve(options.knownHosts)}`);
  args.push(options.ssh,tokens.map(quote).join(' '));
  return {command:'ssh',args,task};
}
async function runAgent(options={}) {
  const command=agentCommand(options);
  const r=await (options.runProcess||runProcess)(command.command,command.args,{timeout:options.agentTimeout||900000,maxOutput:16*1024*1024,signal:options.signal});
  if(r.error||r.code!==0)throw new Error(`Agent SSH 执行未完成（${r.code??'unknown'}）：${r.error||r.stderr.slice(0,500)}；未回退本机测量`);
  let report;try{report=JSON.parse(r.stdout);}catch{throw new Error('Agent stdout 不是单份 JSON，无法核实远端结果');}
  if(!validateReport(report))throw new Error('Agent 报告未通过 Schema，未导入');
  return {...report,mode:'agent',command:command.task,agent:{transport:'SSH',host:options.ssh,host_verification:'StrictHostKeyChecking=yes',remote_path:options.remotePath,task:command.task,received_at:new Date().toISOString(),
    note:'由用户指定且预先安装的 SSH 主机执行；不自动部署、不关闭主机密钥验证，所有测量来自该主机'},remote_mode:report.mode};
}
module.exports={TASKS,agentCommand,runAgent};
