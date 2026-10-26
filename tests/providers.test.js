'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {provider,fetchJSON}=require('../lib/provider');
const {normalizeRIPE,normalizeCymru,normalizeRDAP,rdapEndpoint}=require('../lib/providers');
const {fuseEvidence}=require('../lib/classification');
const {applyEnvironmentProxy,proxyForURL,noProxyMatch}=require('../lib/proxy-config');
test('P1 provider 真实 HTTP 退避重试、TTL、离线、强制刷新与 429 冷却',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-cache-'));let hits=0;
  const server=http.createServer((req,res)=>{hits++;if(req.url==='/limit'){res.writeHead(429,{'Retry-After':'30'});res.end('{}');}else if(hits===1){res.writeHead(503);res.end('{}');}else res.end('{"value":42}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const opts={cacheDir:temp,retries:1},fetcher=async()=>({status:'ok',...(await fetchJSON(base,opts))});
  try{
    const live=await provider('ripe','fixture-ip',fetcher,opts);assert.equal(live.status,'ok');assert.equal(hits,2);assert.equal(live.cached,false);
    const cached=await provider('ripe','fixture-ip',fetcher,opts);assert.equal(cached.cached,true);assert.equal(hits,2);
    await provider('ripe','fixture-ip',fetcher,{...opts,refresh:true});assert.equal(hits,3);
    const [filename]=await fs.readdir(temp),file=path.join(temp,filename),data=JSON.parse(await fs.readFile(file,'utf8'));data.fetched_at=Date.now()-10*86400000;await fs.writeFile(file,JSON.stringify(data));
    const stale=await provider('ripe','fixture-ip',()=>{throw Error('must not call network');},{...opts,offline:true});assert.equal(stale.stale,true);assert.equal(hits,3);
    const absent=await provider('rdap','missing',fetcher,{...opts,offline:true});assert.equal(absent.code,'OFFLINE');assert.equal(hits,3);
    const limited=await provider('cymru','limited',async()=>({status:'ok',...(await fetchJSON(base+'/limit',opts))}),opts);assert.equal(limited.code,'RATE_LIMITED');assert.equal(hits,4);
    const cooling=await provider('cymru','next',fetcher,opts);assert.equal(cooling.code,'RATE_LIMITED');assert.equal(hits,4);
    const secret=await provider('ipinfo','schema-change',async()=>{throw Error('DUMMY_PRIVATE_KEY');},{...opts,ipinfoKey:'DUMMY_PRIVATE_KEY'});assert.doesNotMatch(secret.reason,/DUMMY/);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true});}
});
test('P1 ASN MOAS 与官方 RDAP 必须匹配查询地址',()=>{
  const ripe=normalizeRIPE({status:'ok',data:{asns:[15169,3356],prefix:'8.8.8.0/24'}},'8.8.8.8');assert.equal(ripe.multiOrigin,true);assert.deepEqual(ripe.asns,[15169,3356]);
  assert.throws(()=>normalizeRIPE({status:'ok',data:{asns:[1],prefix:'1.1.1.0/24'}},'8.8.8.8'));
  const cymru=normalizeCymru(['15169 3356 | 8.8.8.0/24 | US | arin | 2023-12-28'],'8.8.8.8');assert.equal(cymru.asns.length,2);assert.equal(cymru.registered_country,'US');
  const bootstrap={services:[[['8.0.0.0/8'],['http://insecure.example/','https://rdap.example/']], [['8.8.8.0/24'],['https://specific.example/rdap/']]]};
  assert.equal(rdapEndpoint(bootstrap,'8.8.8.8'),'https://specific.example/rdap/ip/8.8.8.8');
  assert.throws(()=>rdapEndpoint(bootstrap,'1.1.1.1'));
  assert.throws(()=>normalizeRDAP({objectClassName:'ip network',startAddress:'1.1.1.0',endAddress:'1.1.1.255'},'8.8.8.8','https://rdap.example/'));
});
test('P1 分类融合：弱 ASN 不定型、同源不双算、冲突/过期与独立风险',()=>{
  const checked_at=new Date().toISOString(),base={status:'ok',network_type:'residential',granularity:'prefix',checked_at,source_updated_at:checked_at,reliability:.9};
  assert.equal(fuseEvidence([{status:'ok',asn:14061,owner:'DigitalOcean'}]).type,'UNKNOWN');
  assert.equal(fuseEvidence([{...base,source:'a',independence_group:'same'},{...base,source:'b',independence_group:'same'}]).type,'UNKNOWN');
  const good=fuseEvidence([{...base,source:'a',independence_group:'a'},{...base,source:'b',independence_group:'b'}]);assert.equal(good.type,'RESIDENTIAL');assert.equal(good.confidence,90);
  const conflict=fuseEvidence([{...base,source:'a',independence_group:'a'},{...base,source:'b',independence_group:'b',network_type:'hosting'}]);assert.equal(conflict.type,'SUSPECTED_RESIDENTIAL');assert.equal(conflict.conflict,true);assert.equal(conflict.opposing.length,1);
  assert.equal(fuseEvidence([{...base,stale:true},{...base,stale:true}]).type,'UNKNOWN');
});
test('P1 环境代理按协议与 NO_PROXY 适配，显式代理不被覆盖',()=>{
  const env={HTTPS_PROXY:'http://proxy.example:8080',HTTP_PROXY:'http://proxy2.example:8080',NO_PROXY:'.internal.example,localhost'};
  const o=applyEnvironmentProxy({mode:'auto'},env);assert.equal(o.proxyOrigin,'environment');
  assert.equal(proxyForURL('https://a.internal.example/',o).proxy,'');assert.equal(proxyForURL('https://example.org/',o).proxy,env.HTTPS_PROXY);assert.equal(proxyForURL('http://example.org/',o).proxy,env.HTTP_PROXY);
  assert.equal(applyEnvironmentProxy({mode:'direct',modeExplicit:true},env).proxy,undefined);
  assert.equal(applyEnvironmentProxy({proxy:'http://127.0.0.1:7890'},env).proxy,'http://127.0.0.1:7890');
  assert.equal(applyEnvironmentProxy({mode:'auto'},{...env,NO_PROXY:'*'}).mode,'direct');
  assert.equal(noProxyMatch('::1','[::1]:443','443'),true);assert.equal(noProxyMatch('::1','[::1]:443','80'),false);
  assert.equal(noProxyMatch('10.2.3.4','10.0.0.0/8'),true);assert.equal(noProxyMatch('evilinternal.example','internal.example'),false);
});
