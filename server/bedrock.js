'use strict';
/*
 * Bedrock Dedicated Server (BDS) als Servertyp im Kern – Mojangs offizieller Server für die Bedrock Edition (Handy,
 * Tablet, Konsole, Windows). Eigene Bedrock-Welt, nur Bedrock-Spieler, kein Java, keine Java-Plugins. Für Java + Bedrock
 * auf derselben Welt gibt es Geyser (Erweiterung „Minecraft-Servernetzwerk“).
 *
 * Läuft als eigenes Programm (bedrock_server(.exe)) aus Mojangs Download-Liste (dieselbe Quelle wie die Download-Seite
 * auf minecraft.net). Mojang veröffentlicht nur die jeweils neueste Fassung (dazu eine Vorschau) – ältere Versionen gibt
 * es dort nicht mehr. Der Kern behandelt den Typ über seine Fähigkeiten (providers.caps): kein Java, UDP statt TCP,
 * Welten unter worlds/, Erlaubnisliste und Rechte statt whitelist/ops, keine Plugins, keine Datapacks.
 *
 * Updates mit Rücksprung: Bedrock-Spieler kommen nur mit ihrer App-Version hinein, der Server muss also jeder
 * Bedrock-Version folgen. Neue Fassung NEBEN der alten entpacken → Welten und Einstellungen (KEEP) hinüber → Ordner
 * tauschen → starten → Probe („Server started.“ + Antwort auf dem UDP-Port). Klappt das nicht, kommt der alte Ordner
 * zurück und die Version wird übersprungen, bis es eine neuere gibt. Automatisch nur, wenn niemand spielt (updatewatch).
 *
 * NetherNet (Mojangs bedrock_server_how_to.html + server.properties-Vorlage ab 1.26.5x, Bedrock 26.60 ohne RakNet ab
 * 27.10.2026): „transport=nethernet“ ist Standard – Anmeldung (HTTP-Signaling) über TCP auf server-port, das Spiel über
 * UDP-Ports, die der Server je Verbindung vergibt (server-udp-ports kann sie festlegen). Hostwerk richtet sich nach der
 * Vorlage der heruntergeladenen Version (.hostwerk-vorlage.json, beim Entpacken gelesen) statt nach Annahmen:
 *   - kennt die Vorlage „transport“ und steht dort nethernet, wird ein aus einer älteren Version mitgenommenes
 *     „transport=raknet“ EINMAL umgestellt (danach gilt, was der Nutzer einträgt)
 *   - server-udp-ports setzt Hostwerk NICHT: ohne den Schlüssel baut der Server seine NAT-Zuordnung selbst; mit Bereichen
 *     wirbt er laut Mojang-Fehlerbericht (BDS-23108) nur private Adressen. Trägt der Nutzer Ports ein, öffnet Hostwerk sie.
 *   - Firewall/Router: TCP server-port zusätzlich zu UDP (außer bei raknet)
 *   - Server-Identität (keys/server_identity_key.pem) wird einmal gespeichert („serveridentity save“, wenn die Anleitung der
 *     Version den Befehl kennt) – sonst müssten Spieler dem Server nach jedem Neustart wieder vertrauen; „keys“ zieht mit um
 *   - „NetherNet bereit“ nur, wenn GET /v1/join auf server-port antwortet; sonst ehrlich „unbekannt“
 *
 * Spieler: Bedrock kennt Spieler über ihre Xbox-Kennung (XUID). Hostwerk merkt sich Name ↔ XUID aus dem Protokoll
 * („Player connected: Name, xuid: …“) in .hostwerk-players.json – Rechte (permissions.json) lassen sich nur für Spieler
 * vergeben, deren XUID bekannt ist; die Erlaubnisliste (allowlist.json) geht auch mit dem Namen allein.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dgram = require('dgram');
const { runJob } = require('./hw').core('jobs');
const { fetchJson, cached, downloadFile, extractZip, jobProgress } = require('./hw').core('download');
const { zipDir, unzipTo, slug, dirSize } = require('./hw').core('util');
const { broadcast } = require('./hw').core('events');
const net = require('net');
const { bedrockStatus } = require('./ping');
const T = (text, vars) => require('./hw').t(text, vars); // Text in der Sprache der Oberfläche (Deutsch aus locales/de.json)

const LINKS = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';
const IS_WIN = process.platform === 'win32';
/** Dateien und Ordner, die dem Nutzer gehören – sie wandern zu jeder neuen Version mit und stecken in den Sicherungen. */
const KEEP = ['worlds', 'server.properties', 'permissions.json', 'allowlist.json', 'whitelist.json', 'behavior_packs_custom', 'resource_packs_custom', 'config', 'development_behavior_packs', 'development_resource_packs', '.hostwerk-players.json', 'keys'];
/** Was die mitgelieferte Vorlage einer Version über NetherNet weiß (neben die Programmdateien geschrieben, zieht nicht mit um). */
const TEMPLATE_INFO = '.hostwerk-vorlage.json';
const PROBE_MS = 3 * 60000;
const LEVELS = ['visitor', 'member', 'operator'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download-Art in Mojangs Liste für dieses System (Vorschau getrennt) – null: Mojang bietet hier keinen Server an. */
function platformKey(preview = false, platform = process.platform) {
  const os = platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : null;
  return os ? `serverBedrock${preview ? 'Preview' : ''}${os}` : null;
}
/** Version aus der Download-Adresse: …/bedrock-server-1.26.52.3.zip → 1.26.52.3 */
function versionOf(url) { const m = String(url || '').match(/bedrock-server-([\d.]+)\.zip/i); return m ? m[1] : null; }
/** Bedrock-Versionen (vier Teile) vergleichen. */
function cmpVer(a, b) { const pa = String(a || '').split('.').map(Number); const pb = String(b || '').split('.').map(Number); for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; }
/** Freier UDP-Port auf diesem PC? */
function udpFree(port) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.once('error', () => { try { s.close(); } catch { /* schon zu */ } resolve(false); });
    s.bind(port, '0.0.0.0', () => s.close(() => resolve(true)));
  });
}

