'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renderReport,websiteRow,widthOf}=require('../lib/terminal');

function fixture(){return {
  system:'Windows x64',family:4,selectedIP:'8.8.8.8',mode:'proxy',proxy:'http://user:SECRET_PROXY@127.0.0.1:10808',
  exit:{v4:{ip:'8.8.8.8',stable:true},v6:{reason:'IPv6 unavailable'}},
  database:{records:[],attribute:{type:'UNKNOWN',reason:'没有独立类型证据'},reputation:{tested:false}},
  dns:{checks:[{protocol:'doh',type:'A',name:'example.org',status:'success',rcode:'NOERROR',answers:[{type:'A',data:'8.8.8.8',ttl:60}]},
    {protocol:'udp',status:'skipped',reason:'代理不支持 UDP'}]},routes:{reason:'系统路由不能穿过 HTTP/SOCKS 代理'},
  history:{registration:{status:'ok',source:'RIR',events:[{action:'registration',date:'2020-01-01'}]},routing:{reason:'BGP evidence unavailable'}},
  sites:[{name:'中英文 ChatGPT',url:'https://example.org/',httpPlain:{kind:'reachable',status:200,duration:1000},
    http:{kind:'captcha',status:200,duration:1200,evidence:'完成验证码'},browser:{kind:'restricted',status:403,duration:1500,evidence:'访问阻断'}},
    {name:'Unknown 200',url:'https://unknown.example/',http:{kind:'untested',status:200,reason:'未匹配预期页面'},browser:{kind:'network',status:0,error:'TCP failed'}}],
  score:{components:[],reference:72.7,coverage:35.1,grade_code:'insufficient',grade:'证据不足',note:'未知不当失败'}
};}

test('终端与实时行颜色一致：通过绿、验证黄、阻断红、未知灰，200 不自动通过',()=>{
  const old=process.env.NO_COLOR;delete process.env.NO_COLOR;
  try{
    const report=fixture(),options={color:true,width:100};
    const row=websiteRow(report.sites[0],1,options),text=renderReport(report,options);
    for(const output of [row,text]){
      assert.match(output,/\x1b\[32m通过 200/);assert.match(output,/\x1b\[33m验证 200/);assert.match(output,/\x1b\[31m阻断 403/);
    }
    assert.match(text,/\x1b\[90m未测 200/);assert.match(text,/未匹配预期页面/);assert.match(text,/完成验证码/);
    assert.doesNotMatch(text,/SECRET_PROXY|详见模块证据|report\.html|system:|SUCCESS/);
  }finally{if(old===undefined)delete process.env.NO_COLOR;else process.env.NO_COLOR=old;}
});

test('中文、ANSI 与窄屏对齐，所有网站和证据在终端完整保留',()=>{
  const report=fixture();report.sites[0].name='含中文的超长网站名称 ChatGPT'.repeat(3);
  for(const width of [32,48,80,100,132]){
    const text=renderReport(report,{width,color:true});
    for(const line of text.split('\n'))assert.ok(widthOf(line)<=width,`width=${width}, line=${JSON.stringify(line)}, actual=${widthOf(line)}`);
    for(const section of ['公网出口与网络属性','公开库风险','DNS 与 PTR','三网路径','IP 历史','网站实测','综合评分'])assert.ok(text.includes(section),section);
    assert.match(text,/Unknown 200/);assert.match(text,/注册时间/);assert.match(text,/2020-01-01/);assert.match(text,/NOERROR/);
  }
});

test('仅 HTTP 时显示两列与实际原因，不重复显示真实浏览器未测；保留高级三列',()=>{
  const report=fixture();report.browser={status:'untested',reason:'用户跳过'};
  for(const site of report.sites)site.browser={kind:'untested',reason:'用户跳过'};
  for(const width of [32,48,58,73,80,100,132]){
    const text=renderReport(report,{width,plain:true});
    assert.match(text,/普通 HTTP/);assert.match(text,/浏览器标头/);assert.doesNotMatch(text,/真实浏览器|浏览器说明|用户跳过|三种方式/);
    const compact=text.replace(/\s+/g,'');assert.match(compact,/不执行JavaScript/);assert.match(compact,/完成验证码/);
    for(const line of text.split('\n'))assert.ok(widthOf(line)<=width,`width=${width}, line=${JSON.stringify(line)}`);
  }
  const advanced=renderReport(report,{browser:true,plain:true});
  assert.match(advanced,/真实浏览器/);assert.match(advanced,/浏览器说明\s*: 用户跳过/);
});

test('紧凑终端只保留结论、网站状态和评分',()=>{
  const report=fixture();for(const site of report.sites)site.browser={kind:'untested',reason:'用户跳过'};
  const text=renderReport(report,{compact:true,plain:true,width:100});
  assert.match(text,/公网与属性/);assert.match(text,/DNS \/ 三网 \/ 历史/);assert.match(text,/网站检测 · 2 个/);assert.match(text,/参考分 72\.7\/100/);
  assert.doesNotMatch(text,/检测时间|来源查询时间|验证、阻断与未测原因|完成验证码|系统路由不能穿过/);
  assert.doesNotMatch(text,/真实浏览器/);
});

test('纯文本、NO_COLOR 与外部终端控制符处理，不用跳过数冒充 DNS 失败',()=>{
  const report=fixture();report.sites[0].browser.evidence='blocked\x1b[31m INJECTED\x1b[0m';
  const plain=renderReport(report,{plain:true,color:true,width:100});assert.doesNotMatch(plain,/\x1b/);
  assert.match(plain,/实际查询\s*: 1 项；成功 1 项；能力限制跳过 1 项/);assert.match(plain,/代理不支持 UDP/);
  const old=process.env.NO_COLOR;process.env.NO_COLOR='';
  try{assert.doesNotMatch(renderReport(report,{color:true}),/\x1b/);}
  finally{if(old===undefined)delete process.env.NO_COLOR;else process.env.NO_COLOR=old;}
});
