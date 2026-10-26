'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, parseTargets, normalizeProxy, redactProxy, isPublicIP, scoreReport, sameIP } = require('../lib/core');
const { parseArgs } = require('../bin/openmili');
const { parseTrace, prefixHint } = require('../lib/routes');
const { finalHeaders } = require('../lib/transport');
const { inferAttribute, parseIPAPI, summarizeRouting } = require('../lib/identity');
const { browserProxy } = require('../lib/browser');
const { renderHTML } = require('../lib/report');

test('正常页面引用 CAPTCHA 组件、脚本和普通说明不应误判', () => {
  for (const body of ['<title>Home</title><script src="recaptcha/api.js"></script><main>Welcome</main>', '<title>Documentation</title><p>Integrate reCAPTCHA or Turnstile into your application.</p>']) {
    assert.equal(classify({ status: 200, body }).kind, 'reachable');
  }
});

test('200 盾页、403 人机验证、451 地区、429、登录和空响应分别识别', () => {
  const cases = [
    [{status:200,body:'<title>Just a moment...</title>Waiting'},'challenge'],
    [{status:200,headers:{'cf-mitigated':'challenge'},body:'wait'},'challenge'],
    [{status:403,body:'<h1>Verify you are human</h1>'},'captcha'],
    [{status:451,body:'Blocked'},'region'],
    [{status:403,body:'This service is not available in your country'},'region'],
    [{status:200,body:'<title>App unavailable in region | Claude by Anthropic</title>Only available in certain regions',finalUrl:'https://claude.com/app-unavailable-in-region'},'region'],
    [{status:429,body:'retry'},'rate-limit'],
    [{status:200,body:'<title>Sign in | Example</title>Sign in'},'login'],
    [{status:200,body:'content',finalUrl:'https://example.com/login?next=/'},'login'],
    [{status:204,body:''},'empty'],
    [{status:200,body:'<noscript>Enable JavaScript</noscript>'},'js-required'],
    [{status:302,body:'moved'},'redirect'],
    [{status:200,body:'<h1>App</h1>',error:'TLS failure'},'network']
  ];
  for (const [input,kind] of cases) assert.equal(classify(input).kind,kind);
});

test('最终响应头独立于代理 CONNECT 和重定向前的盾头', () => {
  const headers = finalHeaders('HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 302\r\ncf-mitigated: challenge\r\nlocation: /ok\r\n\r\nHTTP/2 200\r\ncontent-type: text/html\r\n\r\n');
  assert.equal(headers['cf-mitigated'], undefined);
  assert.equal(classify({status:200,headers,body:'ok'}).kind,'reachable');
});

test('YAML 去重、顺序、转义、权重和异常清单校验', () => {
  const targets = parseTargets('domains:\n  - url: "https://example.com/a?x=1&b=2#frag"\n    name: "Quoted \\"name\\""\n    weight: 3\n  - name: duplicate\n    url: "https://example.com/a?x=1&b=2#frag"\n');
  assert.equal(targets.length,1); assert.equal(targets[0].weight,3);
  for (const input of ['domains: []','domains:\n - name: missing','domains:\n - name: bad\n   url: file:///tmp/a','domains:\n - name: bad\n   name: twice\n   url: https://example.com','domains:\n - name: bad\n   url: https://u:p@example.com','domains:\n - name: bad\n   url: https://example.com\n   weight: 100']) {
    assert.throws(() => parseTargets(input));
  }
});

test('代理格式、端口和凭据脱敏；浏览器拒绝不支持的 SOCKS 认证', () => {
  assert.equal(normalizeProxy('7890'),'http://127.0.0.1:7890');
  assert.equal(normalizeProxy('socks5h://127.0.0.1:10808'),'socks5h://127.0.0.1:10808');
  assert.equal(redactProxy('http://user:password@127.0.0.1:7890'),'http://***:***@127.0.0.1:7890');
  assert.throws(() => normalizeProxy('file:///a')); assert.throws(() => normalizeProxy('http://127.0.0.1:99999'));
  assert.throws(() => browserProxy('socks5://u:p@127.0.0.1:1080'));
  assert.equal(browserProxy('socks5h://127.0.0.1:1080').server,'socks5://127.0.0.1:1080');
});

test('CLI 数值/组合校验阻止错用目标 IP 及无效参数', () => {
  for (const args of [['--mode','invalid'],['--limit','NaN'],['--port','0'],['--port','65536'],['--timeout','-1'],['--family','5'],['--mode','direct','--proxy','7890'],['--proxy'],['--only-lookup','--targets-url','https://example.com'],['--lookup-ip','127.0.0.1'],['--min-delay','3','--max-delay','1']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs(['--proxy','7890']).mode,'proxy');
  assert.equal(parseArgs(['--min-delay','30ms','--max-delay','0.1']).maxDelay,100);
});

test('公网 IP 必须拒绝私网、文档网段和非法地址', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','100.64.0.1','192.168.1.1','198.51.100.1','203.0.113.1','0.0.0.0','255.255.255.255','999.1.1.1','::1','fc00::1','fe80::1','2001:db8::1','::ffff:127.0.0.1']) assert.equal(isPublicIP(ip),false,ip);
  for (const ip of ['8.8.8.8','1.1.1.1','203.0.114.1','198.51.101.1','2606:4700:4700::1111']) assert.equal(isPublicIP(ip),true,ip);
  assert.equal(sameIP('2606:4700:4700:0:0:0:0:1111','2606:4700:4700::1111'),true);
  assert.equal(sameIP('',''),false);
});