/** Freier TCP-Port? (NetherNet-Anmeldung liegt auf server-port über TCP) */
function tcpFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, () => s.close(() => resolve(true)));
  });
}
/** server.properties lesen (aktive Zeilen) – auch für die Vorlage im Download. */
function readProps(text) {
  const out = {};
  for (const l of String(text || '').split(/\r?\n/)) { const m = l.match(/^\s*([\w.-]+)\s*=(.*)$/); if (m) out[m[1]] = m[2].trim(); }
  return out;
}
/**
 * Vorlage einer Version (server.properties + Anleitung aus dem ZIP) → { transport, transportDefault, udpPorts, identity }
 *   transport/udpPorts: die Version kennt den Schlüssel (aktiv oder auskommentiert) · identity: „serveridentity save“ bekannt
 */
function templateInfo(propsText, howto = '') {
  const known = (k) => new RegExp(`^\\s*#?\\s*${k.replace(/[-.]/g, '\\$&')}\\s*=`, 'm').test(String(propsText || ''));
  const p = readProps(propsText);
  return {
    transport: known('transport'), transportDefault: ['nethernet', 'raknet'].includes(p.transport) ? p.transport : null,
    udpPorts: known('server-udp-ports'), identity: /serveridentity\s+save/i.test(String(howto || '')),
  };
}
/**
 * server-udp-ports (Mojang: „internal“, „start-end“ oder „[ip:]external[-external]:internal[-internal]“, kommagetrennt,
 * mehrere Zeilen möglich) → die lokalen UDP-Ports, die der Server bindet (höchstens 64; mehr öffnet Hostwerk nicht einzeln).
 */
function udpPortsOf(values) {
  const out = new Set();
  for (const v of [].concat(values || [])) {
    for (const raw of String(v || '').split(',')) {
      const e = raw.trim().replace(/^\[[^\]]*\]:/, '').replace(/^\d{1,3}(\.\d{1,3}){3}:/, '');
      if (!e) continue;
      const internal = e.split(':').pop();
      const m = internal.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
      if (!m) continue;
      const a = Number(m[1]); const b = Number(m[2] || m[1]);
      for (let x = a; x <= b && x < 65536 && out.size < 64; x++) if (x > 0) out.add(x);
    }
  }
  return [...out];
}

/** Mojangs Liste lesen → { stable: { version, url } | null, preview: … | null } (10 Minuten zwischengespeichert). */
async function releases(platform = process.platform) {
  const j = await cached('bedrock-links', 10 * 60000, () => fetchJson(LINKS));
  const links = (j && j.result && j.result.links) || [];
  const pick = (preview) => { const l = links.find((x) => x.downloadType === platformKey(preview, platform)); return l && versionOf(l.downloadUrl) ? { version: versionOf(l.downloadUrl), url: l.downloadUrl, preview } : null; };
  return { stable: pick(false), preview: pick(true) };
}

/** Eintrag für providers.js – erscheint beim Anlegen wie die Java-Typen. */
const provider = {
  label: 'Bedrock Dedicated Server',
  edition: 'bedrock',
  homepage: 'https://www.minecraft.net/download/server/bedrock',
  description: 'Mojang’s server for the Bedrock Edition (phone, tablet, console, Windows) – its own Bedrock world, no Java needed.',
  plugins: false,
  content: 'none',
  loaders: [],
  async versions() {
    if (!platformKey()) return { latest: null, versions: [], unsupported: true };
    const r = await releases();
    const list = [r.stable && { id: r.stable.version, stable: true }, r.preview && { id: r.preview.version, stable: false }].filter(Boolean);
    return { latest: r.stable ? r.stable.version : null, versions: list };
  },
};

class BedrockEdition {
  /** mc: MinecraftManager · opts: { releases, ping, udpFree, probeMs } – für Tests ersetzbar */
  constructor(mc, opts = {}) {
    this.mc = mc;
    this.releases = opts.releases || releases;
    this.ping = opts.ping || bedrockStatus;
    this.udpFree = opts.udpFree || udpFree;
    this.tcpFree = opts.tcpFree || tcpFree;
    this.probeMs = opts.probeMs || PROBE_MS;
    this.download = opts.download || downloadFile;
    this.extract = opts.extract || extractZip;
    this.launch = opts.launch || null; // (id) → { cmd, args } statt bedrock_server(.exe) – für Tests
  }
  exe(id) { return path.join(this.mc.dir(id), IS_WIN ? 'bedrock_server.exe' : 'bedrock_server'); }
  supported() { return !!platformKey(); }

