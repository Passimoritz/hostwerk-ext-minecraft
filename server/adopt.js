'use strict';
/*
 * Fremde Minecraft-Server in Hostwerk übernehmen (SDK 3.5, kind.adopt): Erkennung „java -jar <server>.jar“ in einem
 * Ordner mit server.properties, Anlegen am Ort oder als Kopie, Starttest. Ablauf, Stoppen des alten Programms,
 * Papierkorb und Zurückdrehen macht Hostwerk – hier steht nur, was Minecraft-spezifisch ist.
 */
const fs = require('fs');
const path = require('path');
const T = (text, vars) => require('./hw').t(text, vars);

const TYPES = { paper: 'Paper', purpur: 'Purpur', spigot: 'Spigot', folia: 'Folia', vanilla: 'Vanilla', custom: 'Minecraft' };
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const readProps = (file) => {
  const out = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = l.match(/^([\w.-]+)=(.*)$/); if (m) out[m[1]] = m[2]; } } catch { /* fehlt */ }
  return out;
};

/** Minecraft: java -jar <server>.jar in einem Ordner mit server.properties. h = { splitCmd, versionOf } von Hostwerk. */
async function detectMinecraft(p, byPid, h) {
  const args = p.args || h.splitCmd(p.cmd);
  const ji = args.findIndex((a) => a === '-jar');
  if (ji < 0 || !args[ji + 1]) return null;
  const jarArg = args[ji + 1];
  const cands = [];
  if (path.isAbsolute(jarArg)) cands.push(path.dirname(jarArg));
  if (p.cwd) cands.push(path.resolve(p.cwd, path.dirname(jarArg)));
  // Windows kennt das Arbeitsverzeichnis fremder Prozesse nicht – meist startet eine .bat im Serverordner
  for (let q = byPid.get(p.ppid), n = 0; q && n < 3; q = byPid.get(q.ppid), n++) {
    for (const a of h.splitCmd(q.cmd)) if (/\.(bat|cmd|sh)$/i.test(a)) cands.push(path.dirname(path.resolve(a)));
  }
  const dir = cands.find((d) => exists(path.join(d, 'server.properties')) && exists(path.join(d, path.basename(jarArg))));
  if (!dir) return null;
  const jar = path.basename(jarArg);
  const props = readProps(path.join(dir, 'server.properties'));
  const low = jar.toLowerCase();
  let type = /paper/.test(low) ? 'paper' : /purpur/.test(low) ? 'purpur' : /spigot/.test(low) ? 'spigot' : /folia/.test(low) ? 'folia' : /^(minecraft_)?server[\d.-]*\.jar$/.test(low) ? 'vanilla' : 'custom';
  let version = (jar.match(/(\d+\.\d+(?:\.\d+)?)/) || [])[1] || null;
  // „server.jar“ sagt nichts – Paper/Purpur/Folia schreiben version_history.json („git-Paper-181 (MC: 26.3)“)
  try {
    const vh = JSON.parse(fs.readFileSync(path.join(dir, 'version_history.json'), 'utf8'));
    const cur = String(vh.currentVersion || '');
    const m = cur.match(/\(MC: ([\d.]+)\)/) || cur.match(/^([\d.]+)/);
    if (m) version = m[1];
    if (/purpur/i.test(cur)) type = 'purpur'; else if (/folia/i.test(cur)) type = 'folia'; else if (/paper/i.test(cur)) type = 'paper'; else if (/spigot/i.test(cur)) type = 'spigot';
  } catch { /* keine Datei */ }
  if (type === 'vanilla' || type === 'custom') { try { const vs = fs.readdirSync(path.join(dir, 'versions')).filter((v) => /^\d+\.\d+/.test(v)); if (vs.length && !version) version = vs.sort().pop(); if (fs.existsSync(path.join(dir, 'config', 'paper-global.yml'))) type = 'paper'; } catch { /* egal */ } }
  const xmx = (args.find((a) => /^-Xmx\d+[mMgG]$/.test(a)) || '').match(/(\d+)([mMgG])/);
  const memMax = xmx ? Number(xmx[1]) * (/g/i.test(xmx[2]) ? 1024 : 1) : 4096;
  const jvm = args.slice(1, ji).filter((a) => !/^-Xm[sx]/.test(a));
  const javaVer = await h.versionOf(p.exe || args[0], ['-version'], /version "(\d+)(?:\.(\d+))?/);
  return { type, version, dir, jar, port: Number(props['server-port']) || 25565, memMax, extraArgs: jvm.join(' '), javaExe: p.exe, javaMajor: Number(javaVer) === 1 ? 8 : Number(javaVer) || null, motd: props.motd || null };
}

function minecraftAdopt(mc) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    label: { de: 'Minecraft', en: 'Minecraft' },
    note: { de: 'Läuft der Server gerade, wird er beendet – speichere vorher im Spiel mit /save-all oder stoppe ihn selbst mit /stop.', en: 'If the server is running, it will be stopped – save in-game with /save-all first or stop it yourself with /stop.' },
    target: 'minecraft',
    intro: { de: 'Minecraft-Server, die außerhalb von Hostwerk liegen (eigener Ordner, Startskript), übernehmen – mit Welt, Plugins und Einstellungen.', en: 'Take over Minecraft servers that live outside Hostwerk (own folder, start script) – with world, plugins and settings.' },
    types: TYPES,
    /** Läuft auch unter Linux als normales Programm (kein Systemdienst) */
    linux: true,
    /** Gefundener Port ist der aus server.properties – nicht den ersten offenen Port des Prozesses nehmen */
    keepPort: true,
    owned: () => mc.list().map((s) => s.externalDir).filter(Boolean),
    match: (name) => name === 'java' || name === 'javaw',
    detect: (p, byPid, h) => detectMinecraft(p, byPid, h),
    notes: (it) => (it.javaMajor ? [] : [T('Java version unknown – Hostwerk uses its own.')]),
    copies: (it) => [{ what: T('Server folder'), from: it.dir }],
    oldPaths: (it) => [it.dir],
    async create(it, mode, opts, { uniq, pickPort, copyTree, log, state }) {
      const id = uniq(mc.list(), String(opts.name || '').trim() || (it.motd ? it.motd.replace(/§./g, '').slice(0, 40) : `Minecraft (${path.basename(it.dir)})`));
      const port = await pickPort(it.port, mc.list().map((s) => s.port), log);
      const server = {
        id, name: String(opts.name || '').trim() || (it.motd ? it.motd.replace(/§./g, '').slice(0, 40) : `Minecraft (${path.basename(it.dir)})`),
        type: it.type, version: it.version, build: null, port, memMin: 1024, memMax: it.memMax || 4096,
        javaMajor: it.javaMajor || 21, javaPath: mode === 'link' && it.javaExe && exists(it.javaExe) ? it.javaExe : undefined,
        jvmFlags: 'eigene', extraArgs: it.extraArgs || '', autostart: false, autoRestart: true, jar: it.jar, createdAt: Date.now(),
        adopted: { from: it.source, at: Date.now(), mode },
      };
      if (mode === 'link') server.externalDir = it.dir;
      else {
        const dest = mc.paths.mcDir(id);
        state.copied.push(dest);
        await copyTree(it.dir, dest, {}, log);
        try { fs.rmSync(path.join(dest, 'world', 'session.lock'), { force: true }); } catch { /* egal */ }
      }
      mc.list().push(server);
      mc.settings.save();
      mc.proc(id);
      return id;
    },
    /** Nach dem Start: warten, bis der Server bereit ist (höchstens 5 Minuten) */
    async test(id, { log }) {
      const p = mc.proc(id);
      for (let i = 0; i < 300 && !p.extra.ready; i++) {
        if (!p.isRunning()) throw new Error(T('Test failed: the Minecraft server exited during start – details in the server log.'));
        await sleep(1000);
      }
      if (!p.extra.ready) throw new Error(T('Test failed: the Minecraft server is not ready after 5 minutes.'));
      log(T('Test: Minecraft server is ready.'));
    },
    /** Zurückdrehen: Eintrag wieder entfernen (Dateien räumt Hostwerk weg) */
    remove(id) {
      const list = mc.list();
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
      mc.settings.save();
      if (mc.procs) mc.procs.delete(id);
    },
  };
}

module.exports = { minecraftAdopt, detectMinecraft, TYPES };
