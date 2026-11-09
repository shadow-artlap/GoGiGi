'use strict';

// Fingerprint engine. Launches a profile through puppeteer-core (CDP) and
// applies per-profile overrides: timezone, geolocation, locale, user-agent,
// screen metrics, WebRTC policy, and canvas/WebGL noise injected before page
// scripts run. The browser stays open and user-driven; we only inject.

const puppeteer = require('puppeteer-core');

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

async function launch(opts) {
  const { id, exePath, userDataDir, extraArgs = [], proxy, fp = {}, tabs = [], startUrl } = opts;
  if (running.has(id)) return { ok: false, reason: 'already-running' };

  const args = [
    '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    ...extraArgs,
  ];
  if (proxy && proxy.host && proxy.port) {
    args.push(`--proxy-server=${proxy.scheme || 'http'}://${proxy.host}:${proxy.port}`);
  }
  if (fp.webrtc === 'disabled' || fp.webrtc === 'proxy-udp') {
    args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  }
  if (fp.locale) args.push(`--lang=${fp.locale}`);
  if (fp.screen && fp.screen.width) args.push(`--window-size=${fp.screen.width},${fp.screen.height}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: exePath,
      userDataDir,
      headless: false,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args,
    });
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
  running.set(id, { browser });

  const seed = seedFromId(id);
  const injection = buildInjection(fp, seed);

  const applyPage = async (page) => {
    try {
      if (fp.userAgent) {
        await page.setUserAgent(fp.userAgent, fp.uaMetadata || undefined);
      }
      if (fp.timezone) { try { await page.emulateTimezone(fp.timezone); } catch (e) {} }
      if (fp.geo && fp.geo.lat != null && fp.geo.lon != null) {
        try { await page.setGeolocation({ latitude: Number(fp.geo.lat), longitude: Number(fp.geo.lon), accuracy: 50 }); } catch (e) {}
      }
      if (proxy && proxy.username) {
        try { await page.authenticate({ username: proxy.username, password: proxy.password }); } catch (e) {}
      }
      await page.evaluateOnNewDocument(injection);
    } catch (e) { /* ignore */ }
  };

  browser.on('targetcreated', async (t) => {
    try { const p = await t.page(); if (p) await applyPage(p); } catch (e) { /* ignore */ }
  });
  try { for (const p of await browser.pages()) await applyPage(p); } catch (e) {}

  // Grant geolocation permission at context level
  if (fp.geo && fp.geo.lat != null) {
    try {
      const ctx = browser.defaultBrowserContext();
      await ctx.overridePermissions(startUrl || 'https://www.google.com', ['geolocation']);
    } catch (e) {}
  }

  // Open tabs / start URL
  const urls = (tabs && tabs.length) ? tabs : (startUrl ? [startUrl] : []);
  try {
    const pages = await browser.pages();
    for (let i = 0; i < urls.length; i++) {
      const pg = (i === 0 && pages[0]) ? pages[0] : await browser.newPage();
      pg.goto(urls[i], { waitUntil: 'domcontentloaded', timeout: 0 }).catch(() => {});
    }
  } catch (e) {}

  browser.on('disconnected', () => { running.delete(id); if (onChange) onChange(); });
  return { ok: true };
}

async function stop(id) {
  const r = running.get(id);
  if (!r) return { ok: false, reason: 'not-running' };
  try { await r.browser.close(); } catch (e) { /* ignore */ }
  running.delete(id);
  return { ok: true };
}

function isRunning(id) { return running.has(id); }

module.exports = { launch, stop, isRunning, setOnChange, buildInjection };
