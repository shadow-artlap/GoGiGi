'use strict';

// Fingerprint engine. Launches a profile through puppeteer-core (CDP) and
// applies per-profile overrides: timezone, geolocation, locale, user-agent,
// screen metrics, WebRTC policy, and canvas/WebGL noise injected before page
// scripts run. The browser stays open and user-driven; we only inject.

const puppeteer = require('puppeteer-core');
const startpage = require('./startpage');

// profileId -> { browser }
const running = new Map();
let onChange = null;
function setOnChange(fn) { onChange = fn; }

function seedFromId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295; // 0..1
}

// Build the JS injected on every new document to spoof browser fingerprints.
// "Hardened": broad surface coverage, plus the patched functions report
// "[native code]" so the overrides are not detectable by toString inspection.
function buildInjection(fp, seed) {
  const cfg = {
    seed,
    languages: fp.locale ? [fp.locale, fp.locale.split('-')[0]] : null,
    platform: fp.uaPlatform || null,
    vendor: fp.vendor || 'Google Inc.',
    hardwareConcurrency: fp.hardwareConcurrency || null,
    deviceMemory: fp.deviceMemory || null,
    screen: fp.screen && fp.screen.width ? fp.screen : null,
    webglVendor: fp.webglVendor || null,
    webglRenderer: fp.webglRenderer || null,
    canvasNoise: fp.canvasNoise !== false,
    webrtcDisabled: fp.webrtc === 'disabled',
  };
  return `(() => {
  const C = ${JSON.stringify(cfg)};
  // ---- make patched functions report [native code] ----
  const _toString = Function.prototype.toString;
  const native = new WeakMap();
  const tag = (fn, name) => { try { native.set(fn, name || (fn && fn.name) || ''); } catch(e){} return fn; };
  const patchedToString = function toString() {
    if (native.has(this)) return 'function ' + native.get(this) + '() { [native code] }';
    return _toString.call(this);
  };
  tag(patchedToString, 'toString');
  try { Function.prototype.toString = patchedToString; } catch(e){}

  const defGet = (obj, prop, val) => {
    try {
      const g = function () { return val; }; tag(g, 'get ' + prop);
      Object.defineProperty(obj, prop, { get: g, configurable: true, enumerable: true });
    } catch(e){}
  };
  const patch = (obj, name, make) => {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== 'function') return;
      const fn = make(orig); tag(fn, name);
      obj[name] = fn;
    } catch(e){}
  };

  // ---- navigator ----
  try { defGet(Navigator.prototype, 'webdriver', false); } catch(e){ defGet(navigator, 'webdriver', false); }
  if (C.languages) { defGet(navigator, 'languages', Object.freeze(C.languages.slice())); defGet(navigator, 'language', C.languages[0]); }
  if (C.platform) defGet(navigator, 'platform', C.platform);
  if (C.vendor) defGet(navigator, 'vendor', C.vendor);
  if (C.hardwareConcurrency) defGet(navigator, 'hardwareConcurrency', C.hardwareConcurrency);
  if (C.deviceMemory) defGet(navigator, 'deviceMemory', C.deviceMemory);

  // ---- screen ----
  if (C.screen) {
    defGet(screen, 'width', C.screen.width); defGet(screen, 'height', C.screen.height);
    defGet(screen, 'availWidth', C.screen.width); defGet(screen, 'availHeight', Math.max(0, C.screen.height - 48));
    defGet(screen, 'colorDepth', 24); defGet(screen, 'pixelDepth', 24);
  }

  // ---- permissions / Notification consistency (classic headless tell) ----
  try {
    if (navigator.permissions && navigator.permissions.query) {
      patch(navigator.permissions, 'query', (orig) => function (p) {
        if (p && p.name === 'notifications') return Promise.resolve({ state: Notification.permission, onchange: null });
        return orig.call(this, p);
      });
    }
  } catch(e){}

  // ---- seeded PRNG ----
  let s = (Math.floor(C.seed * 1e9) || 123456789) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  // ---- canvas noise (deterministic per profile, undetectable wrappers) ----
  if (C.canvasNoise) {
    const _get = CanvasRenderingContext2D.prototype.getImageData;
    const _put = CanvasRenderingContext2D.prototype.putImageData;
    const perturb = (canvas) => {
      try {
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        const w = canvas.width, h = canvas.height; if (!w || !h || w * h > 4000000) return;
        const img = _get.call(ctx, 0, 0, w, h); const d = img.data;
        for (let i = 0; i < d.length; i += (Math.floor(rnd() * 673) + 311) * 4) { d[i] = d[i] ^ (rnd() < 0.5 ? 1 : 0); }
        _put.call(ctx, img, 0, 0);
      } catch(e){}
    };
    patch(HTMLCanvasElement.prototype, 'toDataURL', (o) => function () { perturb(this); return o.apply(this, arguments); });
    patch(HTMLCanvasElement.prototype, 'toBlob', (o) => function () { perturb(this); return o.apply(this, arguments); });
    patch(CanvasRenderingContext2D.prototype, 'getImageData', (o) => function () {
      const d = o.apply(this, arguments);
      try { const a = d.data; for (let i = 0; i < a.length; i += (Math.floor(rnd() * 1009) + 503) * 4) { a[i] = a[i] ^ 1; } } catch(e){}
      return d;
    });
  }

  // ---- WebGL vendor / renderer ----
  if (C.webglVendor || C.webglRenderer) {
    const gl = (proto) => patch(proto, 'getParameter', (o) => function (p) {
      if (p === 37445 && C.webglVendor) return C.webglVendor;    // UNMASKED_VENDOR_WEBGL
      if (p === 37446 && C.webglRenderer) return C.webglRenderer; // UNMASKED_RENDERER_WEBGL
      return o.call(this, p);
    });
    try { gl(WebGLRenderingContext.prototype); } catch(e){}
    try { gl(WebGL2RenderingContext.prototype); } catch(e){}
  }

  // ---- AudioContext subtle noise ----
  try {
    if (window.AnalyserNode) {
      patch(AnalyserNode.prototype, 'getFloatFrequencyData', (o) => function (arr) {
        o.call(this, arr);
        try { for (let i = 0; i < arr.length; i += 97) arr[i] = arr[i] + (rnd() - 0.5) * 1e-3; } catch(e){}
      });
    }
  } catch(e){}

  // ---- WebRTC disable ----
  if (C.webrtcDisabled) {
    try { defGet(window, 'RTCPeerConnection', undefined); defGet(window, 'webkitRTCPeerConnection', undefined); } catch(e){}
  }
  })();`;
}

