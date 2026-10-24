'use strict';
/*
 * Probelauf eines Minecraft-Servers auf einer KOPIE: Ordner in ein Temp-Verzeichnis kopieren (ohne Backups, Logs,
 * Cache), freien Port setzen, mit Java starten, bis „Done“ warten, Fehler und Plugin-Ladefehler sammeln, stoppen.
 * Genutzt von der Wiederherstellungs-Probe (Backup zurückgespielt → startet er?) und vom sicheren Versionssprung
 * (neue Version erst auf der Kopie testen, dann einspielen). Der echte Server wird nie angefasst.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { findFreePort } = require('./hw').core('ports');
const { providers, javaFor } = require('./providers');
const { killTree } = require('./hw').core('proc');
const T = (text, vars) => require('./hw').t(text, vars); // Text in der Sprache der Oberfläche (Deutsch aus locales/de.json)

const SKIP = new Set(['backups', 'logs', 'cache', 'crash-reports', 'session.lock', 'server.jar.alt', '.hostwerk-neu']);

function copyDir(src, dst, { skipWorlds = false } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    if (skipWorlds && e.isDirectory() && /^world/.test(e.name)) continue;
    const a = path.join(src, e.name); const b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b); else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

function dirBytes(dir) {
  let n = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) n += dirBytes(f); else if (e.isFile()) n += fs.statSync(f).size; } } catch { /* egal */ }
  return n;
}

/**
 * dir      Serverordner (Original oder entpacktes Backup)
 * s        Server-Einstellungen (type, version, jar, launch, memMax, javaMajor, extraArgs)
 * ctx      Hostwerk-Kontext (java-Service)
 * job      Aufgabe (Fortschritt/Protokoll)
 * opts     { copy: true (in Temp kopieren) | false (dir direkt nutzen), timeoutMs, keepWorlds, prepare(copyDir) }
 * → { ok, doneSec, errors[], failedPlugins[], lines (letzte), port, dir }
 */
async function trialRun(dir, s, ctx, job, { copy = true, timeoutMs = 4 * 60000, keepWorlds = true, prepare = null, tmpBase = null } = {}) {
  const work = copy ? path.join(tmpBase || ctx.paths.cache, `mc-probe-${s.id || 'x'}-${Date.now()}`) : dir;
  const log = (t) => job && job.log(t);
  if (copy) {
    const bytes = dirBytes(dir);
    const skipWorlds = !keepWorlds || bytes > 6 * 1024 ** 3;
    log(skipWorlds ? T('Creating copy ({mb} MB, worlds left out – too big, trial with a fresh world) …', { mb: (bytes / 1048576).toFixed(0) }) : T('Creating copy ({mb} MB) …', { mb: (bytes / 1048576).toFixed(0) }));
    copyDir(dir, work, { skipWorlds });
  }
  try {
    if (prepare) await prepare(work);
    const port = await findFreePort(25700);
    const props = path.join(work, 'server.properties');
    let text = fs.existsSync(props) ? fs.readFileSync(props, 'utf8') : '';
    const set = (k, v) => { text = /^\s*k\s*=/m.test(text) ? text : text; const re = new RegExp(`^${k}=.*$`, 'm'); text = re.test(text) ? text.replace(re, `${k}=${v}`) : text + `\n${k}=${v}`; };
    set('server-port', port); set('query.port', port); set('enable-rcon', 'false'); set('online-mode', 'false'); set('enable-query', 'false');
    fs.writeFileSync(props, text.trim() + '\n');
    fs.writeFileSync(path.join(work, 'eula.txt'), 'eula=true\n');
    // Bridge-Plugin und Live-Hooks in der Kopie nicht nötig
    try { for (const f of fs.readdirSync(path.join(work, 'plugins'))) if (/^HostwerkBridge\.jar/i.test(f)) fs.rmSync(path.join(work, 'plugins', f), { force: true }); } catch { /* keine Plugins */ }
    const major = s.javaMajor || (await javaFor(s.version, s.type));
    const javaExe = s.javaPath && fs.existsSync(s.javaPath) ? s.javaPath : await ctx.services.java.ensure(major, job, [5, 15]);
    const jar = path.join(work, s.jar || 'server.jar');
    const argsFile = s.launch && s.launch.argsFile ? s.launch.argsFile : null;
    const args = [`-Xmx${Math.max(1024, Math.min(s.memMax || 2048, 4096))}M`, ...(s.extraArgs ? String(s.extraArgs).split(/\s+/).filter(Boolean) : [])];
    if (argsFile) args.push('@' + argsFile, 'nogui'); else args.push('-jar', jar, 'nogui');
    if (!argsFile && !fs.existsSync(jar)) throw new Error(T('Server JAR missing in the copy: {file}', { file: jar }));
    log(T('Trial run on port {port} (Java {major}) …', { port, major }));
    const t0 = Date.now();
    const lines = [];
    const errors = [];
    const failed = [];
    let done = null;
    const child = spawn(javaExe, args, { cwd: work, windowsHide: true });
    let buf = '';
    const onData = (c) => {
      buf += c;
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      for (const raw of parts) {
        const l = raw.replace(/\x1b\[[0-9;]*m/g, '');
        lines.push(l); if (lines.length > 400) lines.shift();
        const m = l.match(/Done \(([\d.,]+)s\)!/); if (m) done = Number(m[1].replace(',', '.'));
        if (/\b(ERROR|SEVERE|FATAL)\b|Exception\b/.test(l) && !/^>/.test(l)) { if (errors.length < 40) errors.push(l.slice(0, 220)); }
        const f = l.match(/Could not load '?plugins[\\/]([^'\s]+)/i) || l.match(/Error occurred while enabling (\S+)/i) || l.match(/Could not load plugin '?([^'\s]+)/i) || l.match(/Mixin apply for mod (\S+) failed/i) || l.match(/Incompatible mods? found!?/i);
        if (f && !failed.includes(f[1] || 'mods')) failed.push(f[1] || 'mods');
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    let exited = null;
    child.on('exit', (code) => { exited = code; });
    while (!done && exited === null && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 1000));
    if (done) { try { child.stdin.write('stop\n'); } catch { /* egal */ } }
    for (let i = 0; i < 40 && exited === null; i++) await new Promise((r) => setTimeout(r, 500));
    if (exited === null) { try { killTree(child.pid); } catch { /* egal */ } }
    const ok = !!done && failed.length === 0 && (exited === null || exited === 0 || exited === 143 || done);
    const crashed = exited !== null && !done;
    return { ok: ok && !crashed, doneSec: done, crashed, timeout: !done && !crashed, errors, failedPlugins: failed, lines: lines.slice(-60), port, dir: work, seconds: Math.round((Date.now() - t0) / 1000), javaMajor: major };
  } finally {
    if (copy) { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* beim nächsten Aufräumen */ } }
  }
}

module.exports = { trialRun, copyDir, dirBytes, providers };
