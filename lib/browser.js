'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createRequire } = require('node:module');
const { classify, isPublicIP, canonicalIP } = require('./core');
const { runProcess } = require('./transport');
const { IP_ENDPOINTS } = require('./identity');
const { startFamilyProxy } = require('./family-proxy');

function browserProxy(proxy) {
  if (!proxy) return undefined;
  const url = new URL(proxy);
  if (['socks5:', 'socks5h:'].includes(url.protocol) && (url.username || url.password)) throw new Error('Chromium 不支持 SOCKS5 用户名密码认证；HTTP 检测仍可进行');
  return { server: `${url.protocol === 'socks5h:' ? 'socks5:' : url.protocol}//${url.host}`,
    ...(url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}), bypass: '' };
}

async function launchBrowser(options, log) {
  const { chromium } = require('playwright');
  const explicitProxy = browserProxy(options.proxy);
  const bridge = explicitProxy ? null : await startFamilyProxy(options.family || 4);
  const launch = { headless: !options.headed, timeout: 20000, proxy: explicitProxy || { server: bridge.server, bypass: '' },
    args: ['--proxy-bypass-list=<-loopback>', '--disable-quic'] };
  const start = async candidate => {
    const browser = await chromium.launch({ ...launch, ...candidate });
    if (bridge) {
      browser.openmiliFamilyProxy = bridge;
      browser.on('disconnected', () => bridge.close().catch(() => {}));
    }
    return browser;
  };
  try {
  // Prefer an installed browser before downloading the managed Chromium build.
  const candidates = options.browserPath ? [{ executablePath: options.browserPath }] : process.platform === 'win32' ? [{ channel: 'msedge' }, { channel: 'chrome' }, {}] : [{}, { channel: 'chrome' }];
  let last;
  for (const candidate of candidates) {
    try { return await start(candidate); } catch (error) { last = error; }
  }
  if (!options.installBrowser || options.browserPath) throw last;
  log('首次运行：正在下载 Chromium 浏览器（系统依赖缺失时会标为未测试）…');
  const req = createRequire(require.resolve('playwright'));
  const cli = path.join(path.dirname(req.resolve('playwright-core/package.json')), 'cli.js');
  const installed = await runProcess(process.execPath, [cli, 'install', 'chromium'], { timeout: 240000, maxOutput: 1024 * 1024 });
  if (installed.code !== 0 || installed.error) throw new Error(`浏览器下载失败: ${installed.error || installed.stderr.slice(-700)}`);
  return await start({});
  } catch (error) { if (bridge) await bridge.close(); throw error; }
}

async function browserIdentity(browser, family, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const observations = [];
  try {
    for (const url of IP_ENDPOINTS[family]) {
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 6000 });
        const ip = canonicalIP((await page.locator('body').innerText({ timeout: 2000 })).trim());
        if (response?.ok() && isPublicIP(ip)) return { status: 'ok', ip, source: url, observations };
        observations.push({ source: url, status: response?.status(), reason: '未返回有效公网 IP' });
      } catch (error) { observations.push({ source: url, reason: error.message.split('\n')[0] }); }
      finally { await page.close().catch(() => {}); }
    }
    return { status: 'untested', reason: '浏览器出口未获取；浏览器结果保留，但不归入该 IP 评分', observations };
  } finally { await context.close(); }
}

