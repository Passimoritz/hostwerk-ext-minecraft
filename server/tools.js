'use strict';
/*
 * Werkzeuge rund um einen Minecraft-Server, die nicht zum Starten/Stoppen gehören:
 *   Welt hochladen (ZIP oder Einzelspieler-Ordner, mit Sicherung) · Datapacks (Liste, an/aus, Modrinth, hochladen)
 *   Welt vorgenerieren (Chunky) · ältere Protokolle (logs/*.log.gz) · Absturzberichte (crash-reports/)
 *   Testkopie eines Servers · Whitelist/Ops/Banns auf andere Server übertragen · TPS-Verlauf
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const yauzl = require('./hw').lib('yauzl');
const { runJob } = require('./hw').core('jobs');
const { findFreePort } = require('./hw').core('ports');
const { unzipTo, slug, dirSize } = require('./hw').core('util');
const { fetchJson, downloadFile } = require('./hw').core('download');
const { copyDir } = require('./trial');

const MR = 'https://api.modrinth.com/v2';
const LOG_FILE = /^[\w.-]+\.log(\.gz)?$/;
const CRASH_FILE = /^[\w.-]+\.txt$/;
const MAX_LOG_BYTES = 30 * 1024 * 1024;
const TPS_KEEP = 240; // 2 Stunden bei einer Messung je 30 s

/** Eine Datei aus einem ZIP lesen (z. B. pack.mcmeta) – null, wenn es sie nicht gibt. */
function readZipEntry(file, name) {
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return resolve(null);
      let done = false;
      const finish = (v) => { if (done) return; done = true; try { zip.close(); } catch { /* egal */ } resolve(v); };
      zip.on('entry', (e) => {
        if (e.fileName.replace(/^\.\//, '') !== name) return zip.readEntry(); // manche Packer schreiben „./pack.mcmeta“
        zip.openReadStream(e, (e2, s) => {
          if (e2) return finish(null);
          const parts = [];
          s.on('data', (c) => parts.push(c));
          s.on('end', () => finish(Buffer.concat(parts).toString('utf8')));
          s.on('error', () => finish(null));
        });
      });
      zip.on('end', () => finish(null));
      zip.on('error', () => finish(null));
      zip.readEntry();
    });
  });
}
/** Beschreibung aus pack.mcmeta (Text oder Textbausteine). */
function packDescription(text) {
  try {
    const d = JSON.parse(String(text).replace(/^﻿/, '')).pack.description;
    const flat = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.map(flat).join('') : x && typeof x === 'object' ? (x.text || '') + (x.extra ? flat(x.extra) : '') : '');
    return flat(d).replace(/§./g, '').trim().slice(0, 200) || null;
  } catch { return null; }
}
/** Ordner mit level.dat in einem entpackten Upload finden (höchstens 3 Ebenen tief; Bedrock-Welten haben zusätzlich db/). */
function findWorldDir(root) {
  const queue = [[root, 0]];
  while (queue.length) {
    const [d, depth] = queue.shift();
    if (fs.existsSync(path.join(d, 'level.dat'))) return d;
    if (depth >= 3) continue;
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { /* egal */ }
    for (const e of list) if (e.isDirectory() && !/^(__MACOSX|\.)/.test(e.name)) queue.push([path.join(d, e.name), depth + 1]);
  }
  return null;
}

