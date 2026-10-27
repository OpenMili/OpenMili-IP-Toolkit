'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {classify,parseTargets}=require('../lib/core');
const {parseArgs}=require('../bin/openmili');
test('P2 网站规则：预期标记、允许域、规则过期与挑战优先',()=>{
  const rules={expected_text:['Expected brand'],rule_version:'fixture-v1',expires_at:'2030-01-01'};
  const base={status:200,body:'Welcome to Expected brand',requestUrl:'https://expected.example/',finalUrl:'https://expected.example/',rules};
  assert.equal(classify(base).kind,'reachable');assert.equal(classify({...base,body:'unrelated maintenance'}).kind,'partial');
  assert.equal(classify({...base,finalUrl:'https://another.example/'}).kind,'untested');
  assert.equal(classify({...base,finalUrl:'https://another.example/',allowedHosts:['another.example']}).kind,'reachable');
  assert.equal(classify({...base,body:'<title>Just a moment</title>wait'}).kind,'challenge');
  assert.equal(classify({...base,rules:{...rules,expires_at:'2000-01-01'}}).kind,'untested');
  assert.equal(classify({...base,finalUrl:'http://expected.example/'}).kind,'redirect');
  assert.equal(classify({...base,error:'ABORTED'}).outcome,'unknown');
  assert.equal(classify({...base,error:'curl 6: DNS',transport_code:'DNS_FAILED'}).code,'DNS_FAILED');
});
test('P2 默认分类清单规则完整，旧清单兼容，无效规则被拒绝',()=>{
  const targets=parseTargets(fs.readFileSync(path.join(__dirname,'../domains.yaml'),'utf8'));
  assert.equal(targets.length,38);assert.ok(targets.every(t=>t.rule_version==='websites-v1'&&t.expires_at&&t.expected_text.length));
  assert.ok(targets.some(t=>t.category==='mail'));assert.equal(new Set(targets.map(t=>t.url)).size,38);
  assert.throws(()=>parseTargets('domains:\n - name: bad\n   url: https://example.org\n   expected_text: .*\n'));
  assert.throws(()=>parseTargets('expires_at: yesterday\ndomains:\n - name: bad\n   url: https://example.org\n'));
  assert.equal(parseArgs(['websites','--mode','http']).browser,false);assert.equal(parseArgs(['route','--ipv6','--route-protocols','auto','--isp','telecom']).family,6);
});