async function probePage(browser, target, options = {}) {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(2500);
  context.setDefaultNavigationTimeout(options.timeout || 12000);
  const started = Date.now();
  let deadlineHit = false;
  const deadline = setTimeout(() => { deadlineHit = true; context.close().catch(() => {}); }, (options.timeout || 12000) + (options.browserWait ?? 1800) + 6000);
  let response, navigationError = '';
  try {
    const page = await context.newPage();
    page.on('response', r => {
      if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) response = r;
    });
    try { await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: options.timeout || 12000 }); }
    catch (error) { navigationError = error.message.split('\n')[0]; }
    if (response) await page.waitForTimeout(Math.min(options.browserWait ?? 1800, 10000));
    const body = await page.locator('body').innerText({ timeout: 2500 }).catch(() => '');
    const title = await page.title().catch(() => '');
    let visibleCaptcha = false;
    // A script/widget reference alone is not an active CAPTCHA. Require a visible challenge frame.
    for (const frame of await page.locator('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"][title*="challenge"], iframe[title*="security challenge"]').all()) {
      if (await frame.isVisible().catch(() => false)) { visibleCaptcha = true; break; }
    }
    const result = { status: response?.status() || 0, finalUrl: page.url(), title, body: body.slice(0,200000), dom: true,
      headers: response ? await response.allHeaders() : {}, visibleCaptcha, duration: Date.now() - started,
      error: navigationError && !response ? navigationError : '' };
    const server = response ? await response.serverAddr().catch(() => null) : null;
    result.remoteIP = browser.openmiliFamilyProxy?.remoteFor(result.finalUrl) || (server?.ipAddress || '').replace(/^\[|\]$/g, '');
    result.connectionFamily = browser.openmiliFamilyProxy?.family || net.isIP(result.remoteIP) || null;
    result.transport = browser.openmiliFamilyProxy ? `direct-ipv${browser.openmiliFamilyProxy.family}` : 'explicit-proxy';
    const judgment = classify(result);
    const output = { ...result, ...judgment, navigationWarning: navigationError || undefined };
    delete output.body; delete output.dom;
    if (options.evidenceDir && (options.screenshots || !['reachable','login'].includes(judgment.kind))) {
      const name = `${String(options.index || 0).padStart(3,'0')}-${new URL(target.url).hostname.replace(/[^a-z0-9.-]/gi, '_')}.png`;
      await fs.mkdir(options.evidenceDir, { recursive: true });
      try { await page.screenshot({ path: path.join(options.evidenceDir, name), fullPage: false, timeout: 5000 }); output.screenshot = `evidence/${name}`; }
      catch (error) { output.screenshotError = error.message.split('\n')[0]; }
    }
    return output;
  } catch (error) {
    return { kind: 'untested', label: '未测试', reason: deadlineHit ? '浏览器观测达到总时间上限' : error.message.split('\n')[0], duration: Date.now() - started };
  } finally { clearTimeout(deadline); await context.close().catch(() => {}); }
}

async function probeBrowserSites(sites, options, log = () => {}) {
  let browser;
  try {
    browser = await launchBrowser(options, log);
    const before = options.skipIP ? { status: 'untested', reason: '跳过出口获取，浏览器结果不计入 IP 评分' } : await browserIdentity(browser, options.family);
    log(`浏览器出口: ${before.ip || `未测试（${before.reason}）`}`);
    for (let i = 0; i < sites.length; i++) {
      sites[i].browser = await probePage(browser, sites[i], { ...options, index: i + 1 });
      log(`[${i+1}/${sites.length}] ${sites[i].name}: 浏览器 ${sites[i].browser.label} ${sites[i].browser.status || ''} ${sites[i].browser.duration}ms`);
    }
    const after = options.skipIP ? before : await browserIdentity(browser, options.family);
    const verified = before.status === 'ok' && after.status === 'ok' && before.ip === after.ip && before.ip === options.expectedIP;
    for (const site of sites) {
      const familyMismatch = !options.proxy && site.browser.connectionFamily && site.browser.connectionFamily !== options.family;
      const familyVerified = Boolean(options.proxy) || site.browser.connectionFamily === options.family;
      site.browser.identityVerified = verified && familyVerified;
      if (familyMismatch) site.browser.identityNote = `浏览器实际通过 IPv${site.browser.connectionFamily} 访问，本次选择 IPv${options.family}；不混合计分`;
      else if (!familyVerified) site.browser.identityNote = '未取得本次浏览器连接的协议族；结果保留，不混合计分';
      site.browser.identityMismatch = before.status === 'ok' && Boolean(options.expectedIP) && before.ip !== options.expectedIP || before.status === 'ok' && after.status === 'ok' && before.ip !== after.ip;
    }
    return { status: 'ok', before, after, identityVerified: verified, version: browser.version(),
      note: 'Chromium 独立无登录上下文，观察页面和验证码，不绕过验证；无头指纹、地区、账户及时间同样会影响风控。' };
  } catch (error) {
    const reason = error.message.split('\n').slice(0,4).join(' ').slice(0,900);
    for (const site of sites) if (!site.browser) site.browser = { kind: 'untested', label: '未测试', reason };
    log(`浏览器: 未测试（${reason}）`);
    return { status: 'untested', reason };
  } finally { if (browser) await browser.close().catch(() => {}); }
}

module.exports = { browserProxy, launchBrowser, browserIdentity, probePage, probeBrowserSites };
