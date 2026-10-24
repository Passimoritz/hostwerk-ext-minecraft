'use strict';
/*
 * Brücke zu Hostwerks Kernbausteinen (server/core/*). Früher lag der Minecraft-Teil im Kern und holte sie mit
 * require('../core/…'); als Erweiterung kommen sie über host.core(name). activate() setzt den host, bevor die übrigen
 * Module geladen werden. Tests setzen stattdessen einen Ordner (setCoreDir), aus dem die Bausteine direkt kommen.
 */
let host = null;
let coreDir = null;

exports.init = (h) => { host = h; };
exports.setCoreDir = (dir) => { coreDir = dir; };
exports.host = () => host;

/**
 * Mitgelieferte Bibliothek von Hostwerk (yauzl, yaml …) – liegt nicht neben der Erweiterung, darum über host.lib bzw. in
 * Tests aus Hostwerks node_modules (neben dem Kernordner).
 */
exports.lib = (name) => {
  if (host) return host.lib(name);
  if (coreDir) return require(require.resolve(name, { paths: [coreDir] }));
  return require(name);
};

/**
 * Text in der Sprache der Oberfläche: t('Server “{name}” created', { name }) – Quelltext Englisch, Deutsch aus
 * locales/de.json (wie bei allen Erweiterungen über host.t). Ohne host (Tests) gilt Deutsch, Hostwerks Standardsprache.
 */
let de = null;
const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : String(s));
exports.t = (text, vars) => {
  if (host) return host.t(text, vars);
  if (!de) { try { de = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'locales', 'de.json'), 'utf8')); } catch { de = {}; } }
  const m = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
  return fill(typeof de[m[2]] === 'string' ? m[1] + de[m[2]] + m[3] : text, vars);
};

/** Kernbaustein laden, z. B. core('jobs') → { runJob }. */
exports.core = (name) => {
  if (host) return host.core(name);
  if (coreDir) return require(require('path').join(coreDir, name));
  throw new Error(`Hostwerk core module “${name}”: extension not activated`);
};