  /** Gewünschte Fassung: neueste stabile, die Vorschau oder genau eine Versionsnummer (Mojang hat nur diese beiden). */
  async release(version) {
    if (!this.supported()) throw new Error(T('Mojang offers the Bedrock server only for Windows and Linux.'));
    const r = await this.releases();
    if (!version || version === 'latest') { if (!r.stable) throw new Error(T('Mojang’s download list names no Bedrock server for this system right now.')); return r.stable; }
    if (version === 'preview' && r.preview) return r.preview;
    const hit = [r.stable, r.preview].find((x) => x && x.version === version);
    if (!hit) throw new Error(T('Mojang no longer offers Bedrock {version} – available is {v2}.', { version, v2: [r.stable && r.stable.version, r.preview && `${r.preview.version} (${T('Preview')})`].filter(Boolean).join(T(' and ')) }));
    return hit;
  }

  /* ---------------- Ports (UDP) ---------------- */

  /** UDP-Ports, die schon vergeben sind: andere Bedrock-Server (IPv4 + IPv6), Geyser (RakNet + NetherNet), öffentliche UDP-Freigaben. */
  usedUdp(exceptId = null) {
    const used = new Set();
    for (const s of this.mc.list()) {
      if (s.id === exceptId) continue;
      if (this.mc.isBedrock(s)) { if (s.port) used.add(Number(s.port)); if (s.portv6) used.add(Number(s.portv6)); for (const x of (s.bdsNet && s.bdsNet.udp) || []) used.add(Number(x)); }
      if (s.geyser && s.geyser.port) used.add(Number(s.geyser.port));
      // Geysers eigener UDP-Port für NetherNet (WebRTC)
      if (s.geyser && s.geyser.webrtcPort) used.add(Number(s.geyser.webrtcPort));
    }
    try { const sec = this.mc.ctx.security; for (const p of (sec && sec.publicPorts ? sec.publicPorts() : [])) if (p.proto === 'UDP') used.add(Number(p.port)); } catch { /* ohne Sicherheitsdienst */ }
    return used;
  }
  /** Freie Ports: IPv4 (Wunsch oder ab 19132) und IPv6 direkt dahinter. */
  async pickPorts(want = 0, exceptId = null) {
    const used = this.usedUdp(exceptId);
    const free = async (p) => p > 0 && p < 65536 && !used.has(p) && (await this.udpFree(p));
    let port = Number(want) || 0;
    if (port && !(await free(port))) throw new Error(T('UDP port {port} is already taken – leave the field empty and Hostwerk picks a free one.', { port }));
    for (let p = 19132; !port && p < 19132 + 400; p += 2) if (await free(p)) port = p;
    if (!port) throw new Error(T('No free UDP port found between 19132 and 19531.'));
    used.add(port);
    let portv6 = 0;
    for (let p = port + 1; !portv6 && p < port + 400; p++) if (await free(p)) portv6 = p;
    return { port, portv6 };
  }

  /* ---------------- Anlegen, Programmdateien ---------------- */

