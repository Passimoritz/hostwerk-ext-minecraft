'use strict';
const { ping, bedrockStatus } = require('./ping');
const { LiveUpdate } = require('./liveupdate');
const { PluginMarket } = require('./market');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const yauzl = require('./hw').lib('yauzl');
const YAML = require('./hw').lib('yaml');
const { providers, javaFor, searchModpacks, modpackVersion, installModpack, modpackUpdates, updateModpackFiles } = require('./providers');
const { Network } = require('./network');
const { ClientPack } = require('./clientpack');
const { PlayerStats } = require('./stats');
const { Dimensions } = require('./dimensions');
const { UpdateWatch } = require('./updatewatch');
const { runJob } = require('./hw').core('jobs');
const { ManagedProcess, registry } = require('./hw').core('proc');
const { isPortFree, findFreePort, whoUsesPort } = require('./hw').core('ports');
const { zipDir, unzipTo, slug, dirSize } = require('./hw').core('util');
const { fetchJson, downloadFile, fmtBytes, APP_UA } = require('./hw').core('download');
const { broadcast } = require('./hw').core('events');
const T = (text, vars) => require('./hw').t(text, vars); // Text in der Sprache der Oberfläche (Deutsch aus locales/de.json)

const AIKAR = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200', '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1', '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true',
];

