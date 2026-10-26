'use strict';
const {normalizeProxy}=require('./core');
const net=require('node:net');
const {inPrefix}=require('./ip-network');
function noProxyMatch(host,list,port) {
  host=host.toLowerCase().replace(/^\[|\]$/g,'');
  return String(list||'').split(',').some(item=>{
    const pattern=item.trim().toLowerCase();if(pattern==='*')return true;if(!pattern)return false;
    if(pattern.includes('/')&&net.isIP(host))return inPrefix(host,pattern);
    let domain=pattern,requiredPort;
    const bracket=pattern.match(/^\[([^\]]+)\](?::(\d+))?$/),withPort=pattern.match(/^([^:]+):(\d+)$/);
    if(bracket){domain=bracket[1];requiredPort=bracket[2];}else if(withPort){domain=withPort[1];requiredPort=withPort[2];}
    if(requiredPort&&String(port)!==requiredPort)return false;
    domain=domain.replace(/^(?:\*\.)?\.?/,'');return host===domain||!net.isIP(host)&&host.endsWith('.'+domain);
  });
}
function applyEnvironmentProxy(options,env=process.env) {
  if(options.proxy||options.ignoreEnvProxy||options.modeExplicit&&options.mode==='direct')return options;
  const https=env.https_proxy||env.HTTPS_PROXY||env.all_proxy||env.ALL_PROXY||'';
  const http=env.http_proxy||env.HTTP_PROXY||env.all_proxy||env.ALL_PROXY||'';
  if(!https&&!http)return options;
  options.envProxies={http:http?normalizeProxy(http):'',https:https?normalizeProxy(https):'',noProxy:env.no_proxy||env.NO_PROXY||''};
  options.proxy=options.envProxies.https||options.envProxies.http;options.mode='proxy';options.proxyOrigin='environment';
  if(options.envProxies.noProxy.trim()==='*'){options.proxy='';options.mode='direct';options.proxyOrigin='environment-no-proxy-all';}
  return options;
}
function proxyForURL(url,options) {
  if(!options.envProxies)return {proxy:options.proxy||'',bypassed:false};
  const u=new URL(url),candidate=u.protocol==='https:'?options.envProxies.https:options.envProxies.http;
  const proxy=noProxyMatch(u.hostname,options.envProxies.noProxy,u.port||(u.protocol==='https:'?'443':'80'))?'':candidate;
  return {proxy,bypassed:proxy!==(options.proxy||'')};
}
module.exports={noProxyMatch,applyEnvironmentProxy,proxyForURL};