  /** Download (Mojang) + Entpacken. Mojang veröffentlicht keine Prüfsumme – das Entpacken prüft jede Datei (CRC). */
  async installTo(dir, rel, job, [from, to] = [5, 90]) {
    const tmp = path.join(this.mc.paths.cache, `bedrock-${rel.version}-${crypto.randomBytes(3).toString('hex')}.zip`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    try {
      if (job) job.log(T('Bedrock Dedicated Server {version}{v2} from minecraft.net', { version: rel.version, v2: rel.preview ? ` (${T('Preview')})` : '' }));
      await this.download(rel.url, tmp, { browser: true, onProgress: job ? jobProgress(job, T('Download Bedrock {version}', { version: rel.version }), from, from + (to - from) * 0.8) : undefined });
      if (job) job.progress(from + (to - from) * 0.85, T('Extracting …'));
      fs.mkdirSync(dir, { recursive: true });
      await this.extract(tmp, dir);
      if (!IS_WIN) { try { fs.chmodSync(path.join(dir, 'bedrock_server'), 0o755); } catch { /* fehlt – fällt beim Start auf */ } }
      if (!fs.existsSync(path.join(dir, IS_WIN ? 'bedrock_server.exe' : 'bedrock_server'))) throw new Error(T('The download lacks the server program – please try again later.'));
      // Vorlage dieser Version merken, BEVOR Einstellungen des Nutzers darüber kopiert werden
      const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
      fs.writeFileSync(path.join(dir, TEMPLATE_INFO), JSON.stringify({ version: rel.version, ...templateInfo(read('server.properties'), read('bedrock_server_how_to.html')) }));
    } finally { fs.rmSync(tmp, { force: true }); }
  }

  /** Neuer Bedrock-Server: body { name, eula, version?, port?, gamemode, difficulty, maxPlayers, onlineMode, seed, nightlyBackup } */
  async create(body = {}) {
    const mc = this.mc;
    if (!this.supported()) throw new Error(T('Mojang offers the Bedrock server only for Windows and Linux.'));
    if (!body.eula) throw new Error(T('The Minecraft EULA and Mojang’s privacy policy have to be accepted.'));
    const name = String(body.name || '').trim().slice(0, 60) || 'Bedrock-Server';
    let id = slug(name);
    if (body._id && /^[\w-]+$/.test(body._id) && !mc.list().some((s) => s.id === body._id)) id = body._id;
    else while (mc.list().some((s) => s.id === id) || fs.existsSync(mc.dir(id))) id = slug(name) + '-' + crypto.randomBytes(2).toString('hex');
    const { port, portv6 } = await this.pickPorts(Number(body._port) || Number(body.port) || 0);
    const gm = ['survival', 'creative', 'adventure'].includes(body.gamemode) ? body.gamemode : 'survival';
    const diff = ['peaceful', 'easy', 'normal', 'hard'].includes(body.difficulty) ? body.difficulty : 'normal';
    return runJob(T('Set up Bedrock server “{name}”', { name }), async (job) => {
      const dir = mc.dir(id);
      fs.mkdirSync(dir, { recursive: true });
      try {
        const rel = await this.release(body.version);
        await this.installTo(dir, rel, job, [5, 90]);
        mc.setPropertiesAt(dir, {
          'server-name': name.replace(/[;\r\n]/g, ' '), 'server-port': port, 'server-portv6': portv6, gamemode: gm, difficulty: diff,
          'max-players': Math.max(1, Math.min(200, Math.round(Number(body.maxPlayers)) || 10)),
          'online-mode': body.onlineMode === false ? 'false' : 'true',
          ...(body.seed ? { 'level-seed': String(body.seed).replace(/[^\w-]/g, '').slice(0, 32) } : {}),
        });
        const server = {
          id, name, type: 'bedrock', version: rel.version, build: null, port, portv6,
          memMin: null, memMax: null, javaMajor: null, jvmFlags: null, extraArgs: '', autostart: false, autoRestart: true,
          createdAt: Date.now(), eulaAt: Date.now(), preview: !!rel.preview,
          nightlyBackup: { enabled: body.nightlyBackup !== false, everyHours: 24, keep: 7, hour: 3, since: Date.now() },
        };
        mc.list().push(server);
        mc.settings.save();
        mc.proc(id);
        job.progress(100, T('Done'));
        return { id };
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw e;
      }
    }, { key: `mc-create:${name.toLowerCase()}:bedrock`, resume: { kind: 'mc-create', params: { ...body, type: 'bedrock', _id: id, _port: port } } });
  }

  /* ---------------- Start, Konsole, Spieler ---------------- */

  async start(id) {
    const mc = this.mc;
    const s = mc.get(id);
    const p = mc.proc(id);
    if (p.isRunning()) return;
    const dir = mc.dir(id);
    const launch = this.launch ? this.launch(id) : { cmd: this.exe(id), args: [] };
    if (!fs.existsSync(launch.cmd)) throw new Error(T('Bedrock server missing: {file}', { file: launch.cmd }));
    if (!(await this.udpFree(s.port))) throw new Error(T('UDP port {port} is in use – another program (or a second Bedrock server) uses it.', { port: s.port }));
    // Hostwerk führt die Ports (Freigaben in Firewall/Router hängen daran)
    mc.setPropertiesAt(dir, { 'server-port': s.port, ...(s.portv6 ? { 'server-portv6': s.portv6 } : {}) });
    const nn = this.applyNetherNet(id);
    if (nn.transport !== 'raknet' && !(await this.tcpFree(s.port))) throw new Error(T('TCP port {port} is taken – NetherNet needs it for signing in. Another program uses it.', { port: s.port }));
    this.nnSeen = this.nnSeen || new Map();
    this.nnSeen.delete(id);
    p.setExtra({ players: [], playerCount: 0, ready: false, tps: null, liveMotd: null, bridge: null });
    p.lineFilter = null;
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });
    await p.start({
      cmd: launch.cmd, args: launch.args || [], cwd: dir, stdin: true,
      // Linux: der Server lädt seine eigene libCrypto aus dem Programmordner
      env: IS_WIN ? {} : { LD_LIBRARY_PATH: dir },
      onLine: (line) => {
        const clean = String(line).replace(/\x1b\[[0-9;]*m/g, '');
        if (/Server started\./.test(clean) && !p.extra.ready) {
          p.setExtra({ ready: true }); readyResolve(); mc.pollStatus(id);
          this.saveIdentity(id, p);
          const cfg = mc.list().find((x) => x.id === id);
          if (cfg && cfg.autoCheck !== false && !(mc.selfTesting && mc.selfTesting.has(id)) && !this.probing) setTimeout(() => { try { mc.selfTest(id).promise.catch(() => {}); } catch { /* läuft schon */ } }, 4000);
        }
        const v = clean.match(/\bVersion:?\s+(\d+\.\d+\.\d+(?:\.\d+)?)/);
        if (v && !p.extra.version) p.setExtra({ version: v[1] });
        this.playerLine(id, p, clean);
        if (/Network port occupied|Failed to bind|port .* in use/i.test(clean)) p.log(T('Note: UDP port {port} (or {portv6}) is in use – choose another one under Settings.', { port: s.port, portv6: s.portv6 }), 'sys');
      },
      ready: () => new Promise((r) => setTimeout(r, 1500)),
    });
    ready.then(() => broadcast({ type: 'toast', kind: 'success', text: T('“{name}” is ready (UDP port {port}).', { name: s.name, port: s.port }) }));
  }

