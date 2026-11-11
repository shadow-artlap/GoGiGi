'use strict';

// Proxy tester: routes a request through the given proxy to an IP geolocation
// service and returns the exit IP, country, timezone and coordinates — used to
// verify a proxy and to auto-match the profile fingerprint to it.

const http = require('http');
const https = require('https');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Minimal country -> locale map (fallbacks to en-<CC>).
const LOCALE_BY_CC = {
  TH: 'th-TH', LA: 'lo-LA', US: 'en-US', GB: 'en-GB', VN: 'vi-VN', JP: 'ja-JP',
  KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK', ID: 'id-ID', MY: 'ms-MY',
  PH: 'en-PH', SG: 'en-SG', IN: 'en-IN', DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES',
  IT: 'it-IT', RU: 'ru-RU', BR: 'pt-BR', PT: 'pt-PT', NL: 'nl-NL', AU: 'en-AU',
  CA: 'en-CA', MX: 'es-MX', TR: 'tr-TR', PL: 'pl-PL', SE: 'sv-SE', AE: 'ar-AE',
};
function localeForCountry(cc) {
  if (!cc) return '';
  return LOCALE_BY_CC[cc.toUpperCase()] || `en-${cc.toUpperCase()}`;
}
function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + (cc.toUpperCase().charCodeAt(0) - 65), base + (cc.toUpperCase().charCodeAt(1) - 65));
}

function agentFor(proxy, httpsTarget) {
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@` : '';
  const scheme = proxy.scheme || 'http';
  const url = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
  if (scheme.startsWith('socks')) return new SocksProxyAgent(url);
  // https targets always tunnel (CONNECT); plain http can use a forwarding agent
  if (httpsTarget || scheme === 'https') return new HttpsProxyAgent(url);
  return new HttpProxyAgent(url);
}

// Several lookup services, each normalized to one shape. Free services rate
// limit (HTTP 429) when many profiles share an exit IP, so we fall through.
const SERVICES = [
  {
    url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,timezone,lat,lon,isp,query',
    map: (j) => j.status === 'success' && { ip: j.query, country: j.country, countryCode: j.countryCode, city: j.city, region: j.regionName, timezone: j.timezone, lat: j.lat, lon: j.lon, isp: j.isp },
  },
  {
    url: 'https://ipwho.is/',
    map: (j) => j.success !== false && j.ip && { ip: j.ip, country: j.country, countryCode: j.country_code, city: j.city, region: j.region, timezone: j.timezone && j.timezone.id, lat: j.latitude, lon: j.longitude, isp: j.connection && (j.connection.isp || j.connection.org) },
  },
  {
    url: 'https://ipinfo.io/json',
    map: (j) => j.ip && { ip: j.ip, country: j.country, countryCode: j.country, city: j.city, region: j.region, timezone: j.timezone, lat: j.loc ? Number(j.loc.split(',')[0]) : null, lon: j.loc ? Number(j.loc.split(',')[1]) : null, isp: j.org },
  },
];

// One request through the proxy. Resolves {status, body} or {neterr}.
function fetchVia(proxy, url, timeout) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https:');
    let agent;
    try { agent = agentFor(proxy, isHttps); } catch (e) { return resolve({ neterr: String((e && e.message) || e) }); }
    let req; let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(guard); try { req && req.destroy(); } catch (e) {} resolve(r); };
    // proxy agents don't always honor the socket timeout during CONNECT
    const guard = setTimeout(() => finish({ neterr: 'timeout' }), timeout);
    try {
      req = (isHttps ? https : http).get(url, { agent, timeout, headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; if (d.length > 65536) finish({ status: res.statusCode, body: '' }); });
        res.on('end', () => finish({ status: res.statusCode, body: d }));
        res.on('error', (e) => finish({ neterr: String((e && e.message) || e) }));
      });
    } catch (e) { return finish({ neterr: String((e && e.message) || e) }); }
    req.on('timeout', () => finish({ neterr: 'timeout' }));
    req.on('error', (e) => finish({ neterr: String((e && e.message) || e) }));
  });
}

// Returns { ok:true, ip, country, ... } or { ok:false, reason, kind }
// kind: 'proxy'  = the proxy itself is dead/refused (don't launch through it)
//       'lookup' = proxy works but every lookup service refused/limited us
async function test(proxy, timeout = 12000) {
  if (!proxy || !proxy.host || !proxy.port) return { ok: false, reason: 'no-proxy', kind: 'proxy' };
  const deadline = Date.now() + timeout;
  let reachedAny = false; let lastReason = '';
  for (const svc of SERVICES) {
    const left = deadline - Date.now();
    if (left < 800) break;
    const start = Date.now();
    const r = await fetchVia(proxy, svc.url, Math.min(left, Math.max(4000, timeout / 2)));
    if (r.neterr) {
      lastReason = r.neterr;
      // refused / unreachable / bad auth on the first hop means the proxy is
      // bad; another service would only burn the time budget.
      if (!reachedAny && /407|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ECONNRESET|auth/i.test(r.neterr)) break;
      continue;
    }
    if (r.status === 407) { lastReason = 'proxy ต้องการรหัสผ่าน / รหัสผ่านไม่ถูกต้อง (407)'; break; }
    reachedAny = true;
    if (r.status !== 200) { lastReason = `lookup HTTP ${r.status}`; continue; }
    let info = null;
    try { info = svc.map(JSON.parse(r.body)); } catch (e) { info = null; }
    if (!info) { lastReason = 'bad-response'; continue; }
    return {
      ok: true, latency: Date.now() - start, ...info,
      flag: flagEmoji(info.countryCode), locale: localeForCountry(info.countryCode),
      testedAt: Date.now(), source: svc.url.split('/')[2],
    };
  }
  return { ok: false, reason: lastReason || 'timeout', kind: reachedAny ? 'lookup' : 'proxy' };
}

module.exports = { test, localeForCountry, flagEmoji };
