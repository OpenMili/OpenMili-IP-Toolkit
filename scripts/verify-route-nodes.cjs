'use strict';
const {resolveNode}=require('../lib/route-engine');
const {mapLimit}=require('../lib/transport');
const directory=require('../data/route-nodes.json');
(async()=>{
  const results=await mapLimit(directory.nodes.flatMap(node=>[4,6].map(family=>({node,family}))),3,async({node,family})=>{
    const r=await resolveNode(node,family,{timeout:4000,retries:0});
    const result={name:r.name,family,ip:r.ip||null,status:r.health.status,reason:r.health.reason,asns:r.health.origin?.asns||[],checked_at:new Date().toISOString()};
    console.log(JSON.stringify(result));return result;
  });
  console.log(JSON.stringify({directory:directory.version,total:results.length,verified:results.filter(x=>x.status==='verified').length,unknown:results.filter(x=>x.status==='unknown').length,mismatch:results.filter(x=>x.status==='mismatch').length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