  /** Protokollzeile: An-/Abmeldungen (mit XUID) – Statistik und Live-Ereignisse wie bei Java. */
  playerLine(id, p, clean) {
    const mc = this.mc;
    let m = clean.match(/Player connected:\s*([^,]+),\s*xuid:\s*(\d*)/);
    if (m) {
      const name = m[1].trim();
      this.remember(id, name, m[2]);
      if (!p.extra.players.includes(name)) {
        p.setExtra({ players: [...p.extra.players, name], playerCount: p.extra.players.length + 1 });
        mc.stats.join(id, name);
        broadcast({ type: 'mc-player-join', id, server: mc.get(id).name, player: name, edition: 'bedrock' });
      }
      return;
    }
    m = clean.match(/Player disconnected:\s*([^,]+),\s*xuid/);
    if (m) {
      const name = m[1].trim();
      if (!p.extra.players.includes(name)) return;
      const players = p.extra.players.filter((x) => x !== name);
      p.setExtra({ players, playerCount: players.length });
      const ms = mc.stats.leave(id, name);
      broadcast({ type: 'mc-player-leave', id, server: mc.get(id).name, player: name, ms: typeof ms === 'number' ? ms : null, edition: 'bedrock' });
    }
  }

  /** Name ↔ XUID merken (für Rechte, die Bedrock nur über die XUID kennt). */
  knownFile(id) { return path.join(this.mc.dir(id), '.hostwerk-players.json'); }
  known(id) { try { return JSON.parse(fs.readFileSync(this.knownFile(id), 'utf8')) || {}; } catch { return {}; } }
  remember(id, name, xuid) {
    if (!name || !/^\d{6,20}$/.test(String(xuid || ''))) return;
    const k = this.known(id);
    if (k[name] && k[name].xuid === String(xuid)) { k[name].seen = Date.now(); } else k[name] = { xuid: String(xuid), seen: Date.now() };
    try { fs.writeFileSync(this.knownFile(id), JSON.stringify(k, null, 1)); } catch { /* schreibgeschützt */ }
  }

  /**
   * Läuft er, bereit, antwortet der Port (RakNet über UDP oder NetherNet über TCP)? (Probe nach Updates)
   * NetherNet ohne Antwort auf GET /v1/join: Der Weg ist bei Mojang nicht beschrieben – läuft der Server dann seit der
   * halben Probezeit stabil („Server started.“), gilt die Probe als bestanden (ehrlich vermerkt) statt jedes Update
   * zurückzunehmen.
   */
  async probe(id, ms = this.probeMs) {
    const s = this.mc.get(id);
    const p = this.mc.proc(id);
    const until = Date.now() + ms;
    let readySince = null;
    while (Date.now() < until) {
      if (!p.isRunning()) return false;
      if (p.extra.ready) {
        readySince = readySince || Date.now();
        const r = await this.ping(s.port).catch(() => null);
        if (r) { this.seen(id, p, r); return true; }
        if ((s.bdsNet || {}).transport === 'nethernet' && Date.now() - readySince >= ms / 2) { this.probeNote = T('running stably, port answer via NetherNet cannot be checked'); return true; }
      }
      await sleep(1000);
    }
    return false;
  }

  /* ---------------- NetherNet ---------------- */

