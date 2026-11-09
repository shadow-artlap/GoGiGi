'use strict';

// Profile groups (folders). Stored as userData/groups.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let FILE = '';

function init(userData) {
  FILE = path.join(userData, 'groups.json');
}
function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function list() { return read(); }

function create(name) {
  const items = read();
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, reason: 'empty-name' };
  if (items.some((g) => g.name.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: 'duplicate' };
  }
  const g = { id: crypto.randomBytes(5).toString('hex'), name: clean, createdAt: Date.now() };
  items.push(g);
  write(items);
  return { ok: true, group: g };
}

function rename(id, name) {
  const items = read();
  const g = items.find((x) => x.id === id);
  if (!g) return { ok: false, reason: 'not-found' };
  g.name = String(name || '').trim() || g.name;
  write(items);
  return { ok: true, group: g };
}

function remove(id) {
  write(read().filter((x) => x.id !== id));
  return { ok: true };
}

module.exports = { init, list, create, rename, remove };
