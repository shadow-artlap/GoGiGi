'use strict';

// Proxy tester: routes a request through the given proxy to an IP geolocation
// service and returns the exit IP, country, timezone and coordinates — used to
// verify a proxy and to auto-match the profile fingerprint to it.

const http = require('http');
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

function agentFor(proxy) {
  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : '';
  const scheme = proxy.scheme || 'http';
  const url = `${scheme}://${auth}${proxy.host}:${proxy.port}`;
  if (scheme.startsWith('socks')) return new SocksProxyAgent(url);
  if (scheme === 'https') return new HttpsProxyAgent(url);
  return new HttpProxyAgent(url);
}

const API = 'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,timezone,lat,lon,isp,query';

function test(proxy, timeout = 12000) {
  return new Promise((resolve) => {
    if (!proxy || !proxy.host || !proxy.port) return resolve({ ok: false, reason: 'no-proxy' });
    let agent;
    try { agent = agentFor(proxy); } catch (e) { return resolve({ ok: false, reason: String((e && e.message) || e) }); }
    const start = Date.now();
    let req;
    let done = false;
    const realResolve = resolve;
    const finish = (r) => { if (done) return; done = true; clearTimeout(guard); try { req && req.destroy(); } catch (e) {} realResolve(r); };
    // Hard overall timeout — proxy agents don't always honor the socket timeout
    // during the CONNECT phase, so guard against a dead proxy hanging.
    const guard = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeout);
    resolve = finish;
    try {
      req = http.get(API, { agent, timeout }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.status !== 'success') return resolve({ ok: false, reason: j.message || 'lookup-failed' });
            resolve({
              ok: true, latency: Date.now() - start,
              ip: j.query, country: j.country, countryCode: j.countryCode,
              city: j.city, region: j.regionName, timezone: j.timezone,
              lat: j.lat, lon: j.lon, isp: j.isp,
              flag: flagEmoji(j.countryCode), locale: localeForCountry(j.countryCode),
              testedAt: Date.now(),
            });
          } catch (e) { resolve({ ok: false, reason: 'bad-response' }); }
        });
      });
    } catch (e) { return resolve({ ok: false, reason: String((e && e.message) || e) }); }
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, reason: String((e && e.message) || e) }));
  });
}

module.exports = { test, localeForCountry, flagEmoji };