  /** Vorlage der installierten Version (null: vor dieser Hostwerk-Version entpackt – dann ändert Hostwerk nichts). */
  templateOf(id) { try { return JSON.parse(fs.readFileSync(path.join(this.mc.dir(id), TEMPLATE_INFO), 'utf8')); } catch { return null; } }
  /**
   * Vor jedem Start: transport/server-udp-ports nach der Vorlage, Ergebnis in s.bdsNet (Firewall/Router lesen es).
   * → { transport: 'nethernet'|'raknet'|null (unbekannt), udp: [Ports aus server-udp-ports] }
   */
  applyNetherNet(id) {
    const mc = this.mc;
    const s = mc.get(id);
    const dir = mc.dir(id);
    const info = this.templateOf(id);
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8'); } catch { /* neu */ }
    const props = readProps(text);
    const prev = s.bdsNet || {};
    let transport = props.transport || (info && info.transportDefault) || null;
    // Aus einer älteren Version mitgenommenes RakNet: einmal auf den Standard der neuen Version (nethernet) – danach nicht mehr
    if (info && info.transport && info.transportDefault === 'nethernet' && props.transport === 'raknet' && !prev.at) {
      mc.setPropertiesAt(dir, { transport: 'nethernet' });
      transport = 'nethernet';
    }
    const udpLines = String(text).split(/\r?\n/).map((l) => l.match(/^\s*server-udp-ports\s*=(.*)$/)).filter(Boolean).map((m) => m[1]);
    const next = { transport, udp: transport === 'raknet' ? [] : udpPortsOf(udpLines), known: !!(info && info.transport), ...(prev.at || transport === 'nethernet' ? { at: prev.at || Date.now() } : {}) };
    if (JSON.stringify(next) !== JSON.stringify(prev)) { s.bdsNet = next; mc.settings.save(); }
    return next;
  }
  /** Server-Identität einmal speichern (NetherNet): sonst fragt die App nach jedem Neustart erneut, ob sie vertrauen soll. */
  saveIdentity(id, p) {
    const s = this.mc.get(id);
    const info = this.templateOf(id);
    if (!info || !info.identity || (s.bdsNet || {}).transport !== 'nethernet') return false;
    if (fs.existsSync(path.join(this.mc.dir(id), 'keys', 'server_identity_key.pem'))) return false;
    try { p.write('serveridentity save'); return true; } catch { return false; }
  }
  /** Antwort eines Pings merken (welcher Weg antwortete) – für „NetherNet bereit“. */
  seen(id, p, r) { this.nnSeen = this.nnSeen || new Map(); this.nnSeen.set(id, { pid: p.pid || null, via: r.via || null, at: Date.now() }); }
  /** Zustand für die Oberfläche: ready · unknown (läuft, Antwort fehlt/Weg unbekannt) · configured (gestoppt) · raknet */
  netherNet(id) {
    const s = this.mc.get(id);
    const p = this.mc.proc(id);
    const n = s.bdsNet || {};
    const seen = (this.nnSeen || new Map()).get(id);
    const live = !!seen && seen.pid === (p.pid || null);
    let state = 'unknown';
    if (n.transport === 'raknet') state = 'raknet';
    else if (p.isRunning() && p.extra && p.extra.ready && live && seen.via === 'nethernet') state = 'ready';
    else if (!p.isRunning() && n.transport === 'nethernet') state = 'configured';
    return { state, transport: n.transport || null, known: !!n.known, udp: n.udp || [], identity: fs.existsSync(path.join(this.mc.dir(id), 'keys', 'server_identity_key.pem')) };
  }

  /* ---------------- Updates mit Rücksprung ---------------- */

  status(id) {
    const s = this.mc.get(id);
    return { version: s.version || null, latest: s.bedrockLatest || null, checkedAt: s.bedrockCheckedAt || null, failed: s.bedrockFailed || null, preview: !!s.preview, update: !!(s.bedrockLatest && s.version && cmpVer(s.bedrockLatest, s.version) > 0 && s.bedrockFailed !== s.bedrockLatest), netherNet: this.netherNet(id) };
  }
  async check(id) {
    const s = this.mc.get(id);
    const rel = await this.release(s.preview ? 'preview' : undefined).catch(() => this.release());
    s.bedrockLatest = rel.version; s.bedrockCheckedAt = Date.now();
    this.mc.settings.save();
    return this.status(id);
  }

  /**
   * Update mit Rücksprung (siehe oben). Läuft er, wird er gestoppt und danach wieder gestartet; lief er nicht, bleibt er
   * nach der Probe gestoppt. Mit Spielern online nur mit force.
   */
  update(id, { version = null, force = false } = {}) {
    const mc = this.mc;
    const s = mc.get(id);
    const p = mc.proc(id);
    if (!force && (p.extra.players || []).length) throw Object.assign(new Error(T('People are playing right now – the update waits until nobody is online.')), { status: 409 });
    return runJob(T('Update Bedrock server “{name}”', { name: s.name }), async (job) => {
      const rel = await this.release(version || (s.preview ? 'preview' : undefined));
      if (s.version && cmpVer(rel.version, s.version) === 0 && !force) return { upToDate: true, version: s.version };
      const dir = mc.dir(id); const staged = `${dir}.neu`; const prevDir = `${dir}.alt`;
      job.progress(3, T('Backing up the worlds …'));
      await this.backupTo(id, path.join(mc.backupDir(id), `${stamp()}-vor-update-${rel.version}.zip`));
      fs.rmSync(staged, { recursive: true, force: true });
      await this.installTo(staged, rel, job, [8, 70]);
      const wasRunning = p.isRunning();
      if (wasRunning) { job.progress(72, T('Stopping server …')); await mc.stop(id); }
      job.progress(78, T('Moving worlds and settings over …'));
      for (const k of KEEP) { const src = path.join(dir, k); if (fs.existsSync(src)) { fs.rmSync(path.join(staged, k), { recursive: true, force: true }); fs.cpSync(src, path.join(staged, k), { recursive: true }); } }
      fs.rmSync(prevDir, { recursive: true, force: true });
      await renameRetry(dir, prevDir);
      await renameRetry(staged, dir);
      const prev = s.version; const prevPreview = !!s.preview;
      s.version = rel.version; s.preview = !!rel.preview;
      mc.settings.save();
      job.progress(85, T('Trial start …'));
      this.probing = true;
      try {
        await mc.start(id);
        if (!(await this.probe(id))) throw new Error(p.isRunning() ? T('the server does not answer on its port') : T('the server quit while starting'));
        fs.rmSync(prevDir, { recursive: true, force: true });
        delete s.bedrockFailed;
        mc.settings.save();
        this.note(s, true, T('Version {version} is running.', { version: rel.version }) + (this.probeNote ? ` (${this.probeNote})` : ''));
        this.probeNote = null;
        if (!wasRunning) await mc.stop(id);
        job.log(T('Bedrock {version} is running – worlds and settings were carried over.', { version: rel.version }));
        return { version: rel.version, previous: prev };
      } catch (e) {
        await mc.stop(id).catch(() => {});
        fs.rmSync(dir, { recursive: true, force: true });
        await renameRetry(prevDir, dir);
        s.version = prev; s.preview = prevPreview; s.bedrockFailed = rel.version;
        mc.settings.save();
        const text = T('Update to {version} rolled back ({error}) – version {prev} is running again. Hostwerk skips {version}.', { version: rel.version, error: e.message, prev });
        this.note(s, false, text);
        broadcast({ type: 'toast', kind: 'warn', text: `${s.name}: ${text}` });
        if (wasRunning) await mc.start(id).catch(() => {});
        throw new Error(text);
      } finally { this.probing = false; }
    }, { key: `mc-bedrock-update-${id}` });
  }
  note(s, ok, text) { try { if (this.mc.ctx.keeper) this.mc.ctx.keeper.note(`mc-bedrock-${s.id}`, { ok, label: `Bedrock-Server (${s.name})`, text }); } catch { /* ohne Selbstwartung */ } }

