'use strict';

// Fingerprint engine. Launches a profile through puppeteer-core (CDP) and
// applies per-profile overrides at the engine level (timezone, CPU, geo,
// languages) plus prototype-level noise, before any page/iframe/worker script
// runs. The browser stays open and user-driven; we only inject.

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

// Build the script injected before any page/worker code runs. Only values that
// have no engine-level override live here (deviceMemory, GPU strings, noise).
// Everything is defined on prototypes and shaped like native code: correct
// name/length, no `prototype`, not constructible, and wrong-`this` calls still
// throw "Illegal invocation" — the checks advanced anti-bot scripts run.
function buildInjection(fp, seed, scope = 'page') {
  const cfg = {
    seed,
    worker: scope === 'worker',
    // Chrome only ever reports 0.25/0.5/1/2/4/8 — snap anything else.
    deviceMemory: fp.deviceMemory ? [0.25, 0.5, 1, 2, 4, 8].filter((v) => v <= Number(fp.deviceMemory)).pop() || 0.25 : null,
    hardwareConcurrency: fp.hardwareConcurrency ? Number(fp.hardwareConcurrency) : null,
    webglVendor: fp.webglVendor || null,
    webglRenderer: fp.webglRenderer || null,
    canvasNoise: fp.canvasNoise !== false,
    fontMask: fp.canvasNoise !== false && fp.fontMask !== false,
    webrtcDisabled: fp.webrtc === 'disabled',
  };
  return `(() => {
  'use strict';
  const C = ${JSON.stringify(cfg)};
  const G = self;
  // Run once per realm. A blank popup/iframe window is REUSED when it navigates
  // same-origin, so the script can arrive twice; double patching would double
  // the noise. The guard answers only to a registry symbol derived from the
  // seed — natively toString.call(symbol) throws, so pages can't observe it.
  const KEY = Symbol.for('⁣' + C.seed);
  try { if (Function.prototype.toString.call(KEY) === 'gg') return; } catch (e) {}
  // ---- native-looking patches ----
  const _toString = Function.prototype.toString;
  const native = new WeakMap();
  const tag = (fn, name) => { try { native.set(fn, name); } catch (e) {} return fn; };
  const patchedToString = ({ toString() {
    if (this === KEY) return 'gg';
    if (native.has(this)) return 'function ' + native.get(this) + '() { [native code] }';
    return _toString.call(this);
  } }).toString;
  tag(patchedToString, 'toString');
  try { Function.prototype.toString = patchedToString; } catch (e) {}

  // Method replacement: method-shorthand (no prototype, not a constructor),
  // original length/name kept.
  const patch = (obj, name, make) => {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== 'function') return;
      const impl = make(orig);
      const fn = ({ [name](...a) { return impl.apply(this, a); } })[name];
      Object.defineProperty(fn, 'length', { value: orig.length });
      tag(fn, name);
      obj[name] = fn;
    } catch (e) {}
  };
  // Getter replacement on a prototype; calls the original getter first so a
  // wrong receiver still throws exactly like the native one.
  const defProto = (proto, prop, val) => {
    try {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      const holder = { get [prop]() { if (d && d.get) d.get.call(this); return val; } };
      const g = Object.getOwnPropertyDescriptor(holder, prop).get;
      tag(g, 'get ' + prop);
      Object.defineProperty(proto, prop, { get: g, set: undefined, configurable: d ? d.configurable : true, enumerable: d ? d.enumerable : true });
    } catch (e) {}
  };

  // ---- device values without an engine override ----
  if (C.worker) {
    if (G.WorkerNavigator) {
      if (C.deviceMemory) defProto(WorkerNavigator.prototype, 'deviceMemory', C.deviceMemory);
      // the engine override doesn't reach workers
      if (C.hardwareConcurrency) defProto(WorkerNavigator.prototype, 'hardwareConcurrency', C.hardwareConcurrency);
    }
  } else {
    if (C.deviceMemory && G.Navigator) defProto(Navigator.prototype, 'deviceMemory', C.deviceMemory);
    // Notification permission consistency (classic automation tell)
    if (G.Permissions) patch(Permissions.prototype, 'query', (o) => function (p) {
      if (this instanceof Permissions && p && p.name === 'notifications' && G.Notification) {
        return Promise.resolve(Object.setPrototypeOf({ state: Notification.permission === 'default' ? 'prompt' : Notification.permission, onchange: null }, PermissionStatus.prototype));
      }
      return o.call(this, p);
    });
  }

  // ---- deterministic per-profile noise ----
  const SEEDI = (Math.floor(C.seed * 4294967295) >>> 0) || 0x9e3779b9;
  const mix = (a) => { a = Math.imul(a ^ (a >>> 16), 0x7feb352d); a = Math.imul(a ^ (a >>> 15), 0x846ca68b); return (a ^ (a >>> 16)) >>> 0; };
  const hk = (a, b) => mix(SEEDI ^ mix((a | 0) ^ Math.imul(b | 0, 0x9e3779b1)));
  const noisePixels = (data, x0, y0, w) => {
    if (!w) return;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue; // blank stays blank
      const p = i >> 2; const h = hk(x0 + (p % w), y0 + ((p / w) | 0));
      if (h % 7 !== 0) continue;
      data[i + ((h >>> 3) % 3)] ^= 1;
    }
  };

  if (C.canvasNoise) {
    // 2D contexts (DOM + Offscreen): noised reads, page canvas untouched.
    const ctxProtos = [];
    if (G.CanvasRenderingContext2D) ctxProtos.push(CanvasRenderingContext2D.prototype);
    if (G.OffscreenCanvasRenderingContext2D) ctxProtos.push(OffscreenCanvasRenderingContext2D.prototype);
    const origGet = new Map(), origPut = new Map();
    for (const P of ctxProtos) { origGet.set(P, P.getImageData); origPut.set(P, P.putImageData); }
    const noisedCopy = (src, make2d) => {
      const w = src.width, h = src.height;
      if (!w || !h || w * h > 16000000) return null;
      const t = make2d(w, h); const tc = t.getContext('2d'); tc.drawImage(src, 0, 0);
      const P = Object.getPrototypeOf(tc);
      const img = origGet.get(P).call(tc, 0, 0, w, h); noisePixels(img.data, 0, 0, w); origPut.get(P).call(tc, img, 0, 0);
      return t;
    };
    if (G.HTMLCanvasElement) {
      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const _toDataURL = HTMLCanvasElement.prototype.toDataURL, _toBlob = HTMLCanvasElement.prototype.toBlob;
      patch(HTMLCanvasElement.prototype, 'toDataURL', (o) => function () {
        try { const c = noisedCopy(this, mk); if (c) return _toDataURL.apply(c, arguments); } catch (e) {}
        return o.apply(this, arguments);
      });
      patch(HTMLCanvasElement.prototype, 'toBlob', (o) => function () {
        try { const c = noisedCopy(this, mk); if (c) return _toBlob.apply(c, arguments); } catch (e) {}
        return o.apply(this, arguments);
      });
    }
    if (G.OffscreenCanvas) {
      const mk = (w, h) => new OffscreenCanvas(w, h);
      const _convert = OffscreenCanvas.prototype.convertToBlob;
      patch(OffscreenCanvas.prototype, 'convertToBlob', (o) => function () {
        try { const c = noisedCopy(this, mk); if (c) return _convert.apply(c, arguments); } catch (e) {}
        return o.apply(this, arguments);
      });
    }
    for (const P of ctxProtos) {
      patch(P, 'getImageData', (o) => function (sx, sy) {
        const d = o.apply(this, arguments);
        try { noisePixels(d.data, sx | 0, sy | 0, d.width); } catch (e) {}
        return d;
      });
    }
    // WebGL pixel reads
    for (const k of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      if (!G[k]) continue;
      patch(G[k].prototype, 'readPixels', (o) => function (x, y, w, h, format, type, pixels) {
        const r = o.apply(this, arguments);
        try { if (pixels instanceof Uint8Array && format === 0x1908 && type === 0x1401) noisePixels(pixels, x | 0, y | 0, w | 0); } catch (e) {}
        return r;
      });
    }
    // Text metrics: tiny per-profile width offset (< 0.01px) on genuine objects.
    try {
      if (G.TextMetrics) {
        const TM = TextMetrics.prototype;
        const wd = Object.getOwnPropertyDescriptor(TM, 'width');
        const deltas = new WeakMap();
        for (const P of ctxProtos) {
          patch(P, 'measureText', (o) => function (text) {
            const m = o.apply(this, arguments);
            try {
              let th = 0; const st = String(text);
              for (let i = 0; i < st.length; i++) th = Math.imul(th ^ st.charCodeAt(i), 16777619);
              deltas.set(m, ((hk(th, 977) % 1000) / 1000 - 0.5) * 0.02);
            } catch (e) {}
            return m;
          });
        }
        if (wd && wd.get) {
          const holder = { get width() { const v = wd.get.call(this); const dl = deltas.get(this); return dl ? v + dl : v; } };
          const g = Object.getOwnPropertyDescriptor(holder, 'width').get;
          tag(g, 'get width');
          Object.defineProperty(TM, 'width', { get: g, set: undefined, configurable: wd.configurable, enumerable: wd.enumerable });
        }
      }
    } catch (e) {}
    // Audio: deterministic, once per buffer channel.
    try {
      if (G.AudioBuffer) {
        const _gcd = AudioBuffer.prototype.getChannelData;
        const done = new WeakMap();
        const noiseCh = (buf, ch) => {
          let set = done.get(buf); if (!set) { set = new Set(); done.set(buf, set); }
          if (set.has(ch)) return; set.add(ch);
          const a = _gcd.call(buf, ch);
          for (let i = 0; i < a.length; i++) { const h = hk(i, ch + 101); if (h % 100 === 0) a[i] += ((h >>> 8) % 1000 / 1000 - 0.5) * 1e-6; }
        };
        patch(AudioBuffer.prototype, 'getChannelData', (o) => function (ch) { if (this instanceof AudioBuffer) { try { noiseCh(this, ch); } catch (e) {} } return o.apply(this, arguments); });
        patch(AudioBuffer.prototype, 'copyFromChannel', (o) => function (dest, ch) { if (this instanceof AudioBuffer) { try { noiseCh(this, ch); } catch (e) {} } return o.apply(this, arguments); });
      }
      if (G.AnalyserNode) {
        patch(AnalyserNode.prototype, 'getFloatFrequencyData', (o) => function (arr) {
          const r = o.apply(this, arguments);
          try { for (let i = 0; i < arr.length; i++) { const h = hk(i, 7); if (h % 10 === 0) arr[i] += ((h >>> 8) % 1000 / 1000 - 0.5) * 1e-3; } } catch (e) {}
          return r;
        });
      }
    } catch (e) {}
  }

  // ---- per-profile font list ----
  // Each profile "has" a different subset of the optional fonts (Office /
  // app-installed families — their absence is normal on real PCs). A hidden
  // family is swapped for a name that exists nowhere, so the engine behaves
  // exactly as if it were not installed (width probes, canvas, fonts.check);
  // getters map the swap back, so the page reads what it wrote.
  if (C.fontMask) {
    const OFFICE = ['agency fb','algerian','arial narrow','arial rounded mt bold','baskerville old face','bauhaus 93','bell mt','berlin sans fb','berlin sans fb demi','bernard mt condensed','blackadder itc','bodoni mt','bodoni mt black','bodoni mt condensed','book antiqua','bookman old style','bradley hand itc','britannic bold','broadway','brush script mt','californian fb','calisto mt','castellar','centaur','century','century gothic','century schoolbook','chiller','colonna mt','cooper black','copperplate gothic bold','copperplate gothic light','curlz mt','edwardian script itc','elephant','engravers mt','eras bold itc','eras demi itc','eras light itc','eras medium itc','felix titling','footlight mt light','forte','franklin gothic book','franklin gothic demi','franklin gothic demi cond','franklin gothic heavy','franklin gothic medium cond','freestyle script','french script mt','garamond','gigi','gill sans mt','gill sans mt condensed','gill sans ultra bold','gloucester mt extra condensed','goudy old style','goudy stout','haettenschweiler','harlow solid italic','harrington','high tower text','imprint mt shadow','informal roman','jokerman','juice itc','kristen itc','kunstler script','lucida bright','lucida calligraphy','lucida fax','lucida handwriting','lucida sans','lucida sans typewriter','magneto','maiandra gd','matura mt script capitals','mistral','modern no. 20','monotype corsiva','ms outlook','ms reference sans serif','ms reference specialty','niagara engraved','niagara solid','ocr a extended','old english text mt','onyx','palace script mt','papyrus','parchment','perpetua','perpetua titling mt','playbill','poor richard','pristina','rage italic','ravie','rockwell','rockwell condensed','rockwell extra bold','script mt bold','showcard gothic','snap itc','stencil','tempus sans itc','tw cen mt','tw cen mt condensed','viner hand itc','vivaldi','vladimir script','wide latin','wingdings 2','wingdings 3','bookshelf symbol 7','calibri light','dubai','dubai light','dubai medium','leelawadee','microsoft uighur','sakkal majalla','simplified arabic','traditional arabic','angsana new','angsanaupc','browallia new','browalliaupc','cordia new','cordiaupc','dilleniaupc','eucrosiaupc','freesiaupc','irisupc','jasmineupc','kodchiangupc','lilyupc','adobe garamond pro','minion pro','myriad pro','segoe fluent icons','segoe ui variable','cascadia code','cascadia mono','sitka','nirmala ui semilight'];
    const noOffice = hk(4242, 1) % 100 < 28; // a machine without Office
    const hidden = new Map(); // lower-case name -> token
    OFFICE.forEach((n, i) => {
      const h = hk(i, 313);
      if ((noOffice && i < 120) || h % 100 < 32) hidden.set(n, 'x' + (SEEDI >>> 8).toString(36) + 'q' + i.toString(36));
    });
    const byToken = new Map([...hidden].map(([n, t]) => [t, n]));
    const spell = new Map(); // token -> spelling the page used last
    const unq = (x) => x.trim().replace(/^(['"])(.*)\\1$/, '$2').trim();
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\\w+|math|emoji|fangsong|inherit|initial|unset|revert)$/i;
    // split on commas outside quotes
    const splitList = (v) => { const out = []; let cur = '', q = ''; for (const ch of v) { if (q) { if (ch === q) q = ''; cur += ch; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
    const swapFamily = (fam) => { const raw = unq(fam); const n = raw.toLowerCase(); if (GENERIC.test(n)) return fam; const t = hidden.get(n); if (!t) return fam; spell.set(t, raw); return ' ' + t; };
    // "Candara, serif" (list), "bold 12px/1.2 Candara, serif" (shorthand),
    // or a whole cssText ('css').
    const sanitize = (v, shorthand) => {
      if (typeof v !== 'string' || !v) return v;
      if (shorthand === 'css') {
        return v.replace(/(font-family\\s*:\\s*)([^;]+)/gi, (a, k, val) => k + sanitize(val, false))
          .replace(/((?:^|[;\\s])font\\s*:\\s*)([^;]+)/gi, (a, k, val) => k + sanitize(val, true));
      }
      return splitList(v).map((p, i) => {
        if (shorthand && i === 0) {
          const m = p.match(/^(.*?\\d[\\w.%]*(?:\\s*\\/\\s*[\\w.%]+)?\\s+)(.+)$/);
          return m ? m[1] + swapFamily(m[2]).trim() : p;
        }
        return swapFamily(p);
      }).join(',');
    };
    // Chrome serializes one-word names bare, others in double quotes.
    const quoteName = (n) => /^[a-z_][\\w-]*$/i.test(n) ? n : '"' + n + '"';
    const restore = (v) => {
      if (typeof v !== 'string' || v.indexOf('q') < 0) return v;
      return v.replace(/(["']?)\\b(x[0-9a-z]+q[0-9a-z]+)\\b\\1/g, (all, q, t) => byToken.has(t) ? quoteName(spell.get(t) || byToken.get(t)) : all);
    };
    const wrapAccessor = (proto, prop, shorthand) => {
      try {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (!d || !d.set || !d.get) return;
        const h = { get [prop]() { return restore(d.get.call(this)); }, set [prop](v) { d.set.call(this, sanitize(String(v), shorthand)); } };
        const dd = Object.getOwnPropertyDescriptor(h, prop);
        tag(dd.get, 'get ' + prop); tag(dd.set, 'set ' + prop);
        Object.defineProperty(proto, prop, { get: dd.get, set: dd.set, configurable: d.configurable, enumerable: d.enumerable });
      } catch (e) {}
    };
    if (G.CSSStyleDeclaration) {
      const P = CSSStyleDeclaration.prototype;
      const _setP = P.setProperty, _getPV = P.getPropertyValue;
      // camelCase CSS props are served by a named interceptor that loses to the
      // prototype, so accessors here see every style.fontFamily / style.font.
      const cssProp = (prop, cssName, shorthand) => {
        try {
          const h = { get [prop]() { return restore(_getPV.call(this, cssName)); }, set [prop](v) { _setP.call(this, cssName, sanitize(String(v), shorthand)); } };
          const dd = Object.getOwnPropertyDescriptor(h, prop);
          tag(dd.get, 'get ' + prop); tag(dd.set, 'set ' + prop);
          Object.defineProperty(P, prop, { get: dd.get, set: dd.set, configurable: true, enumerable: true });
        } catch (e) {}
      };
      cssProp('fontFamily', 'font-family', false);
      cssProp('font', 'font', true);
      wrapAccessor(P, 'cssText', 'css');
      patch(P, 'setProperty', (o) => function (name, value) {
        const a = Array.prototype.slice.call(arguments);
        const n = String(name).toLowerCase();
        if (n === 'font-family') a[1] = sanitize(String(value), false); else if (n === 'font') a[1] = sanitize(String(value), true);
        return o.apply(this, a);
      });
      patch(P, 'getPropertyValue', (o) => function () { return restore(o.apply(this, arguments)); });
    }
    for (const k of ['CanvasRenderingContext2D', 'OffscreenCanvasRenderingContext2D']) if (G[k]) wrapAccessor(G[k].prototype, 'font', true);
    if (G.FontFaceSet) {
      patch(FontFaceSet.prototype, 'check', (o) => function (font) { const a = Array.prototype.slice.call(arguments); if (typeof font === 'string') a[0] = sanitize(font, true); return o.apply(this, a); });
      patch(FontFaceSet.prototype, 'load', (o) => function (font) { const a = Array.prototype.slice.call(arguments); if (typeof font === 'string') a[0] = sanitize(font, true); return o.apply(this, a); });
    }
    if (typeof G.queryLocalFonts === 'function') {
      patch(G, 'queryLocalFonts', (o) => function () {
        return o.apply(this, arguments).then((list) => list.filter((f) => !hidden.has(String(f.family).toLowerCase())));
      });
    }
  }

  // ---- WebGL vendor / renderer (pages and workers) ----
  if (C.webglVendor || C.webglRenderer) {
    for (const k of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      if (!G[k]) continue;
      patch(G[k].prototype, 'getParameter', (o) => function (p) {
        const r = o.apply(this, arguments); // validates receiver
        if (p === 37445 && C.webglVendor) return C.webglVendor;
        if (p === 37446 && C.webglRenderer) return C.webglRenderer;
        return r;
      });
    }
  }

  // ---- WebRTC disable (opt-in) ----
  if (C.webrtcDisabled && !C.worker) {
    for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
      try { Object.defineProperty(G, k, { value: undefined, writable: true, configurable: true }); } catch (e) {}
    }
  }
})();`;
}

