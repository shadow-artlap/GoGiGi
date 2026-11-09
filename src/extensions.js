'use strict';

// Extension manager. Tracks unpacked extension folders the user adds, which
// profiles can then load via --load-extension. Stored as userData/extensions.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let FILE = '';
function init(userData) { FILE = path.join(userData, 'extensions.json'); }
function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } }
function write(l) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(l, null, 2)); }

function list() {
  return read().map((e) => ({ ...e, exists: fs.existsSync(e.path) }));
}
function add(dir) {
  if (!dir || !fs.existsSync(dir)) return { ok: false, reason: 'path-not-found' };
  const manifestPath = path.join(dir, 'manifest.json');
  let name = path.basename(dir);
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m.name) name = m.name;
  } catch { return { ok: false, reason: 'no-manifest (ต้องเป็นโฟลเดอร์ extension ที่แตกแล้ว)' }; }
  const items = read();
  if (items.some((e) => e.path === dir)) return { ok: false, reason: 'duplicate' };
  const ext = { id: crypto.randomBytes(5).toString('hex'), name, path: dir, addedAt: Date.now() };
  items.push(ext);
  write(items);
  return { ok: true, extension: ext };
}
function remove(id) { write(read().filter((e) => e.id !== id)); return { ok: true }; }
function resolvePaths(ids) {
  const byId = new Map(read().map((e) => [e.id, e.path]));
  return (ids || []).map((id) => byId.get(id)).filter((p) => p && fs.existsSync(p));
}

module.exports = { init, list, add, remove, resolvePaths };