  /* ---------------- Sicherungen (nur Welten und Einstellungen, nicht die Programmdateien) ---------------- */

  /** Läuft er: Speichern anhalten („save hold“), warten bis die Dateien kopierbar sind, fn, wieder freigeben („save resume“). */
  async withHold(id, fn) {
    const p = this.mc.proc(id);
    if (!p.child || !p.extra.ready) return fn();
    const mark = p.logs.length;
    p.write('save hold');
    for (let i = 0; i < 20; i++) {
      await sleep(i ? 1000 : 600);
      if (p.logs.slice(mark).some((e) => /Files are now ready to be copied|Data saved/i.test(e.l))) break;
      p.write('save query');
    }
    try { return await fn(); } finally { if (p.child) p.write('save resume'); }
  }
  async backupTo(id, file) {
    const dir = this.mc.dir(id);
    const stage = path.join(this.mc.paths.cache, `bedrock-backup-${id}-${crypto.randomBytes(3).toString('hex')}`);
    try {
      await this.withHold(id, async () => {
        fs.mkdirSync(stage, { recursive: true });
        for (const k of KEEP) { const src = path.join(dir, k); if (fs.existsSync(src)) fs.cpSync(src, path.join(stage, k), { recursive: true }); }
      });
      await zipDir(stage, file);
      return file;
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }
  /** Sicherung einspielen: nur Welten und Einstellungen ersetzen – die Programmdateien der aktuellen Version bleiben. */
  async restoreFrom(id, zip) {
    const dir = this.mc.dir(id);
    const stage = path.join(this.mc.paths.cache, `bedrock-restore-${id}-${crypto.randomBytes(3).toString('hex')}`);
    try {
      await unzipTo(zip, stage);
      // Ältere Sicherungen (ganzer Ordner) gehen genauso: nur die Teile, die dem Nutzer gehören
      for (const k of KEEP) { fs.rmSync(path.join(dir, k), { recursive: true, force: true }); const src = path.join(stage, k); if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, k), { recursive: true }); }
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  }

  /* ---------------- Welten ---------------- */

  worldPath(id, name) { return path.join(this.mc.dir(id), 'worlds', name); }
  worlds(id) {
    const props = this.mc.properties(id);
    const base = props['level-name'] || 'Bedrock level';
    const root = path.join(this.mc.dir(id), 'worlds');
    const out = [];
    for (const d of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
      if (!d.isDirectory()) continue;
      const full = path.join(root, d.name);
      if (!fs.existsSync(path.join(full, 'db')) && !fs.existsSync(path.join(full, 'level.dat'))) continue;
      let label = d.name; try { label = fs.readFileSync(path.join(full, 'levelname.txt'), 'utf8').trim() || d.name; } catch { /* ohne Anzeigename */ }
      out.push({ name: d.name, label, kind: d.name === base ? 'overworld' : 'other', size: dirSize(full), main: d.name === base });
    }
    return { levelName: base, seed: props['level-seed'] || null, edition: 'bedrock', worlds: out.sort((a, b) => (b.main - a.main) || a.name.localeCompare(b.name)) };
  }

  /* ---------------- Erlaubnisliste, Rechte ---------------- */