const ProxyChain = require('proxy-chain');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { CDPSessionEvent } = require('puppeteer-core');
const launchingIds = new Set();

function upstreamUrl(p) {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@` : '';
  return `${p.scheme || 'http'}://${auth}${p.host}:${p.port}`;
}

// UA + Client Hints derived from the REAL engine version (used only for
// headless, where the native UA says "HeadlessChrome").
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

// "th-TH" -> "th-TH,th,en-US,en" — what a real user's language list looks like.
function langList(locale) {
  if (!locale) return '';
  const out = [locale];
  const base = locale.split('-')[0];
  if (base && base !== locale) out.push(base);
  if (base !== 'en') out.push('en-US', 'en');
  return [...new Set(out)].join(',');
}

// Languages are set the way a person sets them (Chrome preferences), so
// navigator.languages, Accept-Language, workers and iframes all agree natively.
function writePrefs(userDataDir, fp) {
  try {
    const dir = path.join(userDataDir, 'Default');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'Preferences');
    let prefs = {};
    try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* first run */ }
    const langs = langList(fp.locale);
    if (langs) { prefs.intl = prefs.intl || {}; prefs.intl.accept_languages = langs; prefs.intl.selected_languages = langs; }
    // A crash/kill must not show the "Restore pages?" bubble next launch.
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = 'Normal'; prefs.profile.exited_cleanly = true;
    fs.writeFileSync(file, JSON.stringify(prefs));
  } catch (e) { /* non-fatal */ }
}

