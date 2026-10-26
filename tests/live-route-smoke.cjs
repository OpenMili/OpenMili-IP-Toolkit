'use strict';
// Run explicitly on Linux CI with traceroute installed; these are real loopback probes.
const assert=require('node:assert/strict');
const {runTraceroute}=require('../lib/route-engine');
(async()=>{
  for(const family of [4,6])for(const protocol of ['icmp','tcp','udp']) {
    const r=await runTraceroute(family===4?'127.0.0.1':'::1',protocol,{maxHops:2,routeTimeout:10000});
    assert.equal(r.reached,true,JSON.stringify(r));assert.ok(r.hops.some(h=>h.ip));
    console.log(`REAL traceroute IPv${family} ${protocol}: REACHED`);
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
