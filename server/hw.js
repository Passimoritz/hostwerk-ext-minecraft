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

/** Kernbaustein laden, z. B. core('jobs') → { runJob }. */
exports.core = (name) => {
  if (host) return host.core(name);
  if (coreDir) return require(require('path').join(coreDir, name));
  throw new Error(`Hostwerk-Kernbaustein „${name}“: Erweiterung nicht aktiviert`);
};