function serveStartPage(html) {
  return new Promise((resolve) => {
    const srv = http.createServer((q, s) => {
      s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      s.end(html);
    });
    srv.on('error', () => resolve(null));
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function launch(opts) {
  const { id, exePath, userDataDir, extraArgs = [], proxy, fp = {}, tabs = [], meta = {}, headless = false, seedKey } = opts;
  if (running.has(id) || launchingIds.has(id)) return { ok: false, reason: 'already-running' };
  launchingIds.add(id);
  let localProxy = null, startSrv = null;
  try {
    // A real Chrome command line: none of puppeteer's automation defaults
    // (--enable-automation, --disable-popup-blocking, throttling off, ...).
    const args = [
      `--user-data-dir=${userDataDir}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ];
    if (headless) args.push('--headless=new', '--window-size=1920,1080');
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
      args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp');
    }
    if (fp.locale) args.push(`--lang=${fp.locale}`);
    const explicitScreen = fp.screen && fp.screen.width && fp.screen.height ? { w: Number(fp.screen.width), h: Number(fp.screen.height) } : null;
    if (explicitScreen && !headless) args.push(`--window-size=${Math.min(explicitScreen.w, 1600)},${Math.min(explicitScreen.h - 80, 900)}`);
    args.push(...extraArgs, 'about:blank');
    writePrefs(userDataDir, fp);

    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath: exePath, headless: false, defaultViewport: null, pipe: true,
        ignoreDefaultArgs: true, args, timeout: 90000, protocolTimeout: 90000,
      });
    } catch (e) {
      if (localProxy) await ProxyChain.closeAnonymizedProxy(localProxy, true).catch(() => {});
      localProxy = null;
      const msg = String((e && e.message) || e);
      if (/already running|in use|lock/i.test(msg)) return { ok: false, reason: 'โปรไฟล์นี้ถูกเปิดค้างอยู่ — ปิดหน้าต่างเบราว์เซอร์เดิมก่อน' };
      return { ok: false, reason: msg };
    }
    running.set(id, { browser, localProxy, startSrv: null, exePath });

    // UA: the native one is already genuine and matches its Client Hints.
    // Override only when the user typed a custom UA, or in headless mode.
    let ua = fp.userAgent || '';
    let uaMeta;
    let realFull = '';
    try { const m = (await browser.version()).match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/); if (m) realFull = m[0]; } catch (e) {}
    if (!ua && headless && realFull) ua = uaFor(realFull.split('.')[0]);
    if (ua) {
      const cm = ua.match(/Chrome\/(\d+)/);
      if (cm && /Windows/.test(ua)) uaMeta = uaMetadataFor(cm[1], cm[1] === realFull.split('.')[0] ? realFull : `${cm[1]}.0.0.0`);
    }
    const fpEff = { ...fp, userAgent: ua };
    const seed = seedFromId(seedKey || id);
    const pageScript = buildInjection(fpEff, seed, 'page');
    const workerScript = buildInjection(fpEff, seed, 'worker');
    const hc = Number(fp.hardwareConcurrency) || 0;
    const dm = Number(fp.deviceMemory) || 0;
    const geo = fp.geo && fp.geo.lat != null && fp.geo.lon != null ? { latitude: Number(fp.geo.lat), longitude: Number(fp.geo.lon), accuracy: 30 + Math.round(seed * 40) } : null;
    const langs = langList(fp.locale);

    // Engine-level overrides, sent while the new target is still paused
    // (puppeteer emits Ready synchronously before Runtime.runIfWaitingForDebugger),
    // so the first line of any page, iframe or worker already sees them.
    const applyTarget = (session) => {
      if (!session || session.__gg) return session && session.__gg;
      let type = '';
      try { type = session._target()._getTargetInfo().type; } catch (e) { return null; }
      const send = (m, p) => session.send(m, p).catch(() => {});
      const all = [];
      if (type === 'page' || type === 'iframe') {
        all.push(send('Page.enable'));
        if (ua) all.push(send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: langs || undefined, platform: 'Win32', userAgentMetadata: uaMeta }));
        if (fp.timezone) all.push(send('Emulation.setTimezoneOverride', { timezoneId: fp.timezone }));
        if (hc) all.push(send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: hc }));
        if (geo) all.push(send('Emulation.setGeolocationOverride', geo));
        if (explicitScreen && type === 'page') {
          all.push(send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false, screenWidth: explicitScreen.w, screenHeight: explicitScreen.h }));
        }
        all.push(send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript, runImmediately: true }));
        // Renderer-opened tabs/popups (have an opener) start paused correctly;
        // never reload those — it would break sign-in popups and POST results.
        if (type === 'page' && !session._target()._getTargetInfo().openerId) watchMiss(session);
      } else if (type === 'worker' || type === 'shared_worker') {
        all.push(send('Runtime.evaluate', { expression: workerScript }));
        if (ua) all.push(send('Network.setUserAgentOverride', { userAgent: ua, acceptLanguage: langs || undefined, platform: 'Win32', userAgentMetadata: uaMeta }));
      } else {
        return null;
      }
      session.__gg = Promise.all(all);
      if (type === 'page') session.__gg.then(() => session.__ggCheck && session.__ggCheck());
      return session.__gg;
    };
    // Safety net for tabs opened straight to a URL (Target.createTarget with a
    // url, some extensions): Chrome can start those before our overrides land.
    // A correctly paused tab is still on its initial blank document when the
    // overrides finish; one that already shows a real page raced — reload it once.
    const watchMiss = (session) => {
      session.__ggCheck = async () => {
        try {
          const r = await session.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
          const u = String(r.result.value || '');
          if (!/^https?:/i.test(u) || (startOrigin && u.startsWith(startOrigin))) return;
          await session.send('Page.reload', {});
        } catch (e) { /* navigating already (=> after our overrides) or closed */ }
      };
    };
    let startOrigin = '';

    const rootSession = await browser.target().createCDPSession();
    const conn = rootSession.connection();
    // Ready is emitted on the PARENT session (or the connection for top-level
    // targets); the connection announces every new session, so this covers all.
    const onReady = (s) => { applyTarget(s); };
    conn.on(CDPSessionEvent.Ready, onReady);
    conn.on(CDPSessionEvent.SessionAttached, (s) => s.on(CDPSessionEvent.Ready, onReady));
    // Targets that existed before the hook (the initial blank tab).
    for (const t of browser.targets()) {
      try { const s = t._session && t._session(); if (s) { s.on(CDPSessionEvent.Ready, onReady); applyTarget(s); } } catch (e) {}
    }

    const pageSession = async (targetId) => {
      const t = await browser.waitForTarget((x) => x._targetId === targetId, { timeout: 15000 });
      const s = t._session();
      await applyTarget(s);
      return s;
    };
    const firstTarget = browser.targets().find((t) => t.type() === 'page');

    // First tab: GoGiGi start page (served on loopback — a secure context, so
    // copy-to-clipboard works). Configured tabs open blank, get the overrides,
    // then navigate — no race with the first script.
    startSrv = await serveStartPage(startpage.buildHtml(meta, fpEff));
    running.get(id).startSrv = startSrv;
    const startUrl = startSrv ? `http://127.0.0.1:${startSrv.address().port}/` : 'about:blank';
    if (startSrv) startOrigin = startUrl;
    try {
      if (firstTarget) { const s = await pageSession(firstTarget._targetId); await s.send('Page.navigate', { url: startUrl }); }
    } catch (e) { /* ignore */ }
    for (const u of (tabs || [])) {
      try {
        const { targetId } = await rootSession.send('Target.createTarget', { url: 'about:blank' });
        const s = await pageSession(targetId);
        s.send('Page.navigate', { url: u }).catch(() => {});
      } catch (e) { /* ignore */ }
    }

    browser.on('disconnected', () => {
      const r = running.get(id);
      running.delete(id);
      if (r && r.localProxy) ProxyChain.closeAnonymizedProxy(r.localProxy, true).catch(() => {});
      if (r && r.startSrv) try { r.startSrv.close(); } catch (e) {}
      if (onChange) onChange();
    });
    return { ok: true };
  } catch (e) {
    if (!running.has(id)) {
      if (localProxy) ProxyChain.closeAnonymizedProxy(localProxy, true).catch(() => {});
      if (startSrv) try { startSrv.close(); } catch (er) {}
    }
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
  if (r.startSrv) try { r.startSrv.close(); } catch (e) {}
  return { ok: true };
}
async function stopAll() { await Promise.all([...running.keys()].map((id) => stop(id))); }
function anyRunning() { return running.size > 0; }
function exePathsInUse() { return [...running.values()].map((r) => r.exePath).filter(Boolean); }
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

module.exports = { launch, stop, stopAll, anyRunning, isRunning, exePathsInUse, setOnChange, buildInjection, getCookies, setCookies, _browser, _localProxy };