const ProxyChain = require('proxy-chain');
const launchingIds = new Set();

function upstreamUrl(p) {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@` : '';
  return `${p.scheme || 'http'}://${auth}${p.host}:${p.port}`;
}

// UA + Client Hints derived from the REAL engine version, so navigator.userAgent,
// navigator.userAgentData and Sec-CH-UA headers never contradict each other.
function uaFor(major) {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
function uaMetadataFor(major, full) {
  const brands = [
    { brand: 'Chromium', version: String(major) },
    { brand: 'Google Chrome', version: String(major) },
    { brand: 'Not_A Brand', version: '24' },
  ];
  return {
    brands,
    fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === 'Not_A Brand' ? '24.0.0.0' : full })),
    fullVersion: full,
    platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86',
    model: '', mobile: false, bitness: '64', wow64: false,
  };
}

async function launch(opts) {
  const { id, exePath, userDataDir, extraArgs = [], proxy, fp = {}, tabs = [], meta = {}, headless = false, seedKey } = opts;
  if (running.has(id) || launchingIds.has(id)) return { ok: false, reason: 'already-running' };
  launchingIds.add(id);
  let localProxy = null;
  try {
    const args = [
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      ...extraArgs,
    ];
    if (proxy && proxy.host && proxy.port) {
      // Chrome can't authenticate SOCKS proxies, and per-page HTTP auth races on
      // new tabs (first request can 407). A local no-auth forwarder fixes both.
      const needsChain = !!proxy.username || String(proxy.scheme || '').startsWith('socks');
      if (needsChain) {
        localProxy = await ProxyChain.anonymizeProxy({ url: upstreamUrl(proxy), port: 0 });
        args.push(`--proxy-server=${localProxy}`);
      } else {
        args.push(`--proxy-server=${proxy.scheme || 'http'}://${proxy.host}:${proxy.port}`);
      }
    }
    if (fp.webrtc === 'disabled' || fp.webrtc === 'proxy-udp') {
      args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    }
    if (fp.locale) args.push(`--lang=${fp.locale}`);
    if (fp.screen && fp.screen.width) args.push(`--window-size=${fp.screen.width},${fp.screen.height}`);

    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: exePath, userDataDir, headless, defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'], args,
      });
    } catch (e) {
      if (localProxy) await ProxyChain.closeAnonymizedProxy(localProxy, true).catch(() => {});
      localProxy = null;
      const msg = String((e && e.message) || e);
      if (/already running|in use|lock/i.test(msg)) return { ok: false, reason: 'โปรไฟล์นี้ถูกเปิดค้างอยู่ — ปิดหน้าต่างเบราว์เซอร์เดิมก่อน' };
      return { ok: false, reason: msg };
    }
    running.set(id, { browser, localProxy });

    // UA consistent with the real engine unless the user set their own.
    let ua = fp.userAgent || '';
    let uaMeta;
    if (!ua) {
      try {
        const m = (await browser.version()).match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
        if (m) { ua = uaFor(m[1]); uaMeta = uaMetadataFor(m[1], m[0]); }
      } catch (e) { /* keep engine default */ }
    }
    const fpEff = { ...fp, userAgent: ua };
    const injection = buildInjection(fpEff, seedFromId(seedKey || id));

    // One shared promise per page, so callers racing on the same page all wait
    // for the injection to be registered before navigating.
    const applying = new WeakMap();
    const doApply = async (page) => {
      try {
        if (ua) { try { await page.setUserAgent(ua, uaMeta); } catch (e) { try { await page.setUserAgent(ua); } catch (_) {} } }
        if (fp.timezone) { try { await page.emulateTimezone(fp.timezone); } catch (e) {} }
        if (fp.geo && fp.geo.lat != null && fp.geo.lon != null) {
          try { await page.setGeolocation({ latitude: Number(fp.geo.lat), longitude: Number(fp.geo.lon), accuracy: 50 }); } catch (e) {}
        }
        await page.evaluateOnNewDocument(injection);
      } catch (e) { /* ignore */ }
    };
    const applyPage = (page) => {
      if (!applying.has(page)) applying.set(page, doApply(page));
      return applying.get(page);
    };
    // Did this document miss the injection? (compares generated values)
    const missed = async (page) => {
      try {
        return await page.evaluate((hc, sw) => (!!hc && navigator.hardwareConcurrency !== hc) || (!!sw && screen.width !== sw),
          fp.hardwareConcurrency || 0, (fp.screen && fp.screen.width) || 0);
      } catch (e) { return false; }
    };

    browser.on('targetcreated', async (t) => {
      try {
        const p = await t.page(); if (!p) return;
        await applyPage(p);
        // A tab/popup the user opened can start loading before our script is
        // registered. If its current document missed the injection, reload once.
        if (/^https?:/i.test(p.url()) && await missed(p)) await p.reload().catch(() => {});
      } catch (e) { /* ignore */ }
    });
    for (const p of await browser.pages()) await applyPage(p);

    if (fp.geo && fp.geo.lat != null) {
      try { await browser.defaultBrowserContext().overridePermissions((tabs && tabs[0]) || 'https://www.google.com', ['geolocation']); } catch (e) {}
    }

    // First tab: GoGiGi start page; configured tabs open after it.
    const pages = await browser.pages();
    const first = pages[0] || await browser.newPage();
    await applyPage(first);
    await first.setContent(startpage.buildHtml(meta, fpEff), { waitUntil: 'domcontentloaded' }).catch(() => {});
    for (const u of (tabs || [])) {
      const pg = await browser.newPage();
      await applyPage(pg); // register the injection BEFORE navigating
      pg.goto(u, { waitUntil: 'domcontentloaded', timeout: 0 }).catch(() => {});
    }

    browser.on('disconnected', () => {
      const r = running.get(id);
      running.delete(id);
      if (r && r.localProxy) ProxyChain.closeAnonymizedProxy(r.localProxy, true).catch(() => {});
      if (onChange) onChange();
    });
    return { ok: true };
  } catch (e) {
    if (localProxy && !running.has(id)) ProxyChain.closeAnonymizedProxy(localProxy, true).catch(() => {});
    return { ok: false, reason: String((e && e.message) || e) };
  } finally {
    launchingIds.delete(id);
  }
}

