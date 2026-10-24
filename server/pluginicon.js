'use strict';
/*
 * Symbol eines Plugins/Mods direkt aus der JAR lesen – so zeigt Hostwerk auch Plugins ohne Marktplatz (eigene JARs)
 * mit ihrem eigenen Bild an. Reihenfolge:
 *   1. plugin.yml / paper-plugin.yml / bungee.yml: Schlüssel „hostwerk-icon: pfad/im/jar.png“
 *   2. Datei hostwerk-icon.svg | .png | .webp im Wurzelverzeichnis der JAR
 *   3. Mods: fabric.mod.json „icon“, (neoforge.)mods.toml „logoFile“
 *   4. icon.png / logo.png im Wurzelverzeichnis
 * Erlaubt: PNG, SVG, WEBP, JPG bis 512 KB (SVG wird beim Ausliefern per CSP abgeschottet).
 * Anleitung für Plugin-Entwickler: README („Eigenes Plugin-Symbol“).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yauzl = require('./hw').lib('yauzl');
const T = (text, vars) => require('./hw').t(text, vars); // Text in der Sprache der Oberfläche (Deutsch aus locales/de.json)

const MAX = 512 * 1024;
const TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const META = ['plugin.yml', 'paper-plugin.yml', 'bungee.yml', 'fabric.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml'];
const known = new Map(); // jar|mtime|size -> Eintragsname oder null

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => {
    if (err) return reject(err);
    const parts = []; let n = 0;
    s.on('data', (c) => { n += c.length; if (n > MAX) { s.destroy(); reject(new Error(T('too large'))); } else parts.push(c); });
    s.on('end', () => resolve(Buffer.concat(parts)));
    s.on('error', reject);
  }));
}

/** Alle Einträge einmal lesen → { entries: Map(name → entry), zip } */
function openJar(file) {
  return new Promise((resolve) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
    if (err) return resolve(null);
    const entries = new Map();
    zip.on('entry', (e) => { entries.set(e.fileName, e); zip.readEntry(); });
    zip.on('end', () => resolve({ zip, entries }));
    zip.on('error', () => resolve(null));
    zip.readEntry();
  }));
}

async function findIconEntry(file) {
  const jar = await openJar(file);
  if (!jar) return null;
  const { zip, entries } = jar;
  try {
    const ok = (n) => n && entries.has(n.replace(/^\/+/, '')) && TYPES[path.extname(n).toLowerCase()] && entries.get(n.replace(/^\/+/, '')).uncompressedSize <= MAX ? n.replace(/^\/+/, '') : null;
    for (const m of META) {
      if (!entries.has(m)) continue;
      const txt = (await readEntry(zip, entries.get(m))).toString('utf8');
      const explicit = (txt.match(/^\s*hostwerk-icon\s*:\s*["']?([^"'\r\n#]+)/m) || [])[1];
      if (ok(explicit && explicit.trim())) return ok(explicit.trim());
      if (m === 'fabric.mod.json') { try { const j = JSON.parse(txt.replace(/^﻿/, '')); const ic = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop(); if (ok(ic)) return ok(ic); } catch { /* egal */ } }
      if (/mods\.toml$/.test(m)) { const lf = (txt.match(/^\s*logoFile\s*=\s*["']([^"']+)["']/m) || [])[1]; if (ok(lf)) return ok(lf); }
    }
    for (const n of ['hostwerk-icon.svg', 'hostwerk-icon.png', 'hostwerk-icon.webp', 'icon.png', 'logo.png']) if (ok(n)) return n;
    return null;
  } catch { return null; } finally { try { zip.close(); } catch { /* egal */ } }
}

/** Hat die JAR ein Symbol? (zwischengespeichert nach Datum + Größe) */
async function iconEntry(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  const key = `${file}|${st.mtimeMs}|${st.size}`;
  if (!known.has(key)) known.set(key, await findIconEntry(file));
  return known.get(key);
}

/** Symbol als Datei im Cache bereitstellen → { file, type } oder null */
async function iconFile(jar, cacheDir) {
  const entry = await iconEntry(jar);
  if (!entry) return null;
  const st = fs.statSync(jar);
  const ext = path.extname(entry).toLowerCase();
  const out = path.join(cacheDir, 'plugin-icons', crypto.createHash('sha1').update(`${jar}|${st.mtimeMs}|${st.size}|${entry}`).digest('hex') + ext);
  if (!fs.existsSync(out)) {
    const j = await openJar(jar);
    if (!j) return null;
    try { const buf = await readEntry(j.zip, j.entries.get(entry)); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf); } finally { try { j.zip.close(); } catch { /* egal */ } }
  }
  return { file: out, type: TYPES[ext] };
}

module.exports = { iconEntry, iconFile, TYPES };
