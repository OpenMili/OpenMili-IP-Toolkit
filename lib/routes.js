'use strict';
const net = require('node:net');
const { runProcess, mapLimit, jsonRequest } = require('./transport');
const { isPublicIP } = require('./core');
const {parseHops:parseTrace,measureRoutes:traceRoutes}=require('./route-engine');

// Target list and prefix heuristics adapted from zhanghanyun/backtrace (MIT).
// Prefixes are a fallback hint, never sufficient evidence for a guaranteed product class.
const DEFAULT_TARGETS = [
  ['北京电信','219.141.140.10'], ['北京联通','202.106.195.68'], ['北京移动','221.179.155.161'],
  ['上海电信','202.96.209.133'], ['上海联通','210.22.97.1'], ['上海移动','211.136.112.200'],
  ['广州电信','58.60.188.222'], ['广州联通','210.21.196.6'], ['广州移动','120.196.165.24'],
  ['成都电信','61.139.2.69'], ['成都联通','119.6.6.6'], ['成都移动','211.137.96.205']
].map(([name, ip]) => ({ name, ip }));
const LINES = { 4134: '电信 163', 4809: '电信 CN2（不能据此区分 GIA/GT）', 4837: '联通 4837', 9929: '联通 9929',
  58807: '移动 CMIN2', 9808: '移动骨干', 58453: '移动 CMI' };

function prefixHint(ip) {
  const [a,b,c] = ip.split('.').map(Number);
  if (a === 59 && b === 43) return 4809;
  if (a === 202 && b === 97) return 4134;
  if (a === 218 && b === 105 || a === 210 && b === 51) return 9929;
  if (a === 219 && b === 158) return 4837;
  if (a === 223 && b === 120 && [16,17,19].includes(c)) return 58807;
  if (a === 223 && [118,119,120,121].includes(b)) return 58453;
  return null;
}

function parseRouteTargets(value) {
  if (!value) return undefined;
  return String(value).split(/[\s,]+/).filter(Boolean).map(entry => {
    const match = entry.match(/^([^=]+)=(.+)$/);
    if (!match || !net.isIP(match[2]) || !isPublicIP(match[2])) throw new Error(`无效回程目标: ${entry}，需要 名称=公网IPv4/IPv6`);
    return { name: match[1], ip: match[2] };
  });
}

module.exports = { DEFAULT_TARGETS, LINES, prefixHint, parseTrace, parseRouteTargets, traceRoutes };