async function stop(id) {
  const r = running.get(id);
  if (!r) return { ok: false, reason: 'not-running' };
  try { await r.browser.close(); } catch (e) { /* ignore */ }
  running.delete(id);
  if (r.localProxy) await ProxyChain.closeAnonymizedProxy(r.localProxy, true).catch(() => {});
  return { ok: true };
}
async function stopAll() { await Promise.all([...running.keys()].map((id) => stop(id))); }
function anyRunning() { return running.size > 0; }
function isRunning(id) { return running.has(id); }

// ---- cookies ---------------------------------------------------------------
async function cdpGet(browser) {
  const s = await browser.target().createCDPSession();
  try { return (await s.send('Storage.getCookies')).cookies || []; }
  finally { s.detach().catch(() => {}); }
}
// Set one at a time so a single malformed cookie doesn't reject the whole batch.
async function cdpSet(browser, cookies) {
  const s = await browser.target().createCDPSession();
  let imported = 0; const failed = [];
  try {
    for (const c of cookies) {
      try { await s.send('Storage.setCookies', { cookies: [c] }); imported++; }
      catch (e) { failed.push(c.name); }
    }
  } finally { s.detach().catch(() => {}); }
  return { imported, failed };
}
// A profile that isn't running: open its data headless, do the work, close.
async function withHeadless(exePath, userDataDir, fn) {
  const b = await puppeteer.launch({
    executablePath: exePath, userDataDir, headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try { return await fn(b); } finally { await b.close().catch(() => {}); }
}
async function getCookies(id, exePath, userDataDir) {
  const r = running.get(id);
  if (r) return cdpGet(r.browser);
  return withHeadless(exePath, userDataDir, cdpGet);
}
async function setCookies(id, exePath, userDataDir, cookies) {
  const r = running.get(id);
  if (r) return cdpSet(r.browser, cookies);
  return withHeadless(exePath, userDataDir, (b) => cdpSet(b, cookies));
}

function _browser(id) { const r = running.get(id); return r && r.browser; } // test hook
function _localProxy(id) { const r = running.get(id); return r && r.localProxy; }

module.exports = { launch, stop, stopAll, anyRunning, isRunning, setOnChange, buildInjection, getCookies, setCookies, _browser, _localProxy };
