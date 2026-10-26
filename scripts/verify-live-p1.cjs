'use strict';
// Optional live verification: discloses only the two documented public DNS IPs.
const cp=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {lookupIdentity}=require('../lib/providers');
const {wireQuery,dohQuery}=require('../lib/dns');
(async()=>{
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'openmili-live-p1-'));
  const useProxy=process.argv.includes('--git-proxy');
  const proxy=useProxy?cp.spawnSync('git',['config','--get-urlmatch','http.proxy','https://api.github.com/'],{encoding:'utf8'}).stdout?.trim():'';
  try{
    const options={cacheDir,proxy,timeout:6000,retries:0,refresh:true};
    for(const ip of ['8.8.8.8','2606:4700:4700::1111']) {
      const r=await lookupIdentity(ip,options);
      console.log(JSON.stringify({target:ip,providers:r.records.map(x=>({provider:x.provider,status:x.status,code:x.code,reason:x.reason,asns:x.asns,prefix:x.prefix,rdap_endpoint:x.endpoint})),type:r.attribute.type,type_confidence:r.attribute.confidence,proxy:Boolean(proxy)}));
    }
    for(const protocol of ['udp','tcp','dot']){
      const r=await wireQuery('example.org','A',{server:'1.1.1.1',protocol,servername:'cloudflare-dns.com',timeout:3000});
      console.log(JSON.stringify({module:'dns',protocol,status:r.status,code:r.code,answers:r.answers?.length,latency_ms:r.latency_ms}));
    }
    const doh=await dohQuery('example.org','A',options);console.log(JSON.stringify({module:'dns',protocol:'doh',status:doh.status,code:doh.code,answers:doh.answers?.length,latency_ms:doh.latency_ms,proxy:Boolean(proxy)}));
  }finally{await fs.rm(cacheDir,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
