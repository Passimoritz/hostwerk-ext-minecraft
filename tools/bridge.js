#!/usr/bin/env node
'use strict';
/*
 * HostwerkBridge bauen und einchecken in einem Schritt:
 *   node tools/bridge.js           Maven baut server/bridge (target/HostwerkBridge.jar), die JAR wird geprüft
 *                                  (plugin.yml mit Version aus pom.xml, Hauptklasse für Java 17, Symbol) und nach
 *                                  server/bridge/HostwerkBridge.jar gelegt – die Datei, die Hostwerk in die Server legt.
 *   node tools/bridge.js --check   nur prüfen, ob die eingecheckte JAR zu den Quellen passt (baut in target/, kopiert nicht)
 *
 * Braucht Java 17+ und Maven (mvn) im PATH. Die JAR ist reproduzierbar (siehe pom.xml): ändern sich die Quellen nicht,
 * bleibt sie byteweise gleich – git zeigt dann keine Änderung.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'server', 'bridge');
const BUILT = path.join(DIR, 'target', 'HostwerkBridge.jar');
const DEST = path.join(DIR, 'HostwerkBridge.jar');
const MAIN = 'de/passimoritz/hostwerk/bridge/HostwerkBridge.class';

/** Einträge einer JAR (ZIP): Name → () => Inhalt. Liest nur das Inhaltsverzeichnis am Ende und auf Abruf die Dateien. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`${path.basename(file)} ist keine ZIP-Datei`);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Version aus pom.xml (die des Projekts, nicht die einer Abhängigkeit). */
function pomVersion() {
  const pom = fs.readFileSync(path.join(DIR, 'pom.xml'), 'utf8');
  const v = (pom.match(/<artifactId>hostwerk-bridge<\/artifactId>\s*<version>([^<]+)<\/version>/) || [])[1];
  if (!v) throw new Error('Version in pom.xml nicht gefunden');
  return v;
}

/** Prüft eine gebaute JAR → { version, icon }; wirft bei einem Fehler. */
function verify(file, version = pomVersion()) {
  const zip = readZip(file);
  if (!zip.has('plugin.yml')) throw new Error('plugin.yml fehlt in der JAR');
  const yml = zip.get('plugin.yml')().toString('utf8');
  const got = (yml.match(/^version:\s*'?([^'\r\n]+)'?/m) || [])[1];
  if (got !== version) throw new Error(`plugin.yml hat Version ${got}, pom.xml ${version}`);
  if (!zip.has(MAIN)) throw new Error(`${MAIN} fehlt in der JAR`);
  // Klassenversion 61 = Java 17 – höher, und Server mit Java 17 (1.18–1.20.4) laden die Bridge nicht mehr
  const major = zip.get(MAIN)().readUInt16BE(6);
  if (major > 61) throw new Error(`Hauptklasse für Java ${major - 44} gebaut, erwartet Java 17`);
  const icon = (yml.match(/^hostwerk-icon:\s*(\S+)/m) || [])[1];
  if (!icon || !zip.has(icon)) throw new Error(`Symbol (hostwerk-icon: ${icon}) fehlt in der JAR`);
  return { version: got, icon };
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function build() {
  // Über die Shell, damit unter Windows mvn.cmd gefunden wird (feste Befehlszeile, keine Eingaben von außen)
  const r = spawnSync('mvn -q -B clean package', { cwd: DIR, stdio: 'inherit', shell: true });
  if (r.error) throw new Error(`Maven nicht gefunden (${r.error.message}) – mvn muss im PATH liegen`);
  if (r.status !== 0) throw new Error(`Maven-Build fehlgeschlagen (Exit ${r.status})`);
  return verify(BUILT);
}

function main() {
  const { version } = build();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(DEST) || sha(DEST) !== sha(BUILT)) throw new Error('server/bridge/HostwerkBridge.jar passt nicht zu den Quellen – node tools/bridge.js ausführen');
    console.log(`✓ HostwerkBridge ${version}: eingecheckte JAR ist aktuell`);
    return;
  }
  const before = fs.existsSync(DEST) ? sha(DEST) : null;
  fs.copyFileSync(BUILT, DEST);
  const after = sha(DEST);
  console.log(`✓ HostwerkBridge ${version} → server/bridge/HostwerkBridge.jar (${fs.statSync(DEST).size} Bytes, sha256 ${after.slice(0, 12)}…)${before === after ? ' – unverändert' : ''}`);
}

module.exports = { readZip, verify, pomVersion };

if (require.main === module) {
  try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}