/* ---------- server.properties ---------- */
function parseProps(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^\s*[#!]/.test(line)) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/\\:/g, ':').replace(/\\=/g, '=');
  }
  return out;
}
function writeProps(text, values) {
  const done = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    if (!line.trim() || /^\s*[#!]/.test(line)) return line;
    const i = line.indexOf('=');
    if (i < 0) return line;
    const k = line.slice(0, i).trim();
    if (k in values) { done.add(k); return `${k}=${String(values[k]).replace(/[\r\n]/g, ' ')}`; }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!done.has(k)) lines.push(`${k}=${String(v).replace(/[\r\n]/g, ' ')}`);
  return lines.join('\n').replace(/\n*$/, '\n');
}

/* ---------- Plugin-Metadaten aus JAR lesen ---------- */
function readPluginMeta(jarFile) {
  return new Promise((resolve) => {
    yauzl.open(jarFile, { lazyEntries: true }, (err, zip) => {
      if (err) return resolve(null);
      let found = null;
      const finish = (v) => { try { zip.close(); } catch {} resolve(v); };
      // Plugins: plugin.yml · Mods: fabric.mod.json bzw. (neoforge.)mods.toml
      const META = ['plugin.yml', 'paper-plugin.yml', 'bungee.yml', 'fabric.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml'];
      zip.on('entry', (e) => {
        if (META.includes(e.fileName) && !found) {
          found = e.fileName;
          zip.openReadStream(e, (err2, s) => {
            if (err2) return finish(null);
            let buf = '';
            s.on('data', (c) => { buf += c; });
            s.on('end', () => {
              try {
                if (found === 'fabric.mod.json') {
                  const j = JSON.parse(buf.replace(/^﻿/, ''));
                  return finish({ name: j.name || j.id, version: j.version != null ? String(j.version) : null, description: j.description || null, authors: (j.authors || []).map((a) => (typeof a === 'string' ? a : a.name)), website: (j.contact && j.contact.homepage) || null, mod: true });
                }
                if (/mods\.toml$/.test(found)) {
                  const get = (k) => { const m = buf.match(new RegExp(`^\\s*${k}\\s*=\\s*["']([^"'\\r\\n]*)["']`, 'm')); return m ? m[1] : null; };
                  const desc = (buf.match(/description\s*=\s*'''([\s\S]*?)'''/) || buf.match(/description\s*=\s*"([^"]*)"/) || [])[1];
                  const ver = get('version');
                  return finish({ name: get('displayName') || get('modId'), version: ver && !/\$\{/.test(ver) ? ver : null, description: desc ? desc.trim().slice(0, 300) : null, authors: get('authors') ? [get('authors')] : [], website: get('displayURL'), mod: true });
                }
                const y = YAML.parse(buf) || {};
                finish({ name: y.name, version: y.version != null ? ((buf.match(/^version\s*:\s*["']?([^"'\r\n#]+)/m) || [])[1] || String(y.version)).trim() : null, description: y.description || null, authors: y.authors || (y.author ? [y.author] : []), apiVersion: y['api-version'] != null ? String(y['api-version']) : null, website: y.website || null });
              } catch { finish(null); }
            });
          });
        } else zip.readEntry();
      });
      zip.on('end', () => { if (!found) finish(null); });
      zip.on('error', () => finish(null));
      zip.readEntry();
    });
  });
}

/*
 * Dimensionen eines Weltordners – jede, die es gibt, auch solche aus Datenpaketen und künftigen Minecraft-Versionen:
 *  - ab Minecraft 26: dimensions/<namespace>/<name>/ (auch Oberwelt, Nether und Ende)
 *  - bis 1.21: Oberwelt direkt im Ordner (region/), Nether in DIM-1/, Ende in DIM1/, Datenpakete in dimensions/<ns>/<name>/
 * path = Ordner relativ zur Welt (null: Oberwelt alter Art – lässt sich nur mit der ganzen Welt zurücksetzen).
 */
function worldDims(full) {
  const out = [];
  const isDim = (d) => ['region', 'entities', 'poi', 'data'].some((x) => fs.existsSync(path.join(d, x)));
  if (fs.existsSync(path.join(full, 'region'))) out.push({ id: 'minecraft:overworld', path: null });
  for (const [dir, id] of [['DIM-1', 'minecraft:the_nether'], ['DIM1', 'minecraft:the_end']]) if (isDim(path.join(full, dir))) out.push({ id, path: dir });
  let nss = [];
  try { nss = fs.readdirSync(path.join(full, 'dimensions'), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { /* keine */ }
  for (const ns of nss) {
    let names = [];
    try { names = fs.readdirSync(path.join(full, 'dimensions', ns.name), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { continue; }
    for (const n of names) {
      const rel = path.posix.join('dimensions', ns.name, n.name);
      if (!isDim(path.join(full, rel))) continue;
      const id = `${ns.name}:${n.name}`;
      const i = out.findIndex((x) => x.id === id);
      if (i >= 0) out[i] = { id, path: rel }; else out.push({ id, path: rel });
    }
  }
  const ORDER = ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'];
  const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : 9);
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

/*
 * Zwischenspeicher je JAR (Pfad + Größe + Änderungszeit): Metadaten, Symbol-Eintrag, SHA-1.
 * Große JARs (BlueMap: 3000 Einträge) kosten sonst bei jedem Öffnen des Plugin-Tabs Hunderte Millisekunden.
 * Liegt zusätzlich auf der Platte, damit auch der erste Aufruf nach einem Neustart schnell ist.
 */
class JarCache {
  constructor(file) { this.file = file; this.map = new Map(); this.dirty = false; try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) this.map.set(k, v); } catch { /* neu */ } }
  key(f) { try { const st = fs.statSync(f); return `${path.resolve(f)}|${st.size}|${Math.round(st.mtimeMs)}`; } catch { return null; } }
  async get(f, field, fn) {
    const k = this.key(f); if (!k) return fn();
    const e = this.map.get(k) || {};
    if (Object.prototype.hasOwnProperty.call(e, field)) return e[field];
    const v = await fn();
    this.map.set(k, { ...e, [field]: v === undefined ? null : v }); this.save();
    return v;
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // Einträge zu Dateien, die es nicht mehr gibt, fallen weg
      for (const k of [...this.map.keys()]) if (!fs.existsSync(k.split('|')[0])) this.map.delete(k);
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.map))); } catch { /* egal */ }
    }, 1500);
    if (this.timer.unref) this.timer.unref();
  }
}

class MinecraftManager {
  constructor(ctx) {
    this.pollTimers = new Map(); // id -> Abfrage-Intervall (Spieler, Live-MOTD)
    this.live = new LiveUpdate(ctx, this, readPluginMeta);
    this.market = new PluginMarket(this);
    this.network = new Network(this);
    this.clientPack = new ClientPack(this);
    this.stats = new PlayerStats(this);
    this.updates = new UpdateWatch(this);
    this.tools = new (require('./tools').McTools)(this);
    this.curseforge = new (require('./curseforge').CurseForge)(ctx.settings);
    this.tpsQuiet = new Map(); // id -> bis wann die Antwort auf die stille TPS-Abfrage versteckt wird
    // this.geyser setzt die Erweiterung „Minecraft-Servernetzwerk“ (früher „Bedrock-Brücke“) – wird vor jedem Start für
    // wartende Geyser-Updates gefragt (applyStaged) und von der Selbstwartung geprüft (checkAll)
    this.jarCache = new JarCache(path.join(ctx.paths.cache, 'plugin-jars.json'));
    this.dims = new Dimensions(this); // Symbole (Katalog) und echte Eigenschaften der Dimensionen
    this.readMeta = (f) => this.jarCache.get(f, 'meta', () => readPluginMeta(f));
    this.jarSha1 = (f) => this.jarCache.get(f, 'sha1', () => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'));
    this.projects = new (require('./pluginprojects').PluginProjects)(ctx, this);
    this.sources = new (require('./pluginsources').PluginSources)(this);
    require('./hw').core('jobs').registerResumer('mc-create', (body) => this.create(body));
    this.safeUpgrade = new (require('./safeupgrade').SafeUpgrade)(this);
    // Bedrock Dedicated Server: eigener Weg für Anlegen, Start, Updates, Sicherungen, Welten und Spieler (bedrock.js)
    this.bedrock = new (require('./bedrock').BedrockEdition)(this);
    // Quellen der Server-Programme in der Selbstwartung zeigen (offiziell oder Ersatzquelle MCJars)
    require('./providers').setKeeper((id, ok, text) => { if (ctx.keeper) ctx.keeper.note(`mc-quelle-${id}`, { ok, label: `Minecraft-Downloads (${id})`, text }); });
    this.ctx = ctx;
    this.paths = ctx.paths;
    this.settings = ctx.settings;
    this.procs = new Map();
    this.restartLog = new Map();
    this.selfTests = new Map();
    // Für Hostwerks Kern (Wiederherstellungs-Probe, Klonen) – früher dort direkt aus server/minecraft geladen
    const trial = require('./trial');
    this.helpers = { trialRun: trial.trialRun, copyDir: trial.copyDir, parseProps, writeProps };
    for (const s of this.list()) this.proc(s.id);
  }
  list() { return this.settings.get().minecraft.servers; }
  get(id) {
    const s = this.list().find((x) => x.id === id);
    if (!s) throw Object.assign(new Error(T('Server not found')), { status: 404 });
    return s;
  }
  /** Serverordner – bei übernommenen Servern („am bisherigen Ort“) der ursprüngliche Ordner. */
  dir(id) {
    const s = this.list().find((x) => x.id === id);
    return (s && s.externalDir) || this.paths.mcDir(id);
  }
  backupDir(id) { return path.join(this.paths.backups, 'minecraft', id); }
  /** Mod-Server (Fabric, NeoForge, Forge, Modpacks) haben „mods“, alle anderen „plugins“. */
  content(s) { return (providers[s.type] && providers[s.type].content) || s.content || 'plugins'; }
  /** Velocity: Proxy statt Spielserver (keine Welt, keine server.properties). */
  isProxy(s) { return !!(providers[s.type] && providers[s.type].proxy); }
  /** Bedrock Dedicated Server statt Java-Server (eigenes Programm, UDP, Welten unter worlds/). */
  isBedrock(s) { return !!(s && providers[s.type] && providers[s.type].edition === 'bedrock'); }
  /** Fähigkeiten des Servertyps (providers.caps) – Oberfläche und Kern fragen diese statt fester Typnamen. */
  caps(s) { return require('./providers').caps(s.type); }
  /**
   * Weiteren Servertyp anmelden (SDK 3.2, nur native Erweiterungen): erscheint beim Anlegen und in den Server-Updates wie
   * ein eingebauter. → Abmelde-Funktion (beim Entfernen der Erweiterung aufrufen). Siehe providers.registerType.
   */
  registerType(id, def, owner) { return require('./providers').registerType(id, def, owner); }
  addonDir(id) { return path.join(this.dir(id), this.content(this.get(id)) === 'mods' ? 'mods' : 'plugins'); }

  proc(id) {
    if (!this.procs.has(id)) {
      // Läuft der Server schon (Update der Erweiterung, vorher eingebaut): Prozess übernehmen statt einen neuen anzulegen –
      // ein neuer Eintrag würde den laufenden Java-Prozess verwaisen lassen (Konsole, Stoppen, Spieler gingen verloren)
      // Nur derselbe Serverordner – mehrere Hostwerk-Instanzen in einem Prozess (Tests) haben sonst gleiche Kennungen
      const prev = registry.get('mc:' + id);
      const old = prev && prev.mcDir === this.dir(id) ? prev : null;
      const p = old || new ManagedProcess('mc:' + id, 'Minecraft');
      p.mcDir = this.dir(id);
      if (!p.extra.players) p.extra.players = [];
      p.stopFn = () => this.stop(id);
      p.onExit = ({ wanted }) => this.onExit(id, wanted);
      this.procs.set(id, p);
      if (old && old.child) {
        const s = this.list().find((x) => x.id === id);
        if (s && !this.isBedrock(s)) { const h = this.lineHandlers(id, p); p.lineFilter = h.lineFilter; p.onLine = h.onLine; }
        if (old.extra.ready) setTimeout(() => this.pollStatus(id), 0);
      }
    }
    return this.procs.get(id);
  }

  info(s) {
    const p = this.proc(s.id);
    const dir = this.dir(s.id);
    let props = {};
    try { props = parseProps(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8')); } catch {}
    const bedrock = this.isBedrock(s);
    return {
      ...s,
      caps: this.caps(s),
      ...(bedrock ? { bedrock: this.bedrock.status(s.id) } : {}),
      typeLabel: providers[s.type] ? providers[s.type].label : s.type,
      homepage: (providers[s.type] && providers[s.type].homepage) || null,
      pluginsSupported: providers[s.type] ? providers[s.type].plugins !== false : true,
      content: this.content(s),
      proxy: this.isProxy(s),
      updates: this.updates ? this.updates.get(s.id) : null,
      dir,
      motd: (bedrock ? props['server-name'] : props.motd) ?? null,
      maxPlayers: Number(props['max-players']) || null,
      onlineMode: props['online-mode'] !== 'false',
      address: { local: `localhost:${s.port}`, lan: lanIps().map((ip) => `${ip}:${s.port}`) },
      javaInstalled: bedrock ? true : this.ctx.services.java.isInstalled(s.javaMajor),
      proc: p.info(),
    };
  }

  /* ---------- Anlegen ---------- */
  async create(body) {
    const type = body.type;
    if (!providers[type]) throw new Error(T('Unknown server type'));
    if (providers[type].edition === 'bedrock') return this.bedrock.create(body);
    // Ein Proxy (Velocity) ist kein Minecraft-Server von Mojang – keine EULA nötig
    if (!body.eula && !providers[type].proxy) throw new Error(T('The Minecraft EULA must be accepted.'));
    const name = String(body.name || '').trim() || 'Minecraft-Server';
    let id = slug(name);
    // Fortsetzung nach Absturz/Beenden: derselbe Ordner (halb geladene server.jar.part lädt dort weiter)
    if (body._id && /^[\w-]+$/.test(body._id) && !this.list().some((s) => s.id === body._id)) id = body._id;
    else while (this.list().some((s) => s.id === id) || fs.existsSync(this.dir(id))) id = slug(name) + '-' + crypto.randomBytes(2).toString('hex');
    const used = this.list().map((s) => s.port);
    const port = Number(body._port) || Number(body.port) || (await findFreePort(25565, used));
    let version = body.version;
    // Modpack: Minecraft-Version und Loader stehen im Pack
    let pack = null;
    if (type === 'modpack') {
      if (!body.modpack || !body.modpack.projectId) throw new Error(T('Please choose a modpack.'));
      // CurseForge: Minecraft-Version aus der gewählten Datei (für die passende Java-Version vorab)
      if (body.modpack.source === 'curseforge') { pack = await this.curseforge.packInfo(body.modpack.projectId, body.modpack.fileId); body.modpack.fileId = pack.id; }
      else pack = await modpackVersion(body.modpack.projectId, body.modpack.versionId);
      version = pack.mc;
    }
    if (!['custom', 'modpack'].includes(type) && !version) version = (await providers[type].versions()).latest;
    const javaMajor = Number(body.javaMajor) || (type === 'custom' ? 25 : await javaFor(version, type));
    const server = {
      id, name, type, version: version || null, build: null, port,
      memMin: Number(body.memMin) || 1024, memMax: Number(body.memMax) || 4096,
      javaMajor, jvmFlags: body.jvmFlags || 'aikar', extraArgs: '', autostart: false, autoRestart: true,
      jar: 'server.jar', createdAt: Date.now(),
      // Sicherheitsnetz ab Werk: jede Nacht sichern, 7 Stände (beim Anlegen abwählbar, services/nightlybackup.js)
      nightlyBackup: { enabled: body.nightlyBackup !== false, everyHours: 24, keep: 7, hour: 3, since: Date.now() },
    };
    return runJob(T('Create Minecraft server “{name}”', { name }), async (job) => {
      const dir = this.dir(id);
      fs.mkdirSync(dir, { recursive: true });
      try {
        job.progress(2, T('Checking Java {javaMajor} …', { javaMajor }));
        const javaExe = await this.ctx.services.java.ensure(javaMajor, job, [2, 35]);
        const dest = path.join(dir, 'server.jar');
        if (type === 'custom') {
          const up = this.takeUpload(body.uploadId);
          fs.renameSync(up.file, dest);
          server.version = body.version || up.name.replace(/\.jar$/i, '');
        } else if (type === 'modpack') {
          const r = body.modpack.source === 'curseforge'
            ? await this.curseforge.install(body.modpack, dir, job, { paths: this.paths, javaExe }, providers)
            : await installModpack(body.modpack, dir, job, { paths: this.paths, javaExe });
          Object.assign(server, { type: r.type, version: r.mc, build: r.build, modpack: r.modpack, ...(r.launch ? { launch: r.launch } : {}), ...(r.jar ? { jar: r.jar } : {}) });
        } else {
          const r = await providers[type].download(version, dest, job, { paths: this.paths, javaExe });
          server.build = r.build;
          // Forge/NeoForge starten über ein Argumente-File (bzw. eine eigene JAR bei alten Versionen)
          if (r.launch) server.launch = r.launch;
          if (r.jar) server.jar = r.jar;
        }
        if (!providers[type].proxy) fs.writeFileSync(path.join(dir, 'eula.txt'), `# Accepted through Hostwerk on ${new Date().toISOString()}\n# https://aka.ms/MinecraftEULA\neula=true\n`);
        if (!providers[type].proxy) fs.writeFileSync(path.join(dir, 'server.properties'), writeProps('#Minecraft server properties\n', {
          'server-port': port,
          'query.port': port,
          // Standard-Beschreibung in der Sprache von Hostwerk (danach gehört sie dem Nutzer und wird nicht mehr übersetzt)
          motd: body.motd || `${name} §7– ${T('hosted with Hostwerk')}`,
          'max-players': body.maxPlayers || 20,
          gamemode: body.gamemode || 'survival',
          difficulty: body.difficulty || 'normal',
          'online-mode': body.onlineMode === false ? 'false' : 'true',
          ...(body.seed ? { 'level-seed': body.seed } : {}),
        }));
        const list = this.list();
        list.push(server);
        this.settings.save();
        this.proc(id);
        job.progress(100, T('Done'));
        return { id };
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw e;
      }
    }, { key: `mc-create:${name.toLowerCase()}:${body.type || ''}:${body.version || ''}`, resume: { kind: 'mc-create', params: { ...body, version, _id: id, _port: port } } }); // doppelte Anfrage → dieselbe Aufgabe
  }

  /* ---------- Uploads (eigene JAR) ---------- */
  takeUpload(uploadId) {
    if (!/^[a-f0-9-]{36}$/.test(uploadId || '')) throw new Error(T('No JAR file uploaded.'));
    const meta = path.join(this.paths.cache, 'uploads', uploadId + '.json');
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    fs.rmSync(meta, { force: true });
    return m;
  }

  /* ---------- Version wechseln ---------- */
  changeVersion(id, { type, version, uploadId }) {
    const s = this.get(id);
    // Bedrock: Update mit Rücksprung (stoppt und startet selbst, Welten wandern mit)
    if (this.isBedrock(s)) return this.bedrock.update(id, { version: version || null, force: true });
    if (this.proc(id).isRunning()) throw Object.assign(new Error(T('Please stop the server first.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'stop' } });
    const t = type || s.type;
    if (!providers[t]) throw new Error(T('Unknown server type'));
    if (providers[t].edition === 'bedrock') throw new Error(T('A Java server cannot be switched to Bedrock (different world formats) – create a new Bedrock server instead.'));
    return runJob(T('Switch “{name}” to {label} {v3}', { name: s.name, label: providers[t].label, v3: version || '' }), async (job) => {
      // Zeitmaschine mit Daten: Setup + Welt sichern, damit die Zeitreise den Wechsel vollständig rückgängig machen kann
      if (this.ctx.timeMachine && !process.env.HW_TEST_NO_TM) await this.ctx.timeMachine.withData(T('Minecraft: {name} – before switching to {label} {version}', { name: s.name, label: providers[t].label, version: version || '' }).trim(), { mc: [id] }, job);
      const dir = this.dir(id);
      const javaMajor = t === 'custom' ? s.javaMajor : await javaFor(version, t);
      const javaExe = await this.ctx.services.java.ensure(javaMajor, job, [2, 35]);
      const tmp = path.join(dir, 'server.jar.neu');
      let build = null;
      let ver = version;
      if (t === 'custom') {
        const up = this.takeUpload(uploadId);
        fs.renameSync(up.file, tmp);
        ver = version || up.name.replace(/\.jar$/i, '');
      } else {
        const r = await providers[t].download(version, tmp, job, { paths: this.paths, javaExe });
        build = r.build;
        // Forge/NeoForge: Start über das neue Argumente-File, keine JAR zum Austauschen
        if (r.launch || r.jar) {
          Object.assign(s, { type: t, version: ver, build, javaMajor, launch: r.launch || undefined, jar: r.jar || s.jar || 'server.jar' });
          if (!r.launch) delete s.launch;
          this.settings.save();
          return { id };
        }
      }
      const jar = path.join(dir, s.jar || 'server.jar');
      if (fs.existsSync(jar)) fs.renameSync(jar, path.join(dir, 'server.jar.alt'));
      fs.renameSync(tmp, path.join(dir, 'server.jar'));
      Object.assign(s, { type: t, version: ver, build, javaMajor, jar: 'server.jar' });
      delete s.launch;
      this.settings.save();
      job.log(T('Old JAR saved as server.jar.alt'));
      return { id };
    });
  }

  /* ---------- Modpack aktualisieren ---------- */
  modpackUpdates(id) {
    const s = this.get(id);
    // CurseForge-Packs: Updates (noch) nur durch neues Anlegen – keine Fehlermeldung von Modrinth zeigen
    if (s.modpack && s.modpack.source === 'curseforge') return { current: { id: s.modpack.fileId, number: s.modpack.version, mc: s.version }, latest: null, versions: [], source: 'curseforge' };
    return modpackUpdates(s);
  }

  updateModpack(id, { versionId }) {
    const s = this.get(id);
    if (!s.modpack) throw new Error(T('This server wasn\'t created from a modpack.'));
    if (!versionId) throw new Error(T('No version chosen.'));
    return runJob(T('Update modpack “{name}”', { name: s.name }), async (job) => {
      const wasRunning = this.proc(id).isRunning();
      if (wasRunning) { job.progress(2, T('Stopping server …')); await this.stop(id); }
      job.progress(4, T('Creating backup …'));
      await this.backup(id, 'vor-modpack-update').promise;
      const javaMajor = await javaFor(s.version);
      const javaExe = await this.ctx.services.java.ensure(javaMajor, job, [5, 7]);
      const r = await updateModpackFiles(s, this.dir(id), versionId, job, { paths: this.paths, javaExe });
      if (r.loader) {
        Object.assign(s, { version: r.mc, build: r.loader.build, javaMajor: await javaFor(r.mc), jar: r.loader.jar || 'server.jar' });
        if (r.loader.launch) s.launch = r.loader.launch; else delete s.launch;
      }
      s.modpack = r.modpack;
      this.settings.save();
      job.log(T('Modpack updated to {version}. A backup of the old state is under “Backups”.', { version: r.modpack.version }));
      if (wasRunning) { job.progress(98, T('Starting server …')); await this.start(id); }
      return { id, version: r.modpack.version };
    });
  }

  /* ---------- Start / Stopp ---------- */
  async start(id) {
    const s = this.get(id);
    const p = this.proc(id);
    if (p.isRunning()) return;
    if (this.isBedrock(s)) return this.bedrock.start(id);
    const dir = this.dir(id);
    const jar = path.join(dir, s.jar || 'server.jar');
    // Forge/NeoForge: Start über das Argumente-File des Installers statt über eine JAR
    const argsFile = s.launch && s.launch.argsFile ? path.join(dir, s.launch.argsFile) : null;
    if (argsFile ? !fs.existsSync(argsFile) : !fs.existsSync(jar)) throw new Error(T('Server JAR missing: {file}', { file: argsFile || jar }));
    if (!(await isPortFree(s.port))) {
      const who = await whoUsesPort(s.port);
      throw new Error(who ? T('Port {port} is in use by {name} (PID {pid}).', { port: s.port, name: who.name, pid: who.pid }) : T('Port {port} is in use.', { port: s.port }));
    }
    // Wartende Geyser-Updates einspielen (nur bei gestopptem Server möglich)
    try { if (this.geyser) this.geyser.applyStaged(id, (msg) => p.log(msg, 'sys')); } catch (e) { p.log(T('Geyser update not applied: {error}', { error: e.message }), 'sys'); }
    // Port aus server.properties übernehmen, falls dort geändert
    const propsFile = path.join(dir, 'server.properties');
    if (fs.existsSync(propsFile)) fs.writeFileSync(propsFile, writeProps(fs.readFileSync(propsFile, 'utf8'), { 'server-port': s.port }));
    // Software mit eigener Java-Vorgabe (Velocity): zu alte Einstellung anheben statt mit Klassenversion-Fehler abzustürzen
    const prov = providers[s.type];
    if (prov && prov.beforeStart) await prov.beforeStart(s, dir);
    const need = prov && prov.java ? prov.java(s.version) : 0;
    if (need && s.javaMajor < need && !s.javaPath) { s.javaMajor = need; this.settings.save(); }
    let javaExe = s.javaPath && fs.existsSync(s.javaPath) ? s.javaPath : null;
    if (!javaExe) {
      if (!this.ctx.services.java.isInstalled(s.javaMajor)) {
        p.log(T('Downloading Java {major} …', { major: s.javaMajor }), 'sys');
        const job = runJob(T('Install Java {javaMajor}', { javaMajor: s.javaMajor }), (j) => this.ctx.services.java.ensure(s.javaMajor, j), { key: 'java-' + s.javaMajor });
        await job.promise;
      }
      javaExe = this.ctx.services.java.exe(s.javaMajor);
    }
    const args = [`-Xms${Math.min(s.memMin, s.memMax)}M`, `-Xmx${s.memMax}M`];
    if (s.jvmFlags === 'aikar') args.push(...AIKAR);
    if (s.extraArgs) args.push(...String(s.extraArgs).split(/\s+/).filter(Boolean));
    if (argsFile) args.push('@' + s.launch.argsFile, 'nogui');
    // Typ aus einer Erweiterung mit eigenem Start (z. B. BungeeCord: Port steht in seiner config.yml)
    else if (prov && prov.launchArgs) args.push(...[].concat(prov.launchArgs(s, jar) || []));
    // Velocity: Port per Schalter (die velocity.toml legt Velocity selbst an), kennt kein „nogui“
    else if (this.isProxy(s)) args.push('-jar', jar, '--port', String(s.port));
    else args.push('-jar', jar, 'nogui');
    // Eingereihte Plugin-Updates (z. B. nach einem Absturz noch offen) vor dem Start einspielen
    try { await this.live.applyPending(id); } catch { /* beim nächsten Mal */ }
    // Plugin-Live-Updates: Bridge-Plugin vor dem Start bereitlegen (nur wenn eingeschaltet)
    if (s.liveUpdate && s.liveUpdate.enabled) this.live.ensureBridge(id);
    p.setExtra({ players: [], playerCount: 0, ready: false, tps: null, liveMotd: null, bridge: null });
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });
    const h = this.lineHandlers(id, p, () => readyResolve());
    p.lineFilter = h.lineFilter;
    await p.start({
      cmd: javaExe,
      args,
      cwd: dir,
      stdin: true,
      onLine: h.onLine,
      // „Gestartet“ = Prozess läuft; „bereit“ (Done) wird separat gemeldet.
      ready: () => new Promise((r) => setTimeout(r, 1500)),
    });
    ready.then(() => broadcast({ type: 'toast', kind: 'success', text: T('“{name}” is ready (port {port}).', { name: s.name, port: s.port }) }));
  }

  /**
   * Auswertung der Konsolenzeilen eines Java-Servers (Bereit-Meldung, Spieler, TPS, Bridge-Antworten). Eigene Methode, damit
   * eine neue Fassung der Erweiterung laufende Server übernehmen kann (siehe proc) – ohne sie für das Update neu zu starten.
   */
  lineHandlers(id, p, onReady = () => {}) {
    const prov = providers[(this.list().find((x) => x.id === id) || {}).type];
    // Stille TPS-Messung (pollStatus): Antwort auswerten, aber nicht in der Konsole zeigen
    const lineFilter = (line) => {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
      if (/\[HW\] TPS /.test(clean)) { this.tools.onLine(id, clean); const m = clean.match(/\[HW\] TPS ([\d.]+)/); if (m && Number(m[1]) !== p.extra.tps) p.setExtra({ tps: Number(m[1]) }); return false; }
      // Stille Bridge-Antworten (Zustand-Aufschlüsselung, MOTD/Symbol live): auswerten, nicht in der Konsole zeigen
      if (/\[HW\] (STATS|MOTD|ICON) /.test(clean)) { this.live.onLine(id, clean); return false; }
      if ((this.tpsQuiet.get(id) || 0) > Date.now() && /TPS from last 1m|tick times|Tick durations/i.test(clean)) {
        const m = clean.match(/TPS from last 1m, 5m, 15m: \*?([\d.]+)/);
        if (m) { this.tools.addTps(id, Number(m[1])); if (Number(m[1]) !== p.extra.tps) p.setExtra({ tps: Number(m[1]) }); }
        return false;
      }
      return true;
    };
    const onLine = (line) => {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
      this.live.onLine(id, clean);
      this.tools.onLine(id, clean);
      if ((prov && prov.readyRe ? prov.readyRe : /Done \([\d.,]+s\)!/).test(clean)) {
        p.setExtra({ ready: true }); onReady(); this.pollStatus(id);
        // Nach jedem Start/Neustart eine Server-Prüfung (abschaltbar unter Zeitplan & Prüfung)
        const cfg = this.get(id);
        if (cfg.autoCheck !== false && !(this.selfTesting && this.selfTesting.has(id))) setTimeout(() => { try { this.selfTest(id).promise.catch(() => {}); } catch { /* läuft schon */ } }, 4000);
      }
      this.playerLine(id, p, clean);
      const m = clean.match(/TPS from last 1m, 5m, 15m: \*?([\d.]+)/);
      if (m) { p.setExtra({ tps: Number(m[1]) }); this.tools.addTps(id, Number(m[1])); }
      if (/You need to agree to the EULA/i.test(clean)) p.log(T('Note: the EULA was not accepted (eula.txt).'), 'sys');
      if (/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/.test(clean)) {
        p.log(T('Note: wrong Java version. Choose a newer Java version in the server settings.'), 'sys');
      }
    };
    return { lineFilter, onLine };
  }

  /** Beim Entladen der Erweiterung (Update, Ausschalten): Zeitgeber anhalten – laufende Server laufen weiter. */
  dispose() {
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
    try { this.updates.dispose(); } catch { /* ältere Fassung */ }
    try { for (const w of this.live.watchers.values()) w.close(); this.live.watchers.clear(); } catch { /* egal */ }
  }

  /** Konsolenzeile auf An-/Abmeldungen und die Spielerliste prüfen (Statistik, Live-Ereignisse mc-player-join/-leave). */
  playerLine(id, p, clean) {
    // Anmelden/Abmelden: diese Zeilen schreibt der Server immer – auch wenn Plugins die Join-Nachricht ändern
    // (Velocity: „[connected player] Name (/1.2.3.4:5) has connected“ bzw. „has disconnected“)
    let m = clean.match(/:\s(\.?[A-Za-z0-9_]{2,16})\[\/[^\]]+\] logged in with entity id/) || clean.match(/:\s(\.?[A-Za-z0-9_]{2,16}) joined the game/) || clean.match(/\[connected player\] (\.?[A-Za-z0-9_]{2,16}) \([^)]*\) has connected/);
    if (m && !p.extra.players.includes(m[1])) { p.setExtra({ players: [...p.extra.players, m[1]], playerCount: Math.max(p.extra.playerCount || 0, p.extra.players.length + 1) }); this.stats.join(id, m[1]); broadcast({ type: 'mc-player-join', id, server: this.get(id).name, player: m[1] }); }
    m = clean.match(/:\s(\.?[A-Za-z0-9_]{2,16}) (?:lost connection|left the game)/) || clean.match(/\[connected player\] (\.?[A-Za-z0-9_]{2,16}) \([^)]*\) has disconnected/);
    if (m && p.extra.players.includes(m[1])) {
      const players = p.extra.players.filter((x) => x !== m[1]);
      p.setExtra({ players, playerCount: players.length });
      const ms = this.stats.leave(id, m[1]);
      // Gegenstück zu mc-player-join (Live-Ereignis für Erweiterungen, Discord-Bot …): mit Dauer der Sitzung
      broadcast({ type: 'mc-player-leave', id, server: this.get(id).name, player: m[1], ms: typeof ms === 'number' ? ms : null });
    }
    m = clean.match(/There are (\d+) of a max(?: of)? (\d+) players online:\s*(.*)$/);
    if (m) {
      const now = m[3].split(',').map((x) => x.trim()).filter(Boolean);
      // Liste abgleichen (verpasste Join/Leave-Zeilen, z. B. nach einem Neustart von Hostwerk)
      for (const n of now) if (!p.extra.players.includes(n)) this.stats.join(id, n);
      for (const n of p.extra.players) if (!now.includes(n)) this.stats.leave(id, n);
      p.setExtra({ players: now, playerCount: Number(m[1]) });
    }
  }

  /**
   * Fragt den laufenden Server regelmäßig wie die Serverliste im Spiel ab: echte Spielerzahl, Namen und die
   * MOTD, die gerade wirklich angezeigt wird (auch wenn ein Plugin sie überschreibt).
   */
  pollStatus(id) {
    clearInterval(this.pollTimers.get(id));
    const tick = async () => {
      const p = this.proc(id);
      const s = this.list().find((x) => x.id === id);
      if (!s || p.state !== 'running') { clearInterval(this.pollTimers.get(id)); this.pollTimers.delete(id); return; }
      try {
        const bedrock = this.isBedrock(s);
        const r = bedrock ? await bedrockStatus(s.port) : await ping(s.port);
        if (bedrock && r) this.bedrock.seen(id, p, r);
        if (!r) throw new Error(T('no answer'));
        const patch = { playerCount: r.online, maxPlayersLive: r.max, liveMotd: r.motd };
        // Bedrock nennt keine Namen in der Antwort – die Liste kommt aus dem Protokoll
        if (bedrock) { if (r.online === 0) patch.players = []; } else
        // Liste nur übernehmen, wenn der Server alle Namen verrät (Plugins können den Auszug verstecken)
        if (r.sample.length === r.online) patch.players = r.sample;
        else if (r.online === 0) patch.players = [];
        else if (p.extra.players.length > r.online) patch.players = p.extra.players.slice(-r.online);
        const changed = Object.entries(patch).some(([k, v]) => JSON.stringify(p.extra[k]) !== JSON.stringify(v));
        if (changed) p.setExtra(patch);
      } catch { /* Server antwortet gerade nicht – beim nächsten Mal */ }
      if (n++ % 3 === 0) this.sampleTps(id);
    };
    let n = 0;
    tick();
    this.pollTimers.set(id, setInterval(tick, 10000));
  }

  /** Stille TPS-Messung: über die Bridge (ab 1.1) oder den Paper-Befehl „tps“; die Antwort erscheint nicht in der Konsole. */
  sampleTps(id) {
    const p = this.proc(id);
    const s = this.list().find((x) => x.id === id);
    if (!s || !p.child || !p.extra.ready || this.isProxy(s) || this.isBedrock(s)) return;
    const bridge = String(p.extra.bridge || '');
    if (/^(\d+)\.(\d+)/.test(bridge) && (Number(bridge.split('.')[0]) > 1 || Number(bridge.split('.')[1]) >= 1)) { p.write('hostwerk tps'); return; }
    if (!['paper', 'purpur'].includes(s.type)) return;
    this.tpsQuiet.set(id, Date.now() + 3000);
    p.write('tps');
  }

  async stop(id) {
    const p = this.proc(id);
    // Velocity beendet sich mit „end“, Minecraft-Server mit „stop“
    const s = this.list().find((x) => x.id === id);
    await p.stop({ graceful: async () => p.write(s && this.isProxy(s) ? 'end' : 'stop'), timeout: 60000 });
    this.stats.closeAll(id);
    p.setExtra({ players: [], playerCount: 0, ready: false, liveMotd: null, bridge: null });
  }

  async restart(id) { await this.stop(id); await this.start(id); }

  onExit(id, wanted) {
    const s = this.list().find((x) => x.id === id);
    const p = this.proc(id);
    // Eingereihte Plugin-Updates jetzt einspielen (Dateien sind frei). Kurz warten – Windows gibt Sperren verzögert frei.
    { const t = setTimeout(() => this.live.applyPending(id).catch(() => {}), 1500); if (t.unref) t.unref(); }
    this.stats.closeAll(id);
    p.setExtra({ players: [], playerCount: 0, ready: false, liveMotd: null, bridge: null });
    if (s && !wanted) { const since = p.startedAt || 0; const t = setTimeout(() => { try { this.tools.attachCrash(id, since); } catch { /* kein Bericht */ } }, 1500); if (t.unref) t.unref(); }
    if (!s || wanted || !s.autoRestart) return;
    const now = Date.now();
    const recent = (this.restartLog.get(id) || []).filter((t) => now - t < 5 * 60 * 1000);
    if (recent.length >= 3) {
      p.log(T('Automatic restart cancelled: 3 crashes in 5 minutes.'), 'sys');
      return;
    }
    recent.push(now);
    this.restartLog.set(id, recent);
    p.log(T('Server crashed – restarting in 5 seconds …'), 'sys');
    setTimeout(() => this.start(id).catch((e) => p.log(T('Restart failed: {error}', { error: e.message }), 'sys')), 5000);
  }

  /** server.properties in einem beliebigen Serverordner ändern (z. B. bei einer Testkopie). */
  setPropertiesAt(dir, values) {
    const f = path.join(dir, 'server.properties');
    fs.writeFileSync(f, writeProps(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', values));
  }

  /** server.properties lesen / schreiben (Kommentare und Reihenfolge bleiben erhalten). */
  properties(id) {
    const f = path.join(this.dir(id), 'server.properties');
    return fs.existsSync(f) ? parseProps(fs.readFileSync(f, 'utf8')) : {};
  }
  setProperties(id, values) {
    const s = this.get(id);
    const f = path.join(this.dir(s.id), 'server.properties');
    fs.writeFileSync(f, writeProps(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', values));
    if (values['server-port'] && Number(values['server-port']) !== s.port) { s.port = Number(values['server-port']); this.settings.save(); }
    if (this.isBedrock(s) && values['server-portv6'] && Number(values['server-portv6']) !== s.portv6) { s.portv6 = Number(values['server-portv6']); this.settings.save(); }
    return parseProps(fs.readFileSync(f, 'utf8'));
  }

  command(id, cmd) {
    const p = this.proc(id);
    if (!p.child) throw Object.assign(new Error(T('Server is not running.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'start' } });
    p.log('> ' + cmd, 'in');
    p.write(String(cmd).replace(/^\//, ''));
  }

  /* ---------- Bridge ab 1.2: Serverliste live ändern, Zustand aufschlüsseln ---------- */
  /** Läuft im Server eine Bridge mindestens dieser Version (z. B. „1.2“)? */
  bridgeAt(id, min) {
    const m = String(this.proc(id).extra.bridge || '').match(/^(\d+)\.(\d+)/);
    if (!m) return false;
    const [a, b] = String(min).split('.').map(Number);
    return Number(m[1]) > a || (Number(m[1]) === a && Number(m[2]) >= b);
  }
  /** Bridge-Befehl still senden (erscheint nicht in der Konsole) und auf die passende „[HW] …“-Antwort warten (null = keine). */
  bridgeAsk(id, cmd, re, timeout = 4000) {
    const p = this.proc(id);
    if (!p.child || !p.extra.ready) return Promise.resolve(null);
    const answer = this.live.waitFor(id, (m) => re.test(m), timeout);
    p.write(cmd);
    return answer;
  }
  /** MOTD sofort in der Serverliste zeigen (Minecraft liest server.properties sonst nur beim Start). true = hat geklappt. */
  async applyMotdLive(id, motd) {
    if (!this.bridgeAt(id, '1.2')) return false;
    const text = String(motd || '').replace(/\\u00a7/gi, '§').replace(/\\n/g, '\n');
    const r = await this.bridgeAsk(id, `hostwerk motd ${Buffer.from(text, 'utf8').toString('base64')}`, /^MOTD (OK|FAIL)/);
    return !!r && /^MOTD OK/.test(r);
  }
  /** Server-Symbol (server-icon.png) sofort neu laden bzw. entfernen. */
  async applyIconLive(id, clear = false) {
    if (!this.bridgeAt(id, '1.2')) return false;
    const r = await this.bridgeAsk(id, clear ? 'hostwerk icon clear' : 'hostwerk icon', /^ICON (OK|FAIL)/);
    return !!r && /^ICON OK/.test(r);
  }

  /**
   * Zustand im Detail: was der Server an CPU und RAM braucht – im Vergleich zum ganzen PC und zu den anderen Diensten.
   * Mit Bridge ab 1.2 zusätzlich das Innere der Java-VM (Heap, Bereiche, Müllsammler, CPU je Thread-Gruppe, Welten, Plugins).
   * full = Kreaturen nach Art zählen (etwas teurer – nur für die offene Detailansicht).
   */
  async health(id, { full = false } = {}) {
    const s = this.get(id);
    const p = this.proc(id);
    const sys = this.ctx.system;
    const last = sys && sys.history.length ? sys.history[sys.history.length - 1] : null;
    const cores = os.cpus().length || 1;
    const out = {
      running: !!p.child, ready: !!p.extra.ready, bridge: p.extra.bridge || null, bridgeStats: this.bridgeAt(id, '1.2'),
      proc: { cpu: (p.stats && p.stats.cpu) || 0, memory: (p.stats && p.stats.memory) || 0, history: p.statsHistory.slice(-60) },
      system: { cpu: last ? last.cpu : null, memUsed: os.totalmem() - os.freemem(), totalMem: os.totalmem(), cores, history: sys ? sys.history.slice(-60) : [] },
      config: { memMin: s.memMin, memMax: s.memMax * 1048576, javaMajor: s.javaMajor, viewDistance: null, simulationDistance: null },
      others: [], jvm: null, disk: this.diskUse(id),
    };
    try { const pr = this.properties(id); out.config.viewDistance = Number(pr['view-distance']) || null; out.config.simulationDistance = Number(pr['simulation-distance']) || null; } catch { /* egal */ }
    // Andere Dienste (Hostwerk-Prozesse) – zum Vergleich; Rest = andere Programme auf dem PC
    try {
      const r = sys.resources();
      out.others = r.procs.filter((x) => x.id !== `mc:${id}` && x.state === 'running').map((x) => ({ id: x.id, name: x.name, cpu: x.cpu, memory: x.memory }));
      out.hostwerk = r.hostwerk.memory;
    } catch { /* ohne Systemdienst (Tests) */ }
    if (out.bridgeStats && out.ready) {
      const r = await this.bridgeAsk(id, full ? 'hostwerk stats full' : 'hostwerk stats', /^STATS /, 5000);
      if (r) { try { out.jvm = JSON.parse(r.slice(6)); } catch { /* unvollständige Zeile */ } }
    }
    return out;
  }
  /** Platz auf der Platte je Bereich (Welten, Plugins/Mods, Protokolle, Sicherungen) – teuer, daher 2 Minuten gemerkt. */
  diskUse(id) {
    const hit = (this.diskCache || (this.diskCache = new Map())).get(id);
    if (hit && Date.now() - hit.at < 120000) return hit.v;
    const dir = this.dir(id);
    const worlds = (() => { try { return this.worlds(id).worlds.reduce((n, w) => n + w.size, 0); } catch { return 0; } })();
    const sub = (n) => { try { return dirSize(path.join(dir, n)); } catch { return 0; } };
    const total = (() => { try { return dirSize(dir); } catch { return 0; } })();
    const v = { worlds, plugins: sub('plugins') + sub('mods'), logs: sub('logs') + sub('crash-reports'), libraries: sub('libraries') + sub('versions') + sub('cache') + sub('.paper'), total, backups: (() => { try { return this.backups(id).reduce((n, b) => n + b.size, 0); } catch { return 0; } })() };
    v.other = Math.max(0, total - v.worlds - v.plugins - v.logs - v.libraries);
    this.diskCache.set(id, { at: Date.now(), v });
    return v;
  }

  /* ---------- Backups ---------- */
  backups(id) {
    const d = this.backupDir(id);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => f.endsWith('.zip')).map((f) => {
      const st = fs.statSync(path.join(d, f));
      return { file: f, size: st.size, sizeText: fmtBytes(st.size), time: st.mtimeMs };
    }).sort((a, b) => b.time - a.time);
  }

  backup(id, label = '') {
    const s = this.get(id);
    return runJob(T('Backup of “{name}”', { name: s.name }), async (job) => {
      const p = this.proc(id);
      // Bedrock: nur Welten und Einstellungen (die Programmdateien lädt ein Update ohnehin neu)
      if (this.isBedrock(s)) {
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const file = path.join(this.backupDir(id), `${stamp}${label ? '-' + slug(label) : ''}.zip`);
        job.progress(20, T('Backing up worlds and settings …'));
        await this.bedrock.backupTo(id, file);
        job.log(T('Saved: {file}', { file }));
        return { file: path.basename(file) };
      }
      const running = !!p.child;
      if (running) {
        job.status(T('Pausing saving …'));
        p.write('save-off');
        p.write('save-all flush');
        await new Promise((r) => setTimeout(r, 4000));
      }
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const file = path.join(this.backupDir(id), `${stamp}${label ? '-' + slug(label) : ''}.zip`);
      job.progress(20, T('Creating archive ({fmtBytes}) …', { fmtBytes: fmtBytes(dirSize(this.dir(id))) }));
      try {
        await zipDir(this.dir(id), file, { exclude: ['session.lock', './cache', './server.jar.alt'] });
      } finally {
        if (running && p.child) p.write('save-on');
      }
      job.log(T('Saved: {file}', { file }));
      return { file: path.basename(file) };
    });
  }

  restore(id, file) {
    const s = this.get(id);
    if (this.proc(id).isRunning()) throw Object.assign(new Error(T('Please stop the server first.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'stop' } });
    const zip = path.join(this.backupDir(id), path.basename(file));
    if (!fs.existsSync(zip)) throw new Error(T('Backup not found.'));
    return runJob(T('Restore backup for “{name}”', { name: s.name }), async (job) => {
      job.progress(5, T('Safety backup of the current state …'));
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      if (this.isBedrock(s)) {
        await this.bedrock.backupTo(id, path.join(this.backupDir(id), `${stamp}-vor-wiederherstellung.zip`));
        job.progress(50, T('Replacing worlds and settings …'));
        await this.bedrock.restoreFrom(id, zip);
        return { ok: true };
      }
      await zipDir(this.dir(id), path.join(this.backupDir(id), `${stamp}-vor-wiederherstellung.zip`), { exclude: ['session.lock'] });
      job.progress(50, T('Replacing files …'));
      const dir = this.dir(id);
      for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      await unzipTo(zip, dir);
      return { ok: true };
    });
  }

  /* ---------- Plugins ---------- */
  /**
   * Letzte Änderung je Plugin: wann kam eine neue Version oder eine neue JAR desselben Plugins (auch mit anderem
   * Dateinamen)? Gemerkt in <plugins>/.hostwerk-changes.json – beim ersten Mal zählt das Dateidatum.
   * Ergänzt changedAt und prevVersion an jedem Eintrag.
   */
  trackPluginChanges(dir, list) {
    const file = path.join(dir, '.hostwerk-changes.json');
    let rec = {}; try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* neu */ }
    let dirty = false;
    for (const p of list) {
      const key = String(p.name || p.file).toLowerCase();
      const base = p.file.replace(/\.disabled$/i, '');
      const sig = `${base}|${p.version || ''}|${p.size}`;
      const r = rec[key];
      if (!r) { let at = Date.now(); try { at = fs.statSync(path.join(dir, p.file)).mtimeMs; } catch { /* egal */ } rec[key] = { sig, version: p.version || null, at }; dirty = true; }
      else if (r.sig !== sig) { rec[key] = { sig, version: p.version || null, at: Date.now(), prevVersion: r.version !== (p.version || null) ? r.version : r.prevVersion || null }; dirty = true; }
      p.changedAt = rec[key].at;
      p.prevVersion = rec[key].prevVersion || null;
    }
    if (dirty) { try { fs.writeFileSync(file, JSON.stringify(rec, null, 1)); } catch { /* schreibgeschützt */ } }
  }

  async plugins(id) {
    const d = this.addonDir(id);
    if (!fs.existsSync(d)) return [];
    const out = [];
    for (const f of fs.readdirSync(d)) {
      if (!/\.jar(\.disabled)?$/i.test(f)) continue;
      const full = path.join(d, f);
      const meta = await this.readMeta(full);
      out.push({ file: f, enabled: !/\.disabled$/i.test(f), size: fs.statSync(full).size, ...(meta || { name: f.replace(/\.jar(\.disabled)?$/i, '') }) });
    }
    // Hostwerk-Bridge aktuell halten (gehört zu Hostwerk; bei gestopptem Server gefahrlos)
    if (!this.proc(id).isRunning() && out.some((p) => /^hostwerkbridge\.jar$/i.test(p.file))) { try { if (this.live.ensureBridge(id)) { const b = out.find((p) => /^hostwerkbridge\.jar$/i.test(p.file)); const full = path.join(d, b.file); Object.assign(b, { size: fs.statSync(full).size, ...((await this.readMeta(full)) || {}) }); } } catch { /* egal */ } }
    try { this.live.syncBridge(id); } catch { /* egal */ }
    // Quellen ohne Zutun verknüpfen (Hostwerk, eigenes Projekt, plugin.yml) – ohne Netz; ein neues unbekanntes Plugin sucht Projekte neu
    try { await this.sources.freshenProjects(id, out); } catch { /* egal */ }
    try { this.sources.lastSuggestions.set(id, this.sources.autoLink(id, out)); } catch { /* egal */ }
    // Herkunft immer mitliefern (Marktplatz, verknüpfte Quelle oder von Hand)
    let origins = {}; try { origins = this.sources.origins(id); } catch { /* egal */ }
    for (const p of out) p.origin = origins[p.file.replace(/\.disabled$/i, '')] || { source: 'manual', label: T('Manually'), page: null };
    // Ordner mit Einstellungen und Daten (für den Knopf „Ordner“): plugins/<Name>/ bzw. bei Mods config/<modid…>/
    const isMods = path.basename(d) === 'mods';
    const cfgRoot = isMods ? path.join(this.dir(id), 'config') : d;
    let dirs = [];
    try { dirs = fs.readdirSync(cfgRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* keiner */ }
    const squash = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const p of out) {
      const want = squash(p.name);
      const hit = want && (dirs.find((n) => n.toLowerCase() === String(p.name).toLowerCase()) || dirs.find((n) => squash(n) === want) || (isMods ? dirs.find((n) => want.startsWith(squash(n)) && squash(n).length >= 4) : null));
      p.dataDir = hit ? `${isMods ? 'config' : 'plugins'}/${hit}` : null;
    }
    this.trackPluginChanges(d, out);
    // Eigenes Symbol aus der JAR (hostwerk-icon.* bzw. Mod-Logo) – die Oberfläche lädt es über /plugins/icon
    const { iconEntry } = require('./pluginicon');
    for (const p of out) { if (await this.jarCache.get(path.join(d, p.file), 'icon', () => iconEntry(path.join(d, p.file)).catch(() => null))) p.jarIcon = `/api/mc/servers/${encodeURIComponent(id)}/plugins/icon?file=${encodeURIComponent(p.file)}&v=${p.changedAt || 0}`; }
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async modrinthSearch(id, query) {
    const s = this.get(id);
    const loaders = (providers[s.type] && providers[s.type].loaders) || ['paper', 'spigot', 'bukkit'];
    const facets = [[`project_type:${this.content(s) === 'mods' ? 'mod' : 'plugin'}`], loaders.map((l) => `categories:${l}`)];
    if (s.version && !['custom', 'velocity'].includes(s.type)) facets.push([`versions:${s.version}`]);
    const url = `https://api.modrinth.com/v2/search?limit=24&index=${query ? 'relevance' : 'downloads'}&query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
    // Letztes gutes Ergebnis merken: ist Modrinth langsam oder weg, zeigt Hostwerk die vorigen Treffer statt eines Fehlers
    this.searchCache = this.searchCache || new Map();
    let j;
    try { j = await fetchJson(url); this.searchCache.set(url, j); if (this.searchCache.size > 60) this.searchCache.delete(this.searchCache.keys().next().value); } catch (e) {
      if (this.searchCache.has(url)) j = this.searchCache.get(url); else throw new Error(T('The marketplace (Modrinth) isn\'t reachable right now – {v1}', { v1: require('./hw').core('humanize').humanize(e) }));
    }
    return j.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, downloads: h.downloads, author: h.author, categories: h.display_categories || h.categories }));
  }

  modrinthInstall(id, projectId) {
    const s = this.get(id);
    return runJob(T('Install plugin'), async (job) => {
      const loaders = (providers[s.type] && providers[s.type].loaders) || ['paper', 'spigot', 'bukkit'];
      const q = `loaders=${encodeURIComponent(JSON.stringify(loaders))}` + (s.version && !['custom', 'velocity'].includes(s.type) ? `&game_versions=${encodeURIComponent(JSON.stringify([s.version]))}` : '');
      const versions = await fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${q}`);
      const v = versions[0];
      if (!v) throw new Error(T('No matching plugin version found for {version}.', { version: s.version }));
      const file = v.files.find((f) => f.primary) || v.files[0];
      const d = this.addonDir(id);
      fs.mkdirSync(d, { recursive: true });
      job.log(`${v.name} (${v.version_number})`);
      await downloadFile(file.url, path.join(d, path.basename(file.filename)), { sha1: file.hashes && file.hashes.sha1, onProgress: (r, t) => job.progress(t ? (r / t) * 100 : 50, T('Download {filename}', { filename: file.filename })) });
      return { file: file.filename, needsRestart: this.proc(id).isRunning() };
    });
  }

  /* ---------- Plugin-Updates (Modrinth erkennt Plugins am Datei-Hash) ---------- */
  async pluginUpdates(id) {
    const s = this.get(id);
    const d = this.addonDir(id);
    if (!fs.existsSync(d)) return [];
    const files = fs.readdirSync(d).filter((f) => /\.jar(\.disabled)?$/i.test(f));
    if (!files.length) return [];
    const hashes = {};
    for (const f of files) hashes[await this.jarSha1(path.join(d, f))] = f;
    const post = async (url, body) => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': APP_UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(T('Modrinth responds with {status}', { status: res.status }));
      return res.json();
    };
    const loaders = (providers[s.type] && providers[s.type].loaders) || ['paper', 'spigot', 'bukkit'];
    const [current, latest] = await Promise.all([
      post('https://api.modrinth.com/v2/version_files', { hashes: Object.keys(hashes), algorithm: 'sha1' }),
      post('https://api.modrinth.com/v2/version_files/update', { hashes: Object.keys(hashes), algorithm: 'sha1', loaders, ...(s.version && !['custom', 'velocity'].includes(s.type) ? { game_versions: [s.version] } : {}) }),
    ]);
    const out = [];
    for (const [hash, file] of Object.entries(hashes)) {
      const cur = current[hash];
      const next = latest[hash];
      if (!cur) { out.push({ file, known: false }); continue; }
      const f = next && (next.files.find((x) => x.primary) || next.files[0]);
      out.push({ file, known: true, projectId: cur.project_id, current: cur.version_number, latest: next ? next.version_number : cur.version_number, update: !!(next && next.id !== cur.id && f), name: next ? next.name : cur.name });
    }
    // Aus Hangar installierte Plugins kennt Modrinth nicht – dort über die Merkliste des Marktplatzes prüfen
    const hangar = out.some((p) => !p.known) ? await this.market.hangarUpdates(id).catch(() => []) : [];
    const src = this.market.sources(id);
    /*
     * Von Hand hinzugefügte Plugins, die Modrinth am Datei-Hash erkennt (z. B. BlueMap aus einem Download), bekommen ihre
     * Quelle automatisch – ohne Namensraten, nur bei exakt gleicher Datei. So zeigt die Liste „Modrinth“ und Updates laufen
     * wie bei Marktplatz-Plugins. Eigene Projekte, verknüpfte Quellen und bewusst entkoppelte Plugins bleiben unberührt.
     */
    let learned = false;
    for (const p of out) {
      const base = p.file.replace(/\.disabled$/i, '');
      if (!p.known || !p.projectId || src[base]) continue;
      src[base] = { source: 'modrinth', id: p.projectId, title: p.name || base.replace(/\.jar$/i, ''), version: p.current, linkedAt: Date.now(), auto: true, identified: 'hash' };
      learned = true;
    }
    // Schon in plugins/update/ bereitgelegt (Server lief) → kein offenes Update mehr; nach dem Neustart ist es die aktuelle Version
    for (const p of out) {
      const x = src[p.file.replace(/\.disabled$/i, '')];
      if (!x || !x.pending) continue;
      if (p.current === x.pending) { delete x.pending; learned = true; } else if (p.latest === x.pending) { p.update = false; p.pending = x.pending; }
    }
    for (const q of this.live.pendingList(id)) {
      const p = out.find((x) => x.file === q.replace || x.file === q.file);
      if (p) { p.update = false; p.pending = q.version || p.latest; }
    }
    if (learned) this.market.saveSources(id, src);
    // Verknüpfte Quellen (GitHub, SpigotMC, Jenkins, Link): letzte Prüfung der Quellen-Verwaltung
    const ext = out.some((p) => !p.known && src[p.file.replace(/\.disabled$/i, '')] && this.sources.isExternal(src[p.file.replace(/\.disabled$/i, '')])) ? await this.sources.check(id).catch(() => []) : [];
    for (const p of out) {
      const base = p.file.replace(/\.disabled$/i, '');
      const e = ext.find((x) => x.file === base);
      if (!p.known && e && !e.error) Object.assign(p, { known: true, source: e.source, current: e.current, latest: e.latest, update: !!e.update && !e.external, name: e.name, external: e.external, page: e.page });
      if (p.known || !src[base] || src[base].source !== 'hangar') continue;
      const u = hangar.find((x) => x.file === base);
      Object.assign(p, { known: true, source: 'hangar', hangarId: src[base].id, current: src[base].version, latest: u ? u.latest : src[base].version, update: !!u, name: src[base].title });
    }
    return out;
  }

  /**
   * Eine neue Plugin-/Mod-JAR sicher einspielen – der eine Weg für alle Updates (Modrinth, Hangar, GitHub, eigene Projekte …).
   * tmp = heruntergeladene Datei (wird verschoben). Server aus → direkt ersetzen. Server läuft → Live-Austausch über die
   * HostwerkBridge (nach Prüfung der JAR: ZIP, plugin.yml, gleicher Plugin-Name); geht das nicht, wird das Update eingereiht
   * und beim nächsten Stopp/Start eingespielt – nie ein erzwungener Neustart, nie „Datei gesperrt“ (EPERM unter Windows).
   * Liefert { mode: 'copy'|'hot'|'queued', file, text }.
   */
  async placeAddon(id, tmp, { finalName, replace = null, disabled = false } = {}) {
    const d = this.addonDir(id);
    fs.mkdirSync(d, { recursive: true });
    finalName = path.basename(finalName);
    const mods = this.content(this.get(id)) === 'mods';
    const head = Buffer.alloc(2); const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
    if (head.toString() !== 'PK') { fs.rmSync(tmp, { force: true }); throw new Error(T('The download isn\'t a JAR file – probably a web page (sign-in/external download needed).')); }
    const move = (a, b) => { try { fs.renameSync(a, b); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(a, b); fs.rmSync(a, { force: true }); } };
    const running = this.proc(id).isRunning();
    // Deaktivierte Plugins sind nicht geladen (keine Sperre) – und bei gestopptem Mod-Server ist auch nichts gesperrt
    if (disabled || (mods && !running)) {
      const target = path.join(d, finalName + (disabled ? '.disabled' : ''));
      if (replace) for (const f of [replace, replace + '.disabled']) if (path.join(d, f) !== target) fs.rmSync(path.join(d, f), { force: true });
      move(tmp, target);
      return { mode: 'copy', file: path.basename(target), text: T('replaced') };
    }
    // Eingangsordner unter dem endgültigen Dateinamen (die Bridge/Warteschlange übernimmt den Namen)
    const inbox = path.join(this.dir(id), 'plugins', '.hostwerk', 'incoming');
    fs.mkdirSync(inbox, { recursive: true });
    const jar = path.join(inbox, finalName);
    move(tmp, jar);
    try {
      if (mods) {
        // Mods lassen sich nicht im laufenden Server tauschen → einreihen
        this.live.queue(id, jar, { name: (replace || finalName).replace(/.jar$/i, ''), replace, dir: 'mods' });
        return { mode: 'queued', file: finalName, text: T('waiting for the next stop/restart') };
      }
      let expectName = null;
      if (replace && fs.existsSync(path.join(d, replace))) { try { const m = await this.readMeta(path.join(d, replace)); expectName = m && m.name; } catch { /* unbekannt */ } }
      const r = await this.live.deploy(id, jar, { fallback: 'queue', source: 'Update', expectName }).promise;
      // Alter Dateiname, falls die Bridge/Warteschlange ihn nicht schon über den Plugin-Namen erfasst hat
      if (r.mode !== 'queued' && replace && replace !== finalName) { try { fs.rmSync(path.join(d, replace), { force: true }); } catch { /* beim nächsten Stopp */ } }
      if (r.mode === 'queued' && replace) { const list = this.live.pendingList(id); const e = list.find((x) => x.file === finalName); if (e) { e.replace = replace; this.live.savePending(id, list); } }
      return { mode: r.mode, file: finalName, text: r.text };
    } finally { fs.rmSync(jar, { force: true }); }
  }

  updatePlugins(id, only) {
    return runJob(T('Update plugins'), async (job) => {
      const want = Array.isArray(only) ? new Set(only) : only ? new Set([only]) : null; // eine Datei, eine Auswahl oder alle
      const list = (await this.pluginUpdates(id)).filter((p) => p.update && (!want || want.has(p.file)));
      if (!list.length) return { updated: 0 };
      const s = this.get(id);
      const d = this.addonDir(id);
      const loaders = (providers[s.type] && providers[s.type].loaders) || ['paper', 'spigot', 'bukkit'];
      for (const [i, p] of list.entries()) {
        job.progress((i / list.length) * 100, `${p.file} → ${p.latest}`);
        if (p.source === 'hangar') { await this.market.install(id, { source: 'hangar', id: p.hangarId }).promise; job.log(`✓ ${p.file} → ${p.latest}`); continue; }
        if (['github', 'spigot', 'jenkins', 'url', 'project', 'hostwerk'].includes(p.source)) { await this.sources.update(id, p.file).promise; job.log(`✓ ${p.file} → ${p.latest}`); continue; }
        const q = `loaders=${encodeURIComponent(JSON.stringify(loaders))}` + (s.version && !['custom', 'velocity'].includes(s.type) ? `&game_versions=${encodeURIComponent(JSON.stringify([s.version]))}` : '');
        const v = (await fetchJson(`https://api.modrinth.com/v2/project/${encodeURIComponent(p.projectId)}/version?${q}`))[0];
        if (!v) continue;
        const f = v.files.find((x) => x.primary) || v.files[0];
        const disabled = /\.disabled$/i.test(p.file);
        const base = p.file.replace(/\.disabled$/i, '');
        const srcAll = this.market.sources(id);
        const newBase = path.basename(f.filename);
        const tmp = path.join(os.tmpdir(), `hw-plugin-${process.pid}-${Date.now()}.jar`);
        await downloadFile(f.url, tmp, { sha1: f.hashes && f.hashes.sha1 });
        const r = await this.placeAddon(id, tmp, { finalName: newBase, replace: base, disabled });
        // Quelle unter dem neuen Dateinamen weiterführen (sonst wäre das Plugin nach dem Update wieder „von Hand“).
        // Eingereiht: alte Datei liegt noch – ihr Eintrag merkt sich die wartende Version, der neue ist schon vorbereitet.
        const prev = srcAll[base] || { source: 'modrinth', id: p.projectId, title: p.name, auto: true };
        const rec = { ...prev, id: p.projectId || prev.id, version: v.version_number, versionId: v.id, updatedAt: Date.now(), pending: undefined };
        if (r.mode === 'queued') { srcAll[base] = { ...prev, pending: v.version_number }; if (newBase !== base) srcAll[newBase] = rec; }
        else { if (newBase !== base) delete srcAll[base]; srcAll[newBase] = rec; }
        this.market.saveSources(id, srcAll);
        job.log(r.mode === 'queued' ? T('✓ {file} → {version_number} (waiting – will be applied at the next stop or restart)', { file: p.file, version_number: v.version_number }) : r.mode === 'hot' ? T('✓ {file} → {newBase} (swapped live, no restart)', { file: p.file, newBase }) : `✓ ${p.file} → ${newBase}`);
      }
      return { updated: list.length, needsRestart: false, queued: this.live.pendingList(id).length };
    }, { key: 'mc-plugin-update-' + id });
  }

  /* ---------- Welten, Server-Symbol, Gamerules ---------- */
  /** Ordner einer Welt (Bedrock: worlds/<name>). */
  worldPath(id, name) { return this.isBedrock(this.get(id)) ? this.bedrock.worldPath(id, name) : path.join(this.dir(id), name); }
  worlds(id) {
    if (this.isBedrock(this.get(id))) return this.bedrock.worlds(id);
    const dir = this.dir(id);
    let props = {};
    try { props = parseProps(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8')); } catch { /* egal */ }
    const base = props['level-name'] || 'world';
    const out = [];
    for (const d of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (!d.isDirectory()) continue;
      const full = path.join(dir, d.name);
      const dims = worldDims(full);
      if (!fs.existsSync(path.join(full, 'level.dat')) && !dims.length) continue;
      // Paper bis 1.21 teilt die Welt in eigene Ordner (world_nether mit DIM-1 drin) – der Ordner zählt dann als Nether
      const only = dims.length === 1 ? dims[0].id : null;
      const kind = d.name === base ? 'overworld' : only === 'minecraft:the_nether' ? 'nether' : only === 'minecraft:the_end' ? 'end' : 'other';
      out.push({ name: d.name, kind, size: dirSize(full), main: d.name === base, dims: dims.map((x) => ({ ...x, size: x.path ? dirSize(path.join(full, x.path)) : null })) });
    }
    return { levelName: base, seed: props['level-seed'] || null, worlds: out.sort((a, b) => (b.main - a.main) || a.name.localeCompare(b.name)) };
  }

  /** Welt (ganzer Ordner) oder nur eine Dimension daraus (dim = z. B. minecraft:the_nether) zurücksetzen. */
  resetWorld(id, name, dim = null) {
    if (this.proc(id).isRunning()) throw Object.assign(new Error(T('Please stop the server first.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'stop' } });
    const w = this.worlds(id).worlds.find((x) => x.name === name);
    if (!w) throw Object.assign(new Error(T('World not found')), { status: 404 });
    const d = dim ? (w.dims || []).find((x) => x.id === dim) : null;
    if (dim && !(d && d.path)) throw Object.assign(new Error(T('This dimension can’t be reset on its own – reset the whole world.')), { status: 400 });
    const label = d ? `${name} · ${dim}` : name;
    return runJob(T('Reset world “{label}”', { label }), async (job) => {
      job.progress(10, T('Safety backup …'));
      await this.backup(id, `vor-reset-${(d ? `${name}-${dim.split(':').pop()}` : name).replace(/[^\w.-]+/g, '-')}`).promise;
      fs.rmSync(d ? path.join(this.worldPath(id, name), d.path) : this.worldPath(id, name), { recursive: true, force: true });
      job.log(T('{v1} deleted – it is recreated at the next start.', { v1: d ? T('Dimension {dim} in {name}', { dim, name }) : T('World {name}', { name }) }));
      return { ok: true };
    });
  }

  async worldZip(id, name) {
    const w = this.worlds(id).worlds.find((x) => x.name === name);
    if (!w) throw Object.assign(new Error(T('World not found')), { status: 404 });
    const out = path.join(this.paths.cache, `${slug(this.get(id).name)}-${name}-${Date.now()}.zip`);
    if (this.isBedrock(this.get(id))) { await this.bedrock.withHold(id, () => zipDir(this.worldPath(id, name), out)); return out; }
    if (this.proc(id).child) { this.command(id, 'save-all flush'); await new Promise((r) => setTimeout(r, 2500)); }
    await zipDir(path.join(this.dir(id), name), out, { exclude: ['session.lock'] });
    return out;
  }

  /**
   * Spielregeln. Minecraft 26+ speichert sie in world/dimensions/minecraft/overworld/data/minecraft/game_rules.dat
   * (Namen wie minecraft:keep_inventory), ältere Versionen in level.dat (Data.GameRules, keepInventory). Beide Quellen
   * gehen auch bei gestopptem Server; läuft er, werden die Werte zusätzlich live abgefragt (die Datei hinkt bis zum
   * nächsten Speichern nach).
   */
  gamerulesFile(id) {
    // Bedrock speichert die Welt in LevelDB – Regeln nur live per Befehl
    if (this.isBedrock(this.get(id))) return null;
    const dir = this.dir(id);
    let props = {};
    try { props = parseProps(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8')); } catch { /* egal */ }
    const world = path.join(dir, props['level-name'] || 'world');
    const modern = path.join(world, 'dimensions', 'minecraft', 'overworld', 'data', 'minecraft', 'game_rules.dat');
    if (fs.existsSync(modern)) return { file: modern, modern: true };
    const legacy = path.join(world, 'level.dat');
    return fs.existsSync(legacy) ? { file: legacy, modern: false } : null;
  }
  readGamerules(id) {
    const src = this.gamerulesFile(id);
    if (!src) return { rules: [], modern: null };
    const nbt = require('./nbt');
    const out = [];
    if (src.modern) {
      const doc = nbt.read(src.file);
      const data = (doc.root.v.find(([k]) => k === 'data') || [])[1];
      for (const [name, node] of (data && data.v) || []) {
        if (node.t === nbt.T.BYTE) out.push({ name, value: node.v ? 'true' : 'false', type: 'bool' });
        else if ([nbt.T.INT, nbt.T.SHORT, nbt.T.LONG].includes(node.t)) out.push({ name, value: String(node.v), type: 'int' });
      }
    } else {
      for (const [name, v] of Object.entries(nbt.readGameRules(src.file))) out.push({ name, value: v, type: /^(true|false)$/.test(v) ? 'bool' : 'int' });
    }
    return { rules: out, modern: src.modern };
  }
  async gamerules(id) {
    const p = this.proc(id);
    const fromFile = this.readGamerules(id);
    const rules = fromFile.rules;
    let live = false;
    if (p.child && p.extra.ready && rules.length) {
      const mark = p.logs.length;
      for (const r of rules) p.write(`gamerule ${r.name}`);
      await new Promise((r) => setTimeout(r, Math.min(4000, 800 + rules.length * 40)));
      const got = {};
      for (const e of p.logs.slice(mark)) {
        const m = e.l.replace(/\x1b\[[0-9;]*m/g, '').match(/(?:Game ?rule|Spielregel) (\S+) (?:is currently set to|ist derzeit auf|has value):?\s*(\S+)/i);
        if (m) got[m[1]] = m[2].replace(/[.,]$/, '');
      }
      // Abfragen nicht im sichtbaren Protokoll lassen
      p.logs.splice(mark, p.logs.length - mark, ...p.logs.slice(mark).filter((e) => !/(Game ?rule|Spielregel) \S+ (is currently set to|ist derzeit|has value)|Incorrect argument|Unknown or incomplete|Unknown game rule/i.test(e.l)));
      if (Object.keys(got).length) { live = true; for (const r of rules) { const v = got[r.name] ?? got[r.name.replace(/^minecraft:/, '')]; if (v !== undefined) r.value = v; } }
    }
    return { rules, modern: fromFile.modern, live, running: !!p.child };
  }
  /** Spielregel setzen: läuft der Server per Befehl, sonst direkt in der Weltdatei. */
  setGamerule(id, name, value) {
    if (!/^[\w:.-]+$/.test(String(name))) throw new Error(T('Invalid rule name.'));
    const p = this.proc(id);
    const v = typeof value === 'boolean' ? String(value) : String(value).trim();
    if (!/^(true|false|-?\d+)$/.test(v)) throw new Error(T('Value must be true/false or a number.'));
    if (p.child) { this.command(id, `gamerule ${name} ${v}`); return { live: true }; }
    const src = this.gamerulesFile(id);
    if (!src) throw new Error(T('No world yet – start the server once, then the rules can be changed.'));
    const nbt = require('./nbt');
    if (src.modern) {
      const doc = nbt.read(src.file);
      const data = (doc.root.v.find(([k]) => k === 'data') || [])[1];
      if (!data) throw new Error(T('Unknown format of the game rule file.'));
      const key = name.includes(':') ? name : `minecraft:${name}`;
      const cur = data.v.find(([k]) => k === key);
      const node = /^(true|false)$/.test(v) ? { t: nbt.T.BYTE, v: v === 'true' ? 1 : 0 } : { t: cur && cur[1].t !== nbt.T.BYTE ? cur[1].t : nbt.T.INT, v: Number(v) };
      if (cur) cur[1] = node; else data.v.push([key, node]);
      nbt.write(src.file, doc);
    } else nbt.writeGameRule(src.file, name, v);
    return { live: false };
  }

  /* ---------- Karte (BlueMap) ---------- */
  /** BlueMap-Einstellungen: als Plugin unter plugins/BlueMap, als Mod unter config/bluemap. */
  mapConfDir(id) { return this.content(this.get(id)) === 'mods' ? path.join(this.dir(id), 'config', 'bluemap') : path.join(this.dir(id), 'plugins', 'BlueMap'); }
  mapStatus(id) {
    const s = this.get(id);
    const supported = providers[s.type] ? providers[s.type].plugins !== false : true;
    const pdir = this.addonDir(id);
    const jar = fs.existsSync(pdir) ? fs.readdirSync(pdir).find((f) => /bluemap.*\.jar$/i.test(f)) : null;
    const confDir = this.mapConfDir(id);
    let port = 8100;
    let accepted = false;
    try { port = Number((fs.readFileSync(path.join(confDir, 'webserver.conf'), 'utf8').match(/^\s*port\s*[:=]\s*(\d+)/m) || [])[1]) || 8100; } catch { /* Standard */ }
    try { accepted = /^\s*accept-download\s*[:=]\s*true/m.test(fs.readFileSync(path.join(confDir, 'core.conf'), 'utf8')); } catch { /* noch nicht */ }
    return { supported, installed: !!jar, jar, port, accepted, url: `http://localhost:${port}/`, running: !!this.proc(id).child };
  }

  setupMap(id) {
    const s = this.get(id);
    return runJob(T('Set up map for “{name}”', { name: s.name }), async (job) => {
      const st = this.mapStatus(id);
      if (!st.supported) throw new Error(T('Vanilla servers do not support plugins – switch to Paper or Purpur under “Version”.'));
      if (!st.installed) {
        job.progress(10, T('Downloading BlueMap from Modrinth …'));
        await this.modrinthInstall(id, 'bluemap').promise;
      }
      const confDir = this.mapConfDir(id);
      fs.mkdirSync(confDir, { recursive: true });
      // Download der Minecraft-Ressourcen erlauben (BlueMap fragt das sonst beim ersten Start ab)
      const core = path.join(confDir, 'core.conf');
      if (fs.existsSync(core)) fs.writeFileSync(core, fs.readFileSync(core, 'utf8').replace(/^(\s*accept-download\s*[:=]\s*)false/m, '$1true'));
      else fs.writeFileSync(core, '# Created by Hostwerk – BlueMap adds missing settings itself.\naccept-download: true\n');
      const web = path.join(confDir, 'webserver.conf');
      if (!fs.existsSync(web)) {
        const used = this.list().filter((x) => x.id !== id).map((x) => this.mapStatus(x.id).port);
        const port = await findFreePort(8100, used);
        fs.writeFileSync(web, `# Created by Hostwerk\nenabled: true\nwebroot: "bluemap/web"\nport: ${port}\n`);
      }
      const running = !!this.proc(id).child;
      return { ...this.mapStatus(id), needsRestart: running };
    }, { key: 'mc-map-' + id });
  }

  /* ---------- Server-Prüfung („Tests“ für Minecraft) ---------- */
  selfTest(id) {
    const mgr = this;
    const s = this.get(id);
    this.selfTesting = this.selfTesting || new Set();
    return runJob(T('Server check: {name}', { name: s.name }), async (job) => {
      const p = this.proc(id);
      const wasRunning = !!p.child;
      this.selfTesting.add(id);
      const checks = [];
      const add = (name, status, detail = '') => { checks.push({ name, status, detail }); job.log(`${status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗'} ${name}${detail ? ' – ' + detail : ''}`); };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const t0 = Date.now();
      if (!wasRunning) {
        job.progress(5, T('Starting server …'));
        try { await this.start(id); } catch (e) { add(T('Server starts'), 'fail', e.message); return finish(); }
      }
      job.progress(15, T('Waiting until the server is ready …'));
      for (let i = 0; i < 360 && !p.extra.ready && p.child; i++) await wait(500);
      const since = p.startedAt || t0;
      const logs = () => p.logs.filter((e) => e.t >= since).map((e) => e.l.replace(/\x1b\[[0-9;]*m/g, ''));
      if (!p.child) { add(T('Server starts'), 'fail', T('The process ended – see the console.')); return finish(); }
      if (!p.extra.ready) { add(T('Server starts'), 'fail', T('Not ready after 3 minutes (“Done” missing).')); return finish(); }
      const done = logs().map((l) => l.match(/Done \(([\d.,]+)s\)!/)).find(Boolean);
      add(T('Server starts'), 'ok', done ? T('ready after {sec} s', { sec: done[1].replace(',', '.') }) : T('ready'));
      if (mgr.isBedrock(s)) {
        // Bedrock: keine Plugins, kein „version“-Befehl – Protokoll und Antwort auf dem UDP-Port
        const errs = logs().filter((l) => /\b(ERROR|SEVERE)\b|\[error\]/i.test(l) && !/^>/.test(l));
        add(T('Log without errors'), errs.length === 0 ? 'ok' : errs.length < 5 ? 'warn' : 'fail', errs.length ? T('{n} error line(s), e.g.: {line}', { n: errs.length, line: errs[0].slice(0, 160) }) : T('no errors since the start'));
        // RakNet (UDP) oder NetherNet (GET /v1/join über TCP); NetherNet ohne Antwort: Weg bei Mojang nicht beschrieben → „unbekannt“
        const pong = await bedrockStatus(s.port, '127.0.0.1', 3000).catch(() => null);
        if (pong) mgr.bedrock.seen(s.id, p, pong);
        const nn = (s.bdsNet || {}).transport === 'nethernet';
        add(T('Port reachable'), pong ? 'ok' : nn ? 'warn' : 'fail', pong ? `${pong.via === 'nethernet' ? `TCP ${s.port} (NetherNet)` : `UDP ${s.port}`} · Bedrock ${pong.version}` : nn ? T('NetherNet: no answer on TCP {port} – state unknown (Mojang documents no status query)', { port: s.port }) : `UDP ${s.port}`);
        const memB = p.stats && p.stats.memory ? Math.round(p.stats.memory / 1048576) : null;
        if (memB) add(T('Memory'), 'ok', T('{mb} MB used', { mb: memB }));
        return finish();
      }

      job.progress(45, T('Sending commands …'));
      const mark = p.logs.length;
      // Mod-Server kennen den Befehl „plugins“ nicht – dort nur Version und Start prüfen
      const pluginsOk = (providers[s.type] ? providers[s.type].plugins !== false : true) && this.content(s) !== 'mods';
      this.command(id, 'version');
      if (pluginsOk) this.command(id, 'plugins');
      if (['paper', 'purpur', 'folia'].includes(s.type)) this.command(id, 'tps');
      await wait(4000);
      const answer = p.logs.slice(mark).map((e) => e.l.replace(/\x1b\[[0-9;]*m/g, '').replace(/§./g, ''));

      // Plugins
      if (pluginsOk) {
        const all = logs();
        const failed = [];
        for (const l of all) {
          let m = l.match(/Could not load '?plugins[\\/]([^'\s]+)/i) || l.match(/Error occurred while enabling (\S+)/i) || l.match(/Could not load plugin '?([^'\s]+)/i);
          if (m && !failed.includes(m[1])) failed.push(m[1]);
        }
        const count = (answer.join(' ').match(/Plugins \((\d+)\)/i) || [])[1];
        if (failed.length) add(T('Plugins load'), 'fail', T('Errors in: {list}', { list: failed.join(', ') }));
        else add(T('Plugins load'), 'ok', count !== undefined ? T('{n} plugin(s) active', { n: count }) : T('no load errors'));
      }
      // Fehler im Protokoll
      const errs = logs().filter((l) => /\b(ERROR|SEVERE)\b|Exception\b/.test(l) && !/^>/.test(l));
      add(T('Log without errors'), errs.length === 0 ? 'ok' : errs.length < 5 ? 'warn' : 'fail', errs.length ? T('{n} error line(s), e.g.: {line}', { n: errs.length, line: errs[0].slice(0, 160) }) : T('no errors since the start'));
      // TPS
      const tpsLine = answer.find((l) => /TPS from last 1m/.test(l));
      if (tpsLine) {
        const tps = Number((tpsLine.match(/1m, 5m, 15m:\s*\*?([\d.]+)/) || [])[1]);
        add(T('Performance (TPS)'), tps >= 19.5 ? 'ok' : tps >= 17 ? 'warn' : 'fail', T('{tps} of 20 ticks per second', { tps }));
      }
      // Arbeitsspeicher
      const mem = p.stats && p.stats.memory ? Math.round(p.stats.memory / 1048576) : null;
      if (mem) add(T('Memory'), mem < s.memMax * 1.15 ? 'ok' : 'warn', T('{mb} MB used, limit {max} MB', { mb: mem, max: s.memMax }));
      // Port erreichbar
      const portOk = await new Promise((resolve) => {
        const sock = require('net').connect({ port: s.port, host: '127.0.0.1' });
        const t = setTimeout(() => { sock.destroy(); resolve(false); }, 3000);
        sock.once('connect', () => { clearTimeout(t); sock.destroy(); resolve(true); });
        sock.once('error', () => { clearTimeout(t); resolve(false); });
      });
      add(T('Port reachable'), portOk ? 'ok' : 'fail', `localhost:${s.port}`);
      // Version
      const ver = answer.find((l) => /This server is running|Current:|version/i.test(l));
      if (ver) add('Version', 'ok', ver.replace(/^.*?(This server is running|Checking version.*?)/, '$1').slice(0, 140));
      return finish();

      async function finish() {
        mgr.selfTesting.delete(id);
        if (!wasRunning && p.child) { job.progress(92, T('Stopping server again …')); await mgr.stop(id).catch(() => {}); }
        const result = { at: Date.now(), ms: Date.now() - t0, checks, ok: checks.every((c) => c.status !== 'fail'), warnings: checks.filter((c) => c.status === 'warn').length };
        mgr.selfTests.set(id, result);
        return result;
      }
    }, { key: 'mc-selftest-' + id });
  }

  /* ---------- Spielerlisten ---------- */
  playerLists(id) {
    if (this.isBedrock(this.get(id))) return this.bedrock.lists(id);
    const dir = this.dir(id);
    const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return []; } };
    return { ops: read('ops.json'), whitelist: read('whitelist.json'), banned: read('banned-players.json'), bannedIps: read('banned-ips.json'), online: this.proc(id).extra.players || [] };
  }

  async remove(id) {
    const p = this.proc(id);
    if (p.isRunning()) throw Object.assign(new Error(T('Please stop the server first.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'stop' } });
    const list = this.list();
    const i = list.findIndex((s) => s.id === id);
    const dir = this.dir(id);
    const external = i >= 0 && !!list[i].externalDir;
    if (i >= 0) list.splice(i, 1);
    this.settings.save();
    // Übernommene Server am bisherigen Ort: nur den Eintrag entfernen, nie den Ordner des Nutzers
    if (!external) fs.rmSync(dir, { recursive: true, force: true });
    this.procs.delete(id);
  }

  routes(r, upload) {
    this.live.routes(r, upload);
    this.market.routes(r);
    this.network.routes(r);
    this.clientPack.routes(r);
    this.stats.routes(r);
    this.updates.routes(r);
    this.sources.routes(r);
    this.safeUpgrade.routes(r);
    this.tools.routes(r, upload);
    this.curseforge.routes(r);
    this.bedrock.routes(r);
    r.get('/mc/servers/:id/modpack/updates', async (req, res) => res.json(await this.modpackUpdates(req.params.id)));
    r.post('/mc/servers/:id/modpack/update', (req, res) => res.json({ job: this.updateModpack(req.params.id, req.body || {}).id }));
    r.get('/mc/types', (req, res) => res.json(Object.entries(providers).filter(([, p]) => !p.hidden).map(([id, p]) => ({ id, label: p.label, description: p.description, plugins: p.plugins !== false, content: p.content || 'plugins', edition: p.edition || 'java' }))));
    // Modpacks von Modrinth (Suche + Details der neuesten Version)
    r.get('/mc/modpacks', async (req, res) => res.json(await searchModpacks(String(req.query.q || ''), req.query.offset)));
    r.get('/mc/modpacks/:id', async (req, res) => { const v = await modpackVersion(req.params.id, req.query.version); res.json({ ...v, file: undefined, size: v.file && v.file.size, java: await javaFor(v.mc) }); });
    r.get('/mc/versions/:type', async (req, res) => {
      const p = providers[req.params.type];
      if (!p) throw new Error(T('Unknown type'));
      res.json(await p.versions());
    });
    r.get('/mc/java-for/:version', async (req, res) => res.json({ major: await javaFor(req.params.version) }));
    r.get('/mc/system', (req, res) => {
      // cpu = Auslastung des ganzen PCs (letzte Messung des Systemdiensts) – für „Server / System“ auf der Zustand-Kachel
      const h = this.ctx.system && this.ctx.system.history.length ? this.ctx.system.history[this.ctx.system.history.length - 1] : null;
      res.json({ totalMem: os.totalmem(), freeMem: os.freemem(), cpus: os.cpus().length, cpu: h ? h.cpu : null, lan: lanIps() });
    });
    r.post('/mc/upload-jar', upload.single('file'), (req, res) => {
      if (!req.file || !/\.jar$/i.test(req.file.originalname)) throw new Error(T('Please upload a .jar file.'));
      const id = crypto.randomUUID();
      const d = path.join(this.paths.cache, 'uploads');
      const file = path.join(d, id + '.jar');
      fs.renameSync(req.file.path, file);
      fs.writeFileSync(path.join(d, id + '.json'), JSON.stringify({ file, name: req.file.originalname }));
      res.json({ uploadId: id, name: req.file.originalname, size: req.file.size });
    });
    r.get('/mc/servers', (req, res) => res.json(this.list().map((s) => this.info(s))));
    r.post('/mc/servers', async (req, res) => res.json({ job: (await this.create(req.body || {})).id }));
    r.get('/mc/servers/:id', (req, res) => res.json(this.info(this.get(req.params.id))));
    r.put('/mc/servers/:id', (req, res) => {
      const s = this.get(req.params.id);
      const b = req.body || {};
      for (const k of ['name', 'jvmFlags', 'extraArgs']) if (typeof b[k] === 'string') s[k] = b[k];
      for (const k of ['memMin', 'memMax', 'javaMajor', 'port']) if (b[k] != null && Number(b[k]) > 0) s[k] = Number(b[k]);
      for (const k of ['autostart', 'autoRestart', 'autoCheck', 'autoPluginUpdates', 'autoServerUpdates']) if (typeof b[k] === 'boolean') s[k] = b[k];
      if (typeof b.javaPath === 'string') s.javaPath = b.javaPath.trim() || undefined;
      this.settings.save();
      res.json(this.info(s));
    });
    r.delete('/mc/servers/:id', async (req, res) => { await this.remove(req.params.id); res.json({ ok: true }); });
    r.post('/mc/servers/:id/start', async (req, res) => { await this.start(req.params.id); res.json(this.info(this.get(req.params.id))); });
    r.post('/mc/servers/:id/stop', async (req, res) => { await this.stop(req.params.id); res.json(this.info(this.get(req.params.id))); });
    r.post('/mc/servers/:id/restart', async (req, res) => { await this.restart(req.params.id); res.json(this.info(this.get(req.params.id))); });
    r.post('/mc/servers/:id/kill', async (req, res) => { await this.proc(req.params.id).kill(); res.json({ ok: true }); });
    r.post('/mc/servers/:id/command', (req, res) => { this.command(req.params.id, String(req.body.command || '')); res.json({ ok: true }); });
    r.get('/mc/servers/:id/logs', (req, res) => res.json(this.proc(req.params.id).logs));
    r.get('/mc/servers/:id/stats', (req, res) => res.json(this.proc(req.params.id).statsHistory));
    r.get('/mc/servers/:id/properties', (req, res) => res.json(this.properties(req.params.id)));
    r.put('/mc/servers/:id/properties', (req, res) => {
      const before = this.properties(req.params.id).motd;
      const out = this.setProperties(req.params.id, req.body || {});
      // MOTD geändert und Server läuft: gleich in der Serverliste zeigen (Bridge ab 1.2), nicht erst nach dem Neustart
      if (out.motd !== before && this.proc(req.params.id).child) this.applyMotdLive(req.params.id, out.motd).catch(() => {});
      res.json(out);
    });
    // Nur die Beschreibung: speichern und – wenn möglich – sofort live; live = false heißt „sichtbar nach Neustart“
    r.put('/mc/servers/:id/motd', async (req, res) => {
      const motd = String((req.body || {}).motd ?? '').replace(/[\r\n]+/g, '\\n');
      this.setProperties(req.params.id, { motd });
      const running = !!this.proc(req.params.id).child;
      const live = running ? await this.applyMotdLive(req.params.id, motd) : false;
      res.json({ ok: true, motd, running, live, bridgeNeeded: running && !live && !this.bridgeAt(req.params.id, '1.2') });
    });
    r.get('/mc/servers/:id/health', async (req, res) => res.json(await this.health(req.params.id, { full: req.query.full === '1' })));
    // Schnellaktion „Neustart mit Countdown“: Spieler werden im Chat gewarnt (volle Minuten, 30, 10 und die letzten 5 s)
    r.post('/mc/servers/:id/restart-warn', (req, res) => {
      const id = req.params.id;
      const secs = Math.max(0, Math.min(600, Math.round(Number((req.body || {}).seconds) || 0)));
      if (!this.proc(id).child) throw Object.assign(new Error(T('Server is not running.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'start' } });
      const job = runJob(T('Restart of “{name}” in {secs} s', { name: this.get(id).name, secs }), async (j) => {
        const steps = secs > 0 ? [secs, ...[540, 480, 420, 360, 300, 240, 180, 120, 60, 30, 10, 5, 4, 3, 2, 1].filter((x) => x < secs)] : [];
        for (let i = 0; i < steps.length; i++) {
          const sec = steps[i];
          const t = sec >= 60 && sec % 60 === 0 ? T(sec === 60 ? '{n} minute' : '{n} minutes', { n: sec / 60 }) : T(sec === 1 ? '{n} second' : '{n} seconds', { n: sec });
          try { this.command(id, `say ${sec > 10 ? '§e' : '§c'}${T('Server restarts in {t}.', { t })}`); } catch { return { cancelled: true }; }
          j.progress(Math.round((i / steps.length) * 80), T('Restart in {sec} s', { sec }));
          await new Promise((r) => setTimeout(r, (sec - (steps[i + 1] || 0)) * 1000));
        }
        await this.restart(id);
        return { ok: true };
      }, { key: 'mc-restart-warn-' + id });
      res.json({ job: job.id });
    });
    r.post('/mc/servers/:id/version', (req, res) => res.json({ job: this.changeVersion(req.params.id, req.body || {}).id }));
    r.get('/mc/servers/:id/backups', (req, res) => res.json(this.backups(req.params.id)));
    r.post('/mc/servers/:id/backups', (req, res) => res.json({ job: this.backup(req.params.id, req.body && req.body.label).id }));
    r.post('/mc/servers/:id/backups/restore', (req, res) => res.json({ job: this.restore(req.params.id, req.body.file).id }));
    r.delete('/mc/servers/:id/backups/:file', (req, res) => {
      fs.rmSync(path.join(this.backupDir(req.params.id), path.basename(req.params.file)), { force: true });
      res.json(this.backups(req.params.id));
    });
    r.get('/mc/servers/:id/backups/:file/download', (req, res) => {
      res.download(path.join(this.backupDir(req.params.id), path.basename(req.params.file)));
    });
    r.get('/mc/servers/:id/plugins', async (req, res) => res.json(await this.plugins(req.params.id)));
    r.get('/mc/servers/:id/hostwerk-plugins', async (req, res) => {
      const id = req.params.id;
      if (!this.live.supported(id)) return res.json([]);
      const jar = path.join(__dirname, 'bridge', 'HostwerkBridge.jar');
      const meta = (await this.readMeta(jar).catch(() => null)) || {};
      res.json([{ id: 'bridge', name: 'HostwerkBridge', version: meta.version || null, description: T('Connection to Hostwerk – plugin live updates without restarting the server. Part of Hostwerk and kept up to date with Hostwerk.'), icon: '/api/mc/hostwerk-plugins/bridge/icon', installed: this.live.bridgePresent(id), disabled: this.live.bridgeDisabled(id) }]);
    });
    r.get('/mc/hostwerk-plugins/bridge/icon', async (req, res) => {
      const hit = await require('./pluginicon').iconFile(path.join(__dirname, 'bridge', 'HostwerkBridge.jar'), this.ctx.paths.cache).catch(() => null);
      if (!hit) return res.status(404).end();
      res.setHeader('Content-Type', hit.type); res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.sendFile(hit.file);
    });
    r.get('/mc/servers/:id/plugins/icon', async (req, res) => {
      const file = path.basename(String(req.query.file || ''));
      if (!/.jar(.disabled)?$/i.test(file)) return res.status(400).end();
      const hit = await require('./pluginicon').iconFile(path.join(this.addonDir(req.params.id), file), this.ctx.paths.cache).catch(() => null);
      if (!hit) return res.status(404).end();
      res.setHeader('Content-Type', hit.type); res.setHeader('Cache-Control', 'private, max-age=86400'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.sendFile(hit.file);
    });
    r.post('/mc/servers/:id/plugins/toggle', async (req, res) => {
      const d = this.addonDir(req.params.id);
      const f = path.basename(req.body.file);
      const target = /\.disabled$/i.test(f) ? f.replace(/\.disabled$/i, '') : f + '.disabled';
      fs.renameSync(path.join(d, f), path.join(d, target));
      res.json(await this.plugins(req.params.id));
    });
    r.delete('/mc/servers/:id/plugins/:file', async (req, res) => {
      const dir = this.addonDir(req.params.id);
      fs.rmSync(path.join(dir, path.basename(req.params.file)), { force: true });
      // Auf Wunsch auch den Konfigurationsordner des Plugins (plugins/<Name>/) – standardmäßig bleibt er erhalten
      const cfgName = String(req.query.config || '').replace(/[\\/:*?"<>|]/g, '').trim();
      if (cfgName && cfgName !== '.' && cfgName !== '..') fs.rmSync(path.join(dir, cfgName), { recursive: true, force: true });
      res.json(await this.plugins(req.params.id));
    });
    r.post('/mc/servers/:id/plugins/upload', upload.array('files'), async (req, res) => {
      const id = req.params.id;
      const d = this.addonDir(id);
      fs.mkdirSync(d, { recursive: true });
      const placed = [];
      for (const f of req.files || []) {
        if (!/\.jar$/i.test(f.originalname)) { fs.rmSync(f.path, { force: true }); continue; }
        const name = path.basename(f.originalname);
        const target = path.join(d, name);
        // Server läuft: derselbe sichere Weg wie Updates – live über die Bridge (auch ganz neue Plugins), sonst eingereiht
        // statt die geladene (unter Windows gesperrte) JAR zu überschreiben
        if (this.proc(id).isRunning()) {
          try { const r = await this.placeAddon(id, f.path, { finalName: name, replace: fs.existsSync(target) ? name : null }); placed.push({ file: name, mode: r.mode, text: r.text }); } catch (e) { placed.push({ file: name, mode: 'error', text: e.message }); }
          continue;
        }
        // Eine deaktivierte Fassung mit gleichem Namen würde sonst daneben liegen bleiben (X.jar + X.jar.disabled)
        fs.rmSync(target + '.disabled', { force: true });
        fs.renameSync(f.path, target);
        placed.push({ file: name, mode: 'copy' });
      }
      const list = await this.plugins(id);
      // v=2: mit Ergebnis je Datei (live, eingereiht …) – ältere Aufrufer bekommen wie bisher nur die Liste
      res.json(req.query.v === '2' ? { plugins: list, placed } : list);
    });
    r.get('/mc/servers/:id/modrinth', async (req, res) => res.json(await this.modrinthSearch(req.params.id, req.query.q)));
    r.post('/mc/servers/:id/modrinth', (req, res) => res.json({ job: this.modrinthInstall(req.params.id, req.body.projectId).id }));
    r.get('/mc/servers/:id/players', (req, res) => res.json(this.playerLists(req.params.id)));
    r.get('/mc/servers/:id/worlds', (req, res) => res.json(this.worlds(req.params.id)));
    r.get('/mc/servers/:id/dimensions', async (req, res) => res.json(await this.dims.forServer(req.params.id)));
    r.post('/mc/servers/:id/worlds/:name/reset', (req, res) => res.json({ job: this.resetWorld(req.params.id, req.params.name, (req.body || {}).dim || null).id }));
    r.get('/mc/servers/:id/worlds/:name/download', async (req, res) => {
      const f = await this.worldZip(req.params.id, req.params.name);
      res.download(f, `${req.params.name}.zip`, () => fs.rmSync(f, { force: true }));
    });
    r.get('/mc/servers/:id/gamerules', async (req, res) => res.json(await this.gamerules(req.params.id)));
    r.put('/mc/servers/:id/gamerules', (req, res) => res.json(this.setGamerule(req.params.id, String((req.body || {}).name || ''), (req.body || {}).value)));
    r.post('/mc/servers/:id/gamerules', (req, res) => {
      const { name, value } = req.body || {};
      if (!/^\w+$/.test(name || '') || !/^(true|false|-?\d+)$/.test(String(value))) throw new Error(T('Invalid game rule'));
      this.command(req.params.id, `gamerule ${name} ${value}`);
      res.json({ ok: true });
    });
    r.get('/mc/servers/:id/icon', (req, res) => {
      const f = path.join(this.dir(req.params.id), 'server-icon.png');
      if (!fs.existsSync(f)) return res.status(404).end();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(f);
    });
    r.put('/mc/servers/:id/icon', async (req, res) => {
      const m = String((req.body || {}).png || '').match(/^data:image\/png;base64,(.+)$/);
      if (!m) throw new Error(T('Please provide a PNG image.'));
      const buf = Buffer.from(m[1], 'base64');
      if (buf.readUInt32BE(16) !== 64 || buf.readUInt32BE(20) !== 64) throw new Error(T('The server icon must be exactly 64×64 pixels.'));
      fs.writeFileSync(path.join(this.dir(req.params.id), 'server-icon.png'), buf);
      require('./hw').core('events').broadcast({ type: 'icon', kind: 'mc', id: req.params.id, v: Date.now() });
      const running = this.proc(req.params.id).isRunning();
      const live = running ? await this.applyIconLive(req.params.id) : false;
      res.json({ ok: true, live, needsRestart: running && !live, bridgeNeeded: running && !live && !this.bridgeAt(req.params.id, '1.2') });
    });
    r.delete('/mc/servers/:id/icon', async (req, res) => {
      fs.rmSync(path.join(this.dir(req.params.id), 'server-icon.png'), { force: true });
      const running = this.proc(req.params.id).isRunning();
      const live = running ? await this.applyIconLive(req.params.id, true) : false;
      res.json({ ok: true, live, needsRestart: running && !live });
    });
    r.get('/mc/servers/:id/map', (req, res) => res.json(this.mapStatus(req.params.id)));
    r.post('/mc/servers/:id/map', (req, res) => res.json({ job: this.setupMap(req.params.id).id }));
    r.get('/mc/servers/:id/selftest', (req, res) => res.json(this.selfTests.get(req.params.id) || null));
    r.post('/mc/servers/:id/selftest', (req, res) => res.json({ job: this.selfTest(req.params.id).id }));
    r.get('/mc/servers/:id/plugins/updates', async (req, res) => res.json(await this.pluginUpdates(req.params.id)));
    r.post('/mc/servers/:id/plugins/update', (req, res) => { const b = req.body || {}; res.json({ job: this.updatePlugins(req.params.id, Array.isArray(b.files) ? b.files.map(String).slice(0, 500) : b.file).id }); });
  }
}

module.exports = { MinecraftManager, parseProps, writeProps, readPluginMeta };
