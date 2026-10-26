'use strict';
const net=require('node:net');
function ipNumber(ip) {
  if (net.isIP(ip)===4) return ip.split('.').reduce((a,x)=>(a<<8n)+BigInt(x),0n);
  if (net.isIP(ip)!==6) throw new Error('Invalid IP');
  let text=ip.toLowerCase();
  if(text.includes('.')) {const i=text.lastIndexOf(':');const n=ipNumber(text.slice(i+1));text=text.slice(0,i+1)+(n>>16n).toString(16)+':'+(n&65535n).toString(16);}
  const halves=text.split('::'),left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
  const parts=halves.length===1?left:[...left,...Array(8-left.length-right.length).fill('0'),...right];
  return parts.reduce((a,x)=>(a<<16n)+BigInt('0x'+x),0n);
}
function inPrefix(ip,cidr) {
  if(typeof cidr!=='string') return false;
  const [network,bitsText]=cidr.split('/'),family=net.isIP(ip),bits=Number(bitsText),width=family===4?32:128;
  if(!family || net.isIP(network)!==family || !/^\d+$/.test(bitsText||'') || bits<0 || bits>width) return false;
  return ipNumber(ip)>>BigInt(width-bits)===ipNumber(network)>>BigInt(width-bits);
}
function reverseIP(ip,suffix=true) {
  if(net.isIP(ip)===4) return ip.split('.').reverse().join('.')+(suffix?'.in-addr.arpa':'');
  return ipNumber(ip).toString(16).padStart(32,'0').split('').reverse().join('.')+(suffix?'.ip6.arpa':'');
}
module.exports={ipNumber,inPrefix,reverseIP};
