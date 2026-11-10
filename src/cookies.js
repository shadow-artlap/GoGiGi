'use strict';

// Cookie import/export. Accepts the common export formats (Cookie-Editor /
// EditThisCookie JSON, puppeteer/CDP JSON, Netscape cookies.txt) and converts
// them to CDP cookies; exports in Cookie-Editor JSON, which most tools read.

const SAMESITE_IN = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
const SAMESITE_OUT = { None: 'no_restriction', Lax: 'lax', Strict: 'strict' };

function toCdp(c) {
  const out = {
    name: String(c.name),
    value: String(c.value == null ? '' : c.value),
    domain: c.domain || undefined,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
  };
  const exp = c.expirationDate != null ? c.expirationDate : c.expires;
  if (!c.session && exp != null && Number(exp) > 0) out.expires = Math.floor(Number(exp));
  const ss = c.sameSite ? SAMESITE_IN[String(c.sameSite).toLowerCase()] : undefined;
  if (ss) out.sameSite = ss;
  if (out.sameSite === 'None') out.secure = true; // Chrome rejects SameSite=None without Secure
  if (!out.domain && c.url) out.url = c.url;
  return out;
}

function fromCdp(c) {
  const persistent = c.expires != null && c.expires > 0;
  return {
    domain: c.domain,
    name: c.name,
    value: c.value,
    path: c.path,
    expirationDate: persistent ? c.expires : undefined,
    session: !persistent,
    hostOnly: !String(c.domain || '').startsWith('.'),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.sameSite ? (SAMESITE_OUT[c.sameSite] || 'unspecified') : 'unspecified',
  };
}

function parse(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : (Array.isArray(j.cookies) ? j.cookies : []);
    return arr.filter((c) => c && c.name).map(toCdp).filter((c) => c.domain || c.url);
  } catch (e) { /* not JSON — try Netscape cookies.txt */ }
  const out = [];
  for (const raw of t.split(/\r?\n/)) {
    let line = raw.trim();
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice(10); }
    else if (!line || line.startsWith('#')) continue;
    const p = line.split('\t');
    if (p.length < 7) continue;
    const exp = Number(p[4]);
    out.push({
      domain: p[0], path: p[2] || '/', secure: p[3] === 'TRUE', httpOnly,
      expires: exp > 0 ? exp : undefined, name: p[5], value: p[6],
    });
  }
  return out;
}

module.exports = { parse, toCdp, fromCdp };
