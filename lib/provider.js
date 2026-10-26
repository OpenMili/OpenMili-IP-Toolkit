'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {request}=require('./transport');
const {sanitize,environmentSecrets}=require('./privacy');
const config=require('../data/providers.json');
const cooldown=new Map();
class ProviderError extends Error {
  constructor(message,{retryable=false,retryAfter=0,code='PROVIDER_FAILED'}={}){super(message);Object.assign(this,{retryable,retryAfter,code});}
}
async function fetchJSON(url,options={}) {
  const r=await (options.request||request)(url,{...options,maxBytes:options.maxBytes||1024*1024});
  if(r.status===429)throw new ProviderError('API 限流',{retryable:true,retryAfter:Math.max(0,Math.min(300,Number(r.headers?.['retry-after'])||5)),code:'RATE_LIMITED'});
  if(r.error || r.status>=500)throw new ProviderError(r.error||`HTTP ${r.status}`,{retryable:!options.signal?.aborted,code:'PROVIDER_UNAVAILABLE'});
  if(r.status<200 || r.status>=300)throw new ProviderError(`HTTP ${r.status}`,{code:'PROVIDER_HTTP_ERROR'});
  try{return JSON.parse(r.body);}catch{throw new ProviderError('API 返回非 JSON',{code:'PROVIDER_SCHEMA_CHANGED'});}
}
async function provider(id,key,fetchNormalize,options={}) {
  const definition=config.sources[id];if(!definition)throw new Error(`Unknown provider: ${id}`);
  const secrets=[...environmentSecrets(),options.abuseKey,options.ipapiKey,options.ipinfoKey];
  const cacheRoot=options.cacheDir||path.join(os.homedir(),'.openmili-ip','cache');
  const credentialScope=crypto.createHash('sha256').update([options.abuseKey,options.ipapiKey,options.ipinfoKey].join(':')).digest('hex');
  const hash=crypto.createHash('sha256').update(`${config.version}:${id}:${key}:${options.proxy||''}:${options.family||'auto'}:${credentialScope}`).digest('hex');
  const file=path.join(cacheRoot,hash+'.json');
  const now=Date.now();let cached;
  try{const c=JSON.parse(await fs.readFile(file,'utf8'));if(c.id===id && c.key===key && c.version===config.version && c.data?.status==='ok' && Number.isFinite(c.fetched_at))cached=c;}catch{}
  const envelope=(data,fetchedAt,extra={})=>({...data,provider:id,checked_at:new Date(fetchedAt).toISOString(),source_updated_at:data.source_updated_at||null,independence_group:definition.independence_group,terms:definition.terms,provider_version:config.version,...extra});
  if(cached && !options.refresh && (options.offline || now-cached.fetched_at<definition.ttl_seconds*1000))return envelope(cached.data,cached.fetched_at,{cached:true,stale:now-cached.fetched_at>=definition.ttl_seconds*1000});
  const unknown=(code,reason)=>envelope({status:'untested',code,reason},now);
  if(options.offline)return unknown('OFFLINE','离线且没有缓存');
  if(options.signal?.aborted)return unknown('ABORTED','用户中止');
  if((cooldown.get(id)||0)>now)return unknown('RATE_LIMITED','该来源正在限流退避期');
  for(let attempt=0;attempt<=(options.retries??1);attempt++) {
    try {
      const data=await fetchNormalize();
      if(!data || data.status!=='ok')throw new ProviderError('适配器未返回有效标准对象',{code:'PROVIDER_SCHEMA_CHANGED'});
      const safe=sanitize(data,{secrets});
      try {
        await fs.mkdir(cacheRoot,{recursive:true,mode:0o700});
        const temp=file+`.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        await fs.writeFile(temp,JSON.stringify({id,key,version:config.version,fetched_at:Date.now(),data:safe}),{mode:0o600});
        await fs.rename(temp,file);
      } catch { /* An unwritable cache never prevents a live result. */ }
      return envelope(safe,Date.now(),{cached:false,stale:false});
    } catch(error) {
      if(error.code==='RATE_LIMITED')cooldown.set(id,Date.now()+(error.retryAfter||5)*1000);
      if(attempt===(options.retries??1) || !error.retryable || options.signal?.aborted || error.retryAfter>10)return unknown(error.code||'PROVIDER_FAILED',sanitize(error.message,{secrets}));
      try{await delay(Math.max(error.retryAfter*1000||0,Math.min(10000,250*2**attempt)),undefined,{signal:options.signal});}catch{return unknown('ABORTED','用户中止');}
    }
  }
}
module.exports={provider,fetchJSON,ProviderError};
