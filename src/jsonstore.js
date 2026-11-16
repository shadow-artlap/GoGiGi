'use strict';

// Crash-safe JSON files. A plain writeFileSync interrupted by a crash or power
// cut leaves a truncated file, which then reads as "empty" — e.g. every profile
// vanishing from the list. Here:
//   write: temp file -> flush to disk -> keep the previous good copy as .bak -> rename
//   read:  main file -> .bak -> fallback; a corrupt main file is set aside
//          (never silently replaced by an empty list).

const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  for (const f of [file, file + '.bak']) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { continue; } // missing
    try { return JSON.parse(raw); } catch (e) {
      if (f === file) { try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch (er) {} }
    }
  }
  return fallback;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // keep the last good version (only if it still parses)
  try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, file + '.bak'); } catch (e) { /* none yet / corrupt */ }
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson };
