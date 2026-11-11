'use strict';
// Parse a proxy line in any common provider format:
//   host:port
//   host:port:user:pass            (pass may contain ':')
//   user:pass@host:port            scheme://user:pass@host:port
//   host:port@user:pass            user:pass:host:port
//   host port user pass            (spaces / tabs)
// Returns { scheme, host, port, username, password } or null.
(function (root) {
  const isPort = (s) => /^\d{1,5}$/.test(s) && +s > 0 && +s < 65536;
  const isHost = (s) => /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i.test(s) && !isPort(s);

  function parseProxy(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    s = s.split(/\r?\n/)[0].trim();
    let scheme = '';
    const m = s.match(/^(https?|socks5h?|socks4a?|socks):\/\//i);
    if (m) {
      scheme = m[1].toLowerCase();
      if (scheme === 'socks' || scheme === 'socks5h') scheme = 'socks5';
      if (scheme === 'socks4a') scheme = 'socks4';
      s = s.slice(m[0].length);
    }
    s = s.replace(/\/+$/, '');
    const dec = (x) => { try { return decodeURIComponent(x); } catch (e) { return x; } };
    const out = (host, port, username = '', password = '') => (isHost(host) && isPort(port)
      ? { scheme, host, port: String(+port), username: dec(username), password: dec(password) } : null);

    // ...@...
    const at = s.lastIndexOf('@');
    if (at > 0) {
      const left = s.slice(0, at), right = s.slice(at + 1);
      const r = right.split(':'), l = left.split(':');
      if (r.length === 2 && isPort(r[1])) return out(r[0], r[1], l[0], l.slice(1).join(':')); // user:pass@host:port
      if (l.length === 2 && isPort(l[1])) return out(l[0], l[1], r[0], r.slice(1).join(':')); // host:port@user:pass
      return null;
    }
    const p = /\s/.test(s) ? s.split(/\s+/) : s.split(':');
    if (p.length === 2) return out(p[0], p[1]);
    if (p.length >= 4) {
      if (isHost(p[0]) && isPort(p[1])) return out(p[0], p[1], p[2], p.slice(3).join(':')); // host:port:user:pass
      const n = p.length;
      if (isPort(p[n - 1]) && isHost(p[n - 2])) return out(p[n - 2], p[n - 1], p[0], p.slice(1, n - 2).join(':')); // user:pass:host:port
    }
    return null;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = parseProxy;
  else root.parseProxy = parseProxy;
})(this);