class McTools {
  constructor(mc) {
    this.mc = mc;
    this.tps = new Map(); // id -> [{ t, tps, mspt }]
    this.chunky = new Map(); // id -> letzter Stand der Vorgenerierung
  }
  stopped(id, what) {
    if (this.mc.proc(id).isRunning()) throw Object.assign(new Error(`Bitte den Server zuerst stoppen – ${what}.`), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'stop' } });
  }
  levelName(id) { return this.mc.properties(id)['level-name'] || 'world'; }

  /* ---------- Konsolenzeilen (Chunky-Fortschritt) ---------- */
  onLine(id, line) {
    let m = line.match(/Task (running|started|paused|stopped|cancell?ed|finished) for ([^\s.]+(?::[^\s.]+)?)\.?(?: Processed: (\d+) chunks \(([\d.]+)%\))?(?:, ETA: ([\d:]+))?(?:, Rate: ([\d.,]+) cps)?(?:.*?Total time: ([\d:]+))?/i);
    if (m && /chunky/i.test(line)) {
      const state = { running: 'running', started: 'running', paused: 'paused', stopped: 'paused', canceled: 'cancelled', cancelled: 'cancelled', finished: 'done' }[m[1].toLowerCase()];
      const prev = this.chunky.get(id) || {};
      this.chunky.set(id, { ...prev, state, world: m[2], chunks: m[3] ? Number(m[3]) : prev.chunks || 0, percent: m[4] ? Number(m[4]) : state === 'done' ? 100 : prev.percent || 0, eta: m[5] || null, rate: m[6] ? Number(m[6].replace(',', '.')) : prev.rate || null, total: m[7] || null, at: Date.now() });
      return;
    }
    m = line.match(/\[HW\] TPS ([\d.]+) ([\d.]+) ([\d.]+)(?: MSPT ([\d.]+))?/);
    if (m) this.addTps(id, Number(m[1]), m[4] ? Number(m[4]) : null);
  }

  /* ---------- TPS-Verlauf ---------- */
  addTps(id, tps, mspt = null) {
    if (!Number.isFinite(tps)) return;
    const list = this.tps.get(id) || [];
    list.push({ t: Date.now(), tps: Math.min(20, Math.round(tps * 100) / 100), mspt });
    if (list.length > TPS_KEEP) list.splice(0, list.length - TPS_KEEP);
    this.tps.set(id, list);
  }
  tpsHistory(id) { return this.tps.get(id) || []; }

  /* ---------- Welt hochladen ---------- */
  /**
   * src: { zip } (hochgeladene Datei) oder { dir } (Einzelspieler-Ordner auf diesem PC).
   * mode 'replace' ersetzt die Hauptwelt (mit Nether/End), 'new' legt sie daneben (optional als neue Hauptwelt).
   * Vorher gibt es immer eine Sicherung des ganzen Servers.
   */
  importWorld(id, src, { mode = 'new', name = '', makeMain = false } = {}) {
    const s = this.mc.get(id);
    if (this.mc.isProxy(s)) throw new Error('Ein Proxy hat keine Welt.');
    if (mode === 'replace' || makeMain) this.stopped(id, 'die Hauptwelt lässt sich nur bei gestopptem Server tauschen');
    if (src.dir && !(fs.existsSync(src.dir) && fs.statSync(src.dir).isDirectory())) throw new Error('Ordner nicht gefunden.');
    return runJob(`Welt in „${s.name}“ übernehmen`, async (job) => {
      const tmp = path.join(this.mc.paths.cache, `welt-import-${crypto.randomBytes(4).toString('hex')}`);
      try {
        let root = src.dir;
        if (src.zip) { job.progress(5, 'ZIP entpacken …'); await unzipTo(src.zip, tmp); root = tmp; }
        const world = findWorldDir(root);
        if (!world) throw new Error('Keine Minecraft-Welt gefunden (es fehlt die Datei level.dat).');
        if (fs.existsSync(path.join(world, 'db')) && !fs.existsSync(path.join(world, 'region'))) throw new Error('Das ist eine Bedrock-Welt – Java-Server können sie nicht laden.');
        job.progress(20, 'Sicherung des Servers anlegen …');
        await this.mc.backup(id, mode === 'replace' ? 'vor-welt-ersetzen' : 'vor-welt-import').promise;
        const dir = this.mc.dir(id);
        const level = this.levelName(id);
        let target = level;
        if (mode === 'replace') {
          job.progress(60, 'Alte Welt entfernen …');
          for (const d of [level, `${level}_nether`, `${level}_the_end`]) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
        } else {
          const base = slug(name || path.basename(world)) || 'welt';
          target = base;
          for (let i = 2; fs.existsSync(path.join(dir, target)); i++) target = `${base}-${i}`;
        }
        job.progress(70, 'Welt kopieren …');
        fs.cpSync(world, path.join(dir, target), { recursive: true });
        fs.rmSync(path.join(dir, target, 'session.lock'), { force: true });
        if (mode !== 'replace' && makeMain) this.mc.setProperties(id, { 'level-name': target });
        job.log(mode === 'replace' ? `Hauptwelt ersetzt (${target}). Nether und End entstehen beim Start aus der hochgeladenen Welt.` : `Welt „${target}“ angelegt${makeMain ? ' und als Hauptwelt eingestellt' : ''}.`);
        return { name: target, main: mode === 'replace' || makeMain };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (src.zip) fs.rmSync(src.zip, { force: true });
      }
    });
  }

  /* ---------- Datapacks ---------- */
  packDirs(id) {
    const w = path.join(this.mc.dir(id), this.levelName(id));
    return { on: path.join(w, 'datapacks'), off: path.join(w, 'datapacks.disabled'), world: w };
  }
  async datapacks(id) {
    const d = this.packDirs(id);
    const out = [];
    for (const [dir, enabled] of [[d.on, true], [d.off, false]]) {
      let list = [];
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        const full = path.join(dir, e.name);
        const zip = e.isFile() && /\.zip$/i.test(e.name);
        if (!zip && !(e.isDirectory() && fs.existsSync(path.join(full, 'pack.mcmeta')))) continue;
        const meta = zip ? await readZipEntry(full, 'pack.mcmeta') : (() => { try { return fs.readFileSync(path.join(full, 'pack.mcmeta'), 'utf8'); } catch { return null; } })();
        out.push({ name: e.name, enabled, kind: zip ? 'zip' : 'folder', size: zip ? fs.statSync(full).size : dirSize(full), description: packDescription(meta) });
      }
    }
    return { world: this.levelName(id), exists: fs.existsSync(d.world), running: this.mc.proc(id).isRunning(), packs: out.sort((a, b) => a.name.localeCompare(b.name)) };
  }
  packPath(id, name) {
    if (!/^[^\\/]+$/.test(String(name)) || name === '..' || name === '.') throw Object.assign(new Error('Ungültiger Name'), { status: 400 });
    const d = this.packDirs(id);
    for (const [dir, enabled] of [[d.on, true], [d.off, false]]) if (fs.existsSync(path.join(dir, name))) return { full: path.join(dir, name), enabled, d };
    throw Object.assign(new Error('Datapack nicht gefunden'), { status: 404 });
  }
  /** Läuft der Server, wirkt es sofort (datapack disable / minecraft:reload), sonst beim nächsten Start. */
  toggleDatapack(id, name, enabled) {
    const p = this.packPath(id, name);
    if (p.enabled === !!enabled) return { live: false };
    const to = path.join(enabled ? p.d.on : p.d.off, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const running = !!this.mc.proc(id).child;
    if (running && !enabled) this.mc.command(id, `datapack disable "file/${name}"`);
    fs.renameSync(p.full, to);
    if (running && enabled) this.mc.command(id, 'minecraft:reload');
    return { live: running };
  }
  removeDatapack(id, name) {
    const p = this.packPath(id, name);
    if (p.enabled && this.mc.proc(id).child) this.mc.command(id, `datapack disable "file/${name}"`);
    fs.rmSync(p.full, { recursive: true, force: true });
  }
  async addDatapack(id, file, name) {
    if (!/\.zip$/i.test(name)) throw new Error('Bitte ein Datapack als .zip hochladen.');
    if (!(await readZipEntry(file, 'pack.mcmeta'))) { fs.rmSync(file, { force: true }); throw new Error('Das ZIP ist kein Datapack (pack.mcmeta fehlt ganz oben).'); }
    const d = this.packDirs(id);
    if (!fs.existsSync(d.world)) { fs.rmSync(file, { force: true }); throw new Error('Noch keine Welt – starte den Server einmal, dann lassen sich Datapacks hinzufügen.'); }
    fs.mkdirSync(d.on, { recursive: true });
    const target = path.join(d.on, path.basename(name).replace(/[^\w.+-]/g, '_'));
    fs.copyFileSync(file, target); fs.rmSync(file, { force: true });
    if (this.mc.proc(id).child) this.mc.command(id, 'minecraft:reload');
    return { name: path.basename(target) };
  }
  async searchDatapacks(id, q = '') {
    const s = this.mc.get(id);
    const facets = [['project_type:datapack']];
    if (s.version && !['custom', 'velocity'].includes(s.type)) facets.push([`versions:${s.version}`]);
    const j = await fetchJson(`${MR}/search?limit=20&index=${q ? 'relevance' : 'downloads'}&query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}`);
    const installed = new Set((await this.datapacks(id)).packs.map((p) => p.name.toLowerCase()));
    return j.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url || null, downloads: h.downloads, author: h.author, url: `https://modrinth.com/datapack/${h.slug}`, installed: [...installed].some((n) => n.includes(h.slug.toLowerCase())) }));
  }
  installDatapack(id, projectId) {
    const s = this.mc.get(id);
    return runJob(`Datapack auf „${s.name}“ installieren`, async (job) => {
      const d = this.packDirs(id);
      if (!fs.existsSync(d.world)) throw new Error('Noch keine Welt – starte den Server einmal, dann lassen sich Datapacks hinzufügen.');
      const q = `loaders=${encodeURIComponent(JSON.stringify(['datapack']))}` + (s.version && !['custom', 'velocity'].includes(s.type) ? `&game_versions=${encodeURIComponent(JSON.stringify([s.version]))}` : '');
      const v = (await fetchJson(`${MR}/project/${encodeURIComponent(projectId)}/version?${q}`))[0];
      if (!v) throw new Error(`Keine passende Datapack-Version für Minecraft ${s.version} gefunden.`);
      const f = v.files.find((x) => x.primary && /\.zip$/i.test(x.filename)) || v.files.find((x) => /\.zip$/i.test(x.filename));
      if (!f) throw new Error('Diese Version hat keine ZIP-Datei.');
      fs.mkdirSync(d.on, { recursive: true });
      const target = path.join(d.on, path.basename(f.filename));
      await downloadFile(f.url, target, { sha1: f.hashes && f.hashes.sha1, onProgress: (r, t) => job.progress(t ? (r / t) * 100 : 50, `${f.filename} herunterladen`) });
      if (this.mc.proc(id).child) this.mc.command(id, 'minecraft:reload');
      job.log(`${v.name} (${v.version_number})`);
      return { name: path.basename(target) };
    }, { key: `mc-datapack-${id}-${projectId}` });
  }

  /* ---------- Welt vorgenerieren (Chunky) ---------- */
  chunkyJar(id) {
    const d = this.mc.addonDir(id);
    try { return fs.readdirSync(d).find((f) => /^chunky(?!border)[\w.+-]*\.jar$/i.test(f)) || null; } catch { return null; }
  }
  pregenStatus(id) {
    const s = this.mc.get(id);
    const p = this.mc.proc(id);
    const supported = !this.mc.isProxy(s) && (s.type !== 'vanilla' && s.type !== 'custom');
    return { supported, installed: !!this.chunkyJar(id), jar: this.chunkyJar(id), running: !!p.child, ready: !!p.extra.ready, task: this.chunky.get(id) || null, mods: this.mc.content(s) === 'mods' };
  }
  installChunky(id) {
    const st = this.pregenStatus(id);
    if (!st.supported) throw new Error('Dieser Servertyp kann keine Plugins oder Mods laden – Chunky geht erst mit Paper, Purpur, Fabric oder NeoForge.');
    return this.mc.modrinthInstall(id, 'chunky');
  }
  /** Vorgenerierung starten: Welt (overworld/nether/end), Radius in Blöcken, Mitte = Weltspawn. */
  startPregen(id, { world = 'overworld', radius = 2000, shape = 'square' } = {}) {
    const st = this.pregenStatus(id);
    if (!st.installed) throw new Error('Chunky ist noch nicht installiert.');
    if (!st.running || !st.ready) throw Object.assign(new Error('Der Server muss laufen, damit Chunky arbeiten kann.'), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'start' } });
    const r = Math.max(100, Math.min(50000, Math.round(Number(radius) || 2000)));
    const level = this.levelName(id);
    const name = st.mods ? { overworld: 'minecraft:overworld', nether: 'minecraft:the_nether', end: 'minecraft:the_end' }[world] : { overworld: level, nether: `${level}_nether`, end: `${level}_the_end` }[world];
    if (!name) throw new Error('Unbekannte Welt.');
    for (const c of [`chunky world ${name}`, 'chunky spawn', `chunky shape ${shape === 'circle' ? 'circle' : 'square'}`, `chunky radius ${r}`, 'chunky start']) this.mc.command(id, c);
    // Läuft schon eine Aufgabe für diese Welt, fragt Chunky nach – bestätigen
    setTimeout(() => { try { this.mc.command(id, 'chunky confirm'); } catch { /* Server weg */ } }, 1500);
    this.chunky.set(id, { state: 'running', world: name, chunks: 0, percent: 0, radius: r, at: Date.now() });
    return this.pregenStatus(id);
  }
  pregenAction(id, action) {
    if (!['pause', 'continue', 'cancel'].includes(action)) throw new Error('Unbekannte Aktion.');
    this.mc.command(id, `chunky ${action}`);
    if (action === 'cancel') setTimeout(() => { try { this.mc.command(id, 'chunky confirm'); } catch { /* Server weg */ } }, 800);
    const t = this.chunky.get(id);
    if (t) t.state = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'running';
    return this.pregenStatus(id);
  }

  /* ---------- Ältere Protokolle ---------- */
  logFiles(id) {
    const d = path.join(this.mc.dir(id), 'logs');
    let list = [];
    try { list = fs.readdirSync(d).filter((f) => LOG_FILE.test(f)); } catch { return []; }
    return list.map((f) => { const st = fs.statSync(path.join(d, f)); return { file: f, size: st.size, time: st.mtimeMs, packed: /\.gz$/.test(f), current: f === 'latest.log' }; }).sort((a, b) => b.time - a.time);
  }
  /** Eine Protokolldatei lesen (gz wird entpackt), optional gefiltert nach Text oder nur Warnungen/Fehler. */
  readLog(id, file, { q = '', level = '' } = {}) {
    if (!LOG_FILE.test(String(file))) throw Object.assign(new Error('Ungültiger Dateiname'), { status: 400 });
    const f = path.join(this.mc.dir(id), 'logs', file);
    if (!fs.existsSync(f)) throw Object.assign(new Error('Protokoll nicht gefunden'), { status: 404 });
    let buf = fs.readFileSync(f);
    if (/\.gz$/.test(file)) buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_LOG_BYTES });
    let lines = buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
    const total = lines.length;
    const needle = String(q || '').toLowerCase();
    if (needle) lines = lines.filter((l) => l.toLowerCase().includes(needle));
    if (level === 'warn') lines = lines.filter((l) => /\b(WARN|ERROR|SEVERE|FATAL)\b|Exception/.test(l));
    else if (level === 'error') lines = lines.filter((l) => /\b(ERROR|SEVERE|FATAL)\b|Exception/.test(l));
    const truncated = lines.length > 5000;
    return { file, total, matches: lines.length, truncated, lines: truncated ? lines.slice(-5000) : lines };
  }

  /* ---------- Absturzberichte ---------- */
  crashSummary(text) {
    const desc = (text.match(/^Description:\s*(.+)$/m) || [])[1] || null;
    const ex = (text.match(/^([\w.$]+(?:Exception|Error)[^\r\n]*)$/m) || [])[1] || null;
    return { description: desc, exception: ex ? ex.slice(0, 240) : null };
  }
  crashReports(id) {
    const d = path.join(this.mc.dir(id), 'crash-reports');
    let list = [];
    try { list = fs.readdirSync(d).filter((f) => CRASH_FILE.test(f)); } catch { return []; }
    return list.map((f) => {
      const full = path.join(d, f);
      const st = fs.statSync(full);
      let head = '';
      try { const fd = fs.openSync(full, 'r'); const b = Buffer.alloc(16384); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); head = b.toString('utf8', 0, n); } catch { /* egal */ }
      return { file: f, size: st.size, time: st.mtimeMs, ...this.crashSummary(head) };
    }).sort((a, b) => b.time - a.time);
  }
  crashReport(id, file) {
    if (!CRASH_FILE.test(String(file))) throw Object.assign(new Error('Ungültiger Dateiname'), { status: 400 });
    const f = path.join(this.mc.dir(id), 'crash-reports', file);
    if (!fs.existsSync(f)) throw Object.assign(new Error('Absturzbericht nicht gefunden'), { status: 404 });
    const text = fs.readFileSync(f, 'utf8').slice(0, 1024 * 1024);
    return { file, text, ...this.crashSummary(text) };
  }
  /** Nach einem Absturz: neuen Absturzbericht (seit dem Start) dem Vorfall anhängen. */
  attachCrash(id, since) {
    const r = this.crashReports(id).find((x) => x.time >= since - 2000);
    if (!r) return null;
    const full = this.crashReport(id, r.file);
    const { annotateIncident } = require('./hw').core('incidents');
    annotateIncident(`mc:${id}`, { crash: { server: id, file: r.file, description: full.description, exception: full.exception, excerpt: full.text.split(/\r?\n/).slice(0, 60).join('\n') } });
    return r;
  }

  /* ---------- Testkopie ---------- */
  copyServer(id, { name = '', worlds = true } = {}) {
    const s = this.mc.get(id);
    if (this.mc.isBedrock && this.mc.isBedrock(s)) throw new Error('Testkopien gibt es (noch) nur für Java-Server – sichere den Bedrock-Server stattdessen unter „Backups“.');
    const label = String(name || '').trim() || `${s.name} (Test)`;
    return runJob(`Testkopie von „${s.name}“`, async (job) => {
      let nid = slug(label) || `${s.id}-test`;
      while (this.mc.list().some((x) => x.id === nid) || fs.existsSync(this.mc.paths.mcDir(nid))) nid = `${slug(label)}-${crypto.randomBytes(2).toString('hex')}`;
      const used = this.mc.list().map((x) => x.port);
      const port = await findFreePort(s.port + 1, used);
      const src = this.mc.dir(id);
      const dst = this.mc.paths.mcDir(nid);
      // Bei laufendem Server erst alles auf die Platte schreiben lassen
      if (this.mc.proc(id).child && !this.mc.isProxy(s)) { this.mc.command(id, 'save-all flush'); await new Promise((r) => setTimeout(r, 2500)); }
      job.progress(10, 'Dateien kopieren …');
      try {
        copyDir(src, dst, { skipWorlds: !worlds });
        // Hostwerk-Eigenes nicht mitnehmen (Warteschlange, Quellen-Verknüpfungen bleiben)
        fs.rmSync(path.join(dst, 'plugins', '.hostwerk', 'incoming'), { recursive: true, force: true });
        const copy = JSON.parse(JSON.stringify(s));
        for (const k of ['externalDir', 'liveUpdate', 'network', 'updates', 'modpackUpdate']) delete copy[k];
        Object.assign(copy, { id: nid, name: label, port, autostart: false, autoRestart: false, createdAt: Date.now(), copyOf: id, nightlyBackup: { ...(s.nightlyBackup || {}), enabled: false } });
        if (!this.mc.isProxy(s) && fs.existsSync(path.join(dst, 'server.properties'))) this.mc.setPropertiesAt(dst, { 'server-port': port, 'query.port': port, 'rcon.port': port + 10, motd: `${label} – Testkopie` });
        this.mc.list().push(copy);
        this.mc.settings.save();
        this.mc.proc(nid);
        job.log(`Kopie „${label}“ auf Port ${port}${worlds ? '' : ' (ohne Welten – entstehen beim ersten Start neu)'}.`);
        return { id: nid, port };
      } catch (e) { fs.rmSync(dst, { recursive: true, force: true }); throw e; }
    });
  }

  /* ---------- Spielerlisten übertragen ---------- */
  /** Ziele: Liste von Server-IDs oder 'network' (alle Server, die mit diesem am selben Proxy hängen). */
  targetsOf(id, targets) {
    const s = this.mc.get(id);
    if (targets === 'network') {
      const proxy = this.mc.isProxy(s) ? s.id : s.network && s.network.proxy;
      if (!proxy) throw new Error('Dieser Server gehört zu keinem Netzwerk.');
      return this.mc.list().filter((x) => x.id !== id && !this.mc.isProxy(x) && x.network && x.network.proxy === proxy).map((x) => x.id);
    }
    return [].concat(targets || []).filter((t) => t !== id && this.mc.list().some((x) => x.id === t));
  }
  transferPlayers(id, { targets, lists = ['whitelist', 'ops'], mode = 'merge' } = {}) {
    const FILES = { whitelist: 'whitelist.json', ops: 'ops.json', banned: 'banned-players.json', bannedIps: 'banned-ips.json' };
    const ids = this.targetsOf(id, targets);
    if (!ids.length) throw new Error('Bitte mindestens einen anderen Server wählen.');
    const want = lists.filter((l) => FILES[l]);
    if (!want.length) throw new Error('Bitte mindestens eine Liste wählen.');
    const read = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return []; } };
    const key = (e) => String(e.uuid || e.name || e.ip || '').toLowerCase();
    const src = this.mc.dir(id);
    const out = [];
    for (const tid of ids) {
      const t = this.mc.get(tid);
      if (this.mc.isProxy(t)) continue;
      const dir = this.mc.dir(tid);
      const running = !!this.mc.proc(tid).child;
      const res = { id: tid, name: t.name, added: 0, removed: 0, live: running };
      for (const l of want) {
        const from = read(src, FILES[l]);
        const cur = read(dir, FILES[l]);
        const have = new Map(cur.map((e) => [key(e), e]));
        const add = from.filter((e) => !have.has(key(e)));
        const drop = mode === 'replace' ? cur.filter((e) => !from.some((x) => key(x) === key(e))) : [];
        res.added += add.length; res.removed += drop.length;
        if (!add.length && !drop.length) continue;
        const next = mode === 'replace' ? from : [...cur, ...add];
        if (running && l !== 'whitelist') {
          // Laufende Server lesen ops/bans nicht neu ein – dort per Befehl, damit nichts beim Speichern überschrieben wird
          const cmd = { ops: ['op', 'deop'], banned: ['ban', 'pardon'], bannedIps: ['ban-ip', 'pardon-ip'] }[l];
          for (const e of add) this.mc.command(tid, `${cmd[0]} ${l === 'bannedIps' ? e.ip : e.name}`);
          for (const e of drop) this.mc.command(tid, `${cmd[1]} ${l === 'bannedIps' ? e.ip : e.name}`);
        } else {
          fs.writeFileSync(path.join(dir, FILES[l]), JSON.stringify(next, null, 2));
          if (running) this.mc.command(tid, 'whitelist reload');
        }
      }
      out.push(res);
    }
    return { results: out };
  }

  routes(r, upload) {
    r.get('/mc/servers/:id/tps', (req, res) => { this.mc.get(req.params.id); res.json(this.tpsHistory(req.params.id)); });
    r.post('/mc/servers/:id/worlds/upload', upload.single('file'), (req, res) => {
      if (!req.file || !/\.zip$/i.test(req.file.originalname)) { if (req.file) fs.rmSync(req.file.path, { force: true }); throw new Error('Bitte die Welt als .zip hochladen.'); }
      const b = req.body || {};
      res.json({ job: this.importWorld(req.params.id, { zip: req.file.path }, { mode: b.mode === 'replace' ? 'replace' : 'new', name: b.name, makeMain: b.makeMain === 'true' || b.makeMain === true }).id });
    });
    r.post('/mc/servers/:id/worlds/import', (req, res) => {
      const b = req.body || {};
      res.json({ job: this.importWorld(req.params.id, { dir: String(b.path || '') }, { mode: b.mode === 'replace' ? 'replace' : 'new', name: b.name, makeMain: !!b.makeMain }).id });
    });
    r.get('/mc/servers/:id/datapacks', async (req, res) => res.json(await this.datapacks(req.params.id)));
    r.put('/mc/servers/:id/datapacks/:name', (req, res) => res.json(this.toggleDatapack(req.params.id, req.params.name, !!(req.body || {}).enabled)));
    r.delete('/mc/servers/:id/datapacks/:name', (req, res) => { this.removeDatapack(req.params.id, req.params.name); res.json({ ok: true }); });
    r.post('/mc/servers/:id/datapacks/upload', upload.single('file'), async (req, res) => {
      if (!req.file) throw new Error('Keine Datei.');
      res.json(await this.addDatapack(req.params.id, req.file.path, req.file.originalname));
    });
    r.get('/mc/servers/:id/datapacks-market', async (req, res) => res.json(await this.searchDatapacks(req.params.id, String(req.query.q || ''))));
    r.post('/mc/servers/:id/datapacks-market', (req, res) => res.json({ job: this.installDatapack(req.params.id, String((req.body || {}).projectId || '')).id }));
    r.get('/mc/servers/:id/pregen', (req, res) => res.json(this.pregenStatus(req.params.id)));
    r.post('/mc/servers/:id/pregen/install', (req, res) => res.json({ job: this.installChunky(req.params.id).id }));
    r.post('/mc/servers/:id/pregen', (req, res) => res.json(this.startPregen(req.params.id, req.body || {})));
    r.post('/mc/servers/:id/pregen/:action', (req, res) => res.json(this.pregenAction(req.params.id, req.params.action)));
    r.get('/mc/servers/:id/logfiles', (req, res) => res.json(this.logFiles(req.params.id)));
    r.get('/mc/servers/:id/logfiles/:file', (req, res) => res.json(this.readLog(req.params.id, req.params.file, req.query)));
    r.get('/mc/servers/:id/crash-reports', (req, res) => res.json(this.crashReports(req.params.id)));
    r.get('/mc/servers/:id/crash-reports/:file', (req, res) => res.json(this.crashReport(req.params.id, req.params.file)));
    r.post('/mc/servers/:id/copy', (req, res) => res.json({ job: this.copyServer(req.params.id, req.body || {}).id }));
    r.post('/mc/servers/:id/players/transfer', (req, res) => res.json(this.transferPlayers(req.params.id, req.body || {})));
    // Formulare für häufige Plugin-Einstellungen
    const forms = require('./pluginforms');
    r.get('/mc/servers/:id/plugin-forms', (req, res) => { this.mc.get(req.params.id); res.json({ forms: forms.listForms(path.join(this.mc.dir(req.params.id), 'plugins')), running: this.mc.proc(req.params.id).isRunning() }); });
    r.put('/mc/servers/:id/plugin-forms/:form', (req, res) => { this.mc.get(req.params.id); res.json(forms.saveForm(path.join(this.mc.dir(req.params.id), 'plugins'), req.params.form, (req.body || {}).values || {})); });
  }
}

module.exports = { McTools, findWorldDir, packDescription, readZipEntry };