test('回程仅解析跳点；头部目标不能证明到达；前缀匹配不越界', () => {
  const failed = parseTrace('traceroute to 8.8.8.8 (8.8.8.8), 20 hops max\n 1 * * *\n 2 192.168.1.1 1 ms\n', '8.8.8.8');
  assert.equal(failed.reached,false); assert.equal(failed.hops.length,2);assert.equal(failed.hops[0].anonymous,true);
  const ok = parseTrace('Tracing route to 8.8.8.8\n 1 <1 ms <1 ms <1 ms 192.168.1.1\n 2 10 ms 11 ms 10 ms 8.8.8.8\n', '8.8.8.8');
  assert.equal(ok.reached,true);
  assert.equal(prefixHint('59.43.1.1'),4809); assert.equal(prefixHint('59.430.1.1'),null);
  assert.equal(prefixHint('223.120.190.1'),58453); assert.equal(prefixHint('223.120.19.1'),58807);
});

test('ASN 双重判断保留冲突，运营商不会直接变成住宅', () => {
  assert.equal(inferAttribute([{status:'ok',source:'a',asn:4134,owner:'China Telecom'}]).type,'isp');
  assert.equal(inferAttribute([{status:'ok',source:'a',asn:14061,owner:'DigitalOcean'}]).type,'hosting');
  const conflict = inferAttribute([{status:'ok',source:'a',asn:14061,owner:'DigitalOcean'}, {status:'ok',source:'b',asn:4134,owner:'China Telecom'}]);
  assert.equal(conflict.conflict,true); assert.equal(conflict.type,'unknown');
});

test('公开库精简 schema 不凭空生成风险字段；ASN 对象也可解析', () => {
  const short = parseIPAPI({ip:'8.8.8.8',asn:'AS15169 Google LLC',company:'Google LLC'},'8.8.8.8');
  assert.equal(short.asn,15169); assert.deepEqual(short.flags,{});
  const full = parseIPAPI({ip:'1.1.1.1',asn:{asn:13335,org:'Cloudflare',type:'hosting'},company:{type:'hosting'},is_proxy:false},'1.1.1.1');
  assert.equal(full.companyType,'hosting'); assert.equal(full.flags.is_proxy,false);
  assert.throws(() => parseIPAPI({ip:'1.1.1.1'},'8.8.8.8'));
});

test('历史只计算精确当前前缀，排除上级路由的起源污染', () => {
  const summary = summarizeRouting({by_origin:[{origin:'15169',prefixes:[{prefix:'8.8.8.0/24',timelines:[{starttime:'2026-01-01',endtime:'2026-02-01'}]}]}, {origin:'3356',prefixes:[{prefix:'8.0.0.0/8',timelines:[{starttime:'2001-01-01',endtime:'2026-02-01'}]}]}]},'8.8.8.0/24');
  assert.equal(summary.originCount,1); assert.equal(summary.origins[0].asn,15169);
  const clipped = summarizeRouting({by_origin:[{origin:'1',prefixes:[{prefix:'8.8.8.0/24',timelines:[{starttime:'2020-01-01',endtime:'2020-02-01'}]}]}, {origin:'2',prefixes:[{prefix:'8.8.8.0/24',timelines:[{starttime:'2026-01-01',endtime:'2026-10-01'}]}]}]},'8.8.8.0/24','2026-07-01T00:00:00Z','2026-10-01T00:00:00Z');
  assert.equal(clipped.originCount,1); assert.equal(clipped.origins[0].asn,2); assert.equal(clipped.origins[0].firstSeenInWindow,'2026-07-01T00:00:00.000Z');
});

test('评分不将未测试变成满分，也不把浏览器出口混用', () => {
  const sites = Array.from({length:5},() => ({weight:1,http:{kind:'reachable',identityVerified:true},browser:{kind:'untested'}}));
  let score = scoreReport({sites});
  assert.equal(score.earned,30); assert.equal(score.coverage,30); assert.equal(score.grade,'证据不足');
  assert.deepEqual(score.range,[30,100]);
  sites.forEach(s => s.browser = {kind:'reachable',identityMismatch:true});
  assert.equal(scoreReport({sites}).coverage,30);
  sites.forEach(s => s.http.identityVerified = false);
  assert.equal(scoreReport({sites}).coverage,0);
  score = scoreReport({sites:[],database:{reputation:{tested:true,risk:0,coverage:0.25}}});
  assert.equal(score.earned,5); assert.equal(score.coverage,5);
  const stars=scoreReport({routes:{results:[{hops:[{ip:null,anonymous:true}],reached:false}]}});assert.equal(stars.components.find(c=>c.name==='routes').measured,0);
});

test('报告对站点和数据库文本转义，避免远程内容注入 HTML', () => {
  const report = {score:scoreReport({}),database:{records:[{source:'<script>alert(1)</script>',status:'untested',reason:'<img src=x onerror=x>'}]},routes:{results:[]},history:{},sites:[],comparison:{}};
  const html = renderHTML(report);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
});
