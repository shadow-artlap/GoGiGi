'use strict';

// Deterministic per-profile fingerprint generator. The same profile id always
// yields the same realistic fingerprint, but different profiles differ — so two
// profiles behind the same proxy still look like different devices.

const SCREENS = [[1920, 1080], [1536, 864], [1366, 768], [1440, 900], [1600, 900], [2560, 1440], [1280, 720], [1920, 1200]];
const CORES = [4, 6, 8, 12, 16];
const MEM = [4, 8, 16];
const WEBGL = [
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  { v: 'Google Inc. (Intel)', r: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
];
const CHROME = ['124.0.0.0', '125.0.0.0', '126.0.0.0', '127.0.0.0', '128.0.0.0', '129.0.0.0', '130.0.0.0', '131.0.0.0'];

function rngFromId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

function generate(id) {
  const rng = rngFromId(id);
  const [w, hgt] = pick(rng, SCREENS);
  const chrome = pick(rng, CHROME);
  const gl = pick(rng, WEBGL);
  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`,
    uaPlatform: 'Win32',
    vendor: 'Google Inc.',
    screen: { width: w, height: hgt },
    hardwareConcurrency: pick(rng, CORES),
    deviceMemory: pick(rng, MEM),
    webglVendor: gl.v,
    webglRenderer: gl.r,
    canvasNoise: true,
  };
}

// Effective fingerprint: generated base, overridden by any value the user set.
function effective(id, stored) {
  const g = generate(id);
  const s = stored || {};
  const nz = (a, b) => (a === undefined || a === null || a === '' ? b : a);
  return {
    webrtc: ['real', 'disabled', 'proxy-udp'].includes(s.webrtc) ? s.webrtc : 'proxy-udp',
    userAgent: nz(s.userAgent, g.userAgent),
    uaPlatform: nz(s.uaPlatform, g.uaPlatform),
    vendor: g.vendor,
    timezone: nz(s.timezone, ''),
    locale: nz(s.locale, ''),
    geo: s.geo || null,
    screen: s.screen && s.screen.width ? s.screen : g.screen,
    hardwareConcurrency: nz(s.hardwareConcurrency, g.hardwareConcurrency),
    deviceMemory: nz(s.deviceMemory, g.deviceMemory),
    webglVendor: nz(s.webglVendor, g.webglVendor),
    webglRenderer: nz(s.webglRenderer, g.webglRenderer),
    canvasNoise: s.canvasNoise !== false,
  };
}

module.exports = { generate, effective };
