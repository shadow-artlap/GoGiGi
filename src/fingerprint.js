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
function buildInjection(fp, seed) {
  // Values are inlined as JSON so the page script is self-contained.
  const cfg = {
    seed,
    languages: fp.locale ? [fp.locale, fp.locale.split('-')[0]] : null,
    platform: fp.uaPlatform || null,
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
  const def = (obj, prop, val) => { try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch(e){} };
  // webdriver
  try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch(e){}
  if (C.languages) { def(navigator, 'languages', C.languages); def(navigator, 'language', C.languages[0]); }
  if (C.platform) def(navigator, 'platform', C.platform);
  if (C.hardwareConcurrency) def(navigator, 'hardwareConcurrency', C.hardwareConcurrency);
  if (C.deviceMemory) def(navigator, 'deviceMemory', C.deviceMemory);
  if (C.screen) {
    def(screen, 'width', C.screen.width); def(screen, 'height', C.screen.height);
    def(screen, 'availWidth', C.screen.width); def(screen, 'availHeight', C.screen.height - 40);
  }
  // Seeded PRNG
  let s = Math.floor(C.seed * 1e9) || 123456789;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  // Canvas noise
  if (C.canvasNoise) {
    const noisify = (canvas) => {
      try {
        const ctx = canvas.getContext('2d'); if (!ctx) return;
        const w = canvas.width, h = canvas.height; if (!w || !h) return;
        const img = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < img.data.length; i += Math.floor(rnd()*997)+503) {
          img.data[i] = img.data[i] ^ (Math.floor(rnd()*2));
        }
        ctx.putImageData(img, 0, 0);
      } catch(e){}
    };
    const toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...a){ noisify(this); return toDataURL.apply(this, a); };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...a){ noisify(this); return toBlob.apply(this, a); };
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(...a){
      const d = getImageData.apply(this, a);
      for (let i = 0; i < d.data.length; i += Math.floor(rnd()*1499)+701) { d.data[i] = d.data[i] ^ 1; }
      return d;
    };
  }
  // WebGL vendor/renderer
  if (C.webglVendor || C.webglRenderer) {
    const patch = (proto) => {
      const gp = proto.getParameter;
      proto.getParameter = function(p){
        if (p === 37445 && C.webglVendor) return C.webglVendor;   // UNMASKED_VENDOR_WEBGL
        if (p === 37446 && C.webglRenderer) return C.webglRenderer; // UNMASKED_RENDERER_WEBGL
        return gp.call(this, p);
      };
    };
    try { patch(WebGLRenderingContext.prototype); } catch(e){}
    try { patch(WebGL2RenderingContext.prototype); } catch(e){}
  }
  // WebRTC disable
  if (C.webrtcDisabled) {
    try { window.RTCPeerConnection = undefined; window.webkitRTCPeerConnection = undefined; } catch(e){}
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

module.exports = { launch, stop, isRunning, setOnChange };