  readJson(id, file) { try { const j = JSON.parse(fs.readFileSync(path.join(this.mc.dir(id), file), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
  writeJson(id, file, list) { fs.writeFileSync(path.join(this.mc.dir(id), file), JSON.stringify(list, null, 2) + '\n'); }
  lists(id) {
    const props = this.mc.properties(id);
    const known = this.known(id);
    const nameOf = (xuid) => (Object.entries(known).find(([, v]) => v.xuid === String(xuid)) || [])[0] || null;
    // Ältere Server hießen „whitelist.json“ – BDS liest heute allowlist.json
    const allow = this.readJson(id, 'allowlist.json').length || !fs.existsSync(path.join(this.mc.dir(id), 'whitelist.json')) ? this.readJson(id, 'allowlist.json') : this.readJson(id, 'whitelist.json');
    return {
      edition: 'bedrock',
      allowListOn: props['allow-list'] === 'true' || props['white-list'] === 'true',
      defaultPermission: props['default-player-permission-level'] || 'member',
      allowlist: allow.map((e) => ({ name: e.name || nameOf(e.xuid) || '', xuid: e.xuid ? String(e.xuid) : null, ignoresPlayerLimit: !!e.ignoresPlayerLimit })),
      permissions: this.readJson(id, 'permissions.json').map((e) => ({ xuid: String(e.xuid || ''), permission: e.permission, name: nameOf(e.xuid) })),
      known: Object.entries(known).map(([name, v]) => ({ name, xuid: v.xuid, seen: v.seen || null })).sort((a, b) => (b.seen || 0) - (a.seen || 0)),
      online: this.mc.proc(id).extra.players || [],
    };
  }
  /** Läuft er, liest er die Datei neu (sonst beim nächsten Start). */
  reload(id, what) { const p = this.mc.proc(id); if (p.child && p.extra.ready) p.write(`${what} reload`); }
  setAllow(id, name, on = true, { ignoresPlayerLimit = false } = {}) {
    const n = String(name || '').trim();
    if (!/^[\w .#-]{1,32}$/.test(n)) throw Object.assign(new Error(T('Invalid gamertag.')), { status: 400 });
    const xuid = (this.known(id)[n] || {}).xuid || null;
    let list = this.readJson(id, 'allowlist.json').filter((e) => String(e.name || '').toLowerCase() !== n.toLowerCase());
    if (on) list.push({ ignoresPlayerLimit: !!ignoresPlayerLimit, name: n, ...(xuid ? { xuid } : {}) });
    else if (xuid) list = list.filter((e) => String(e.xuid || '') !== xuid);
    this.writeJson(id, 'allowlist.json', list);
    this.reload(id, 'allowlist');
    return this.lists(id);
  }
  /** Rechte-Stufe (visitor/member/operator) – oder level null: zurück auf die Standardstufe des Servers. */
  setPermission(id, who, level) {
    const k = this.known(id);
    const w = String(who || '').trim();
    const xuid = /^\d{6,20}$/.test(w) ? w : (k[w] || Object.entries(k).find(([n]) => n.toLowerCase() === w.toLowerCase())?.[1] || {}).xuid;
    if (!xuid) throw Object.assign(new Error(T('“{w}” has never been on this server – Bedrock gives permissions by Xbox ID, which Hostwerk only learns on the first visit.', { w })), { status: 409 });
    if (level != null && !LEVELS.includes(level)) throw Object.assign(new Error(T('Unknown level.')), { status: 400 });
    const list = this.readJson(id, 'permissions.json').filter((e) => String(e.xuid) !== xuid);
    if (level) list.push({ permission: level, xuid });
    this.writeJson(id, 'permissions.json', list);
    this.reload(id, 'permission');
    return this.lists(id);
  }

  routes(r) {
    r.get('/mc/servers/:id/bedrock', (req, res) => { this.mc.get(req.params.id); res.json({ ...this.status(req.params.id), lists: this.lists(req.params.id), ports: { port: this.mc.get(req.params.id).port, portv6: this.mc.get(req.params.id).portv6 || null } }); });
    r.post('/mc/servers/:id/bedrock/check', async (req, res) => res.json(await this.check(req.params.id)));
    r.post('/mc/servers/:id/bedrock/update', (req, res) => { const b = req.body || {}; res.json({ job: this.update(req.params.id, { version: b.version || null, force: !!b.force }).id }); });
    r.post('/mc/servers/:id/bedrock/allowlist', (req, res) => { const b = req.body || {}; res.json(this.setAllow(req.params.id, b.name, b.remove !== true, { ignoresPlayerLimit: !!b.ignoresPlayerLimit })); });
    r.put('/mc/servers/:id/bedrock/permission', (req, res) => { const b = req.body || {}; res.json(this.setPermission(req.params.id, b.who, b.level || null)); });
  }
}

function stamp() { return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19); }
/** Ordner umbenennen – Windows gibt Sperren (Virenscanner, Index) manchmal erst nach einem Moment frei. */
async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) { if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; await sleep(250 * (i + 1)); }
  }
}

module.exports = { BedrockEdition, provider, releases, platformKey, versionOf, cmpVer, udpFree, tcpFree, readProps, templateInfo, udpPortsOf, KEEP, TEMPLATE_INFO, LINKS, LEVELS };
