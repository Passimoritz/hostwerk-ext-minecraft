'use strict';
/*
 * Velocity-Netzwerk: mehrere Hostwerk-Server hinter einem Velocity-Proxy verbinden (Lobby, Survival, Minispiele).
 *
 * Sicher per „modern forwarding“: Der Proxy meldet die Spieler mit einem geheimen Schlüssel (forwarding.secret)
 * an die Server weiter. Die Server selbst lauschen danach nur noch auf 127.0.0.1 (nur der Proxy erreicht sie)
 * und prüfen Accounts nicht mehr selbst (online-mode=false) – das übernimmt der Proxy.
 *   Paper/Purpur/Folia: config/paper-global.yml → proxies.velocity
 *   Fabric:             Mod „FabricProxy-Lite“ + config/FabricProxy-Lite.toml
 *   NeoForge/Forge:     Mod „Proxy Compatible Forge“ + config/proxy-compatible-forge.toml
 * Lobby-Vorlage: legt einen kleinen Paper-Server (flache Welt, Abenteuer, friedlich) an und setzt ihn an die erste Stelle.
 * Wird ein Server aus dem Netzwerk genommen, stellt Hostwerk seine vorherigen Werte wieder her.
 *
 * Forced hosts (SDK 3.2): apply(id, { members, forcedHosts: { "survival.example.org": ["survival"] } }) leitet Spieler je
 * Adresse (Subdomain) direkt auf einen Server – die Erweiterung „Minecraft-Servernetzwerk“ nutzt das. Ohne forcedHosts
 * bleibt der Abschnitt leer wie bisher. Nur Velocity – BungeeCord-Netzwerke richtet die Erweiterung selbst ein.
 */
const fs = require('fs');
const path = require('path');
const YAML = require('./hw').lib('yaml');
const { runJob } = require('./hw').core('jobs');
const { fetchJson, downloadFile } = require('./hw').core('download');

const MR = 'https://api.modrinth.com/v2';
const COMPAT = { paper: 'paper', purpur: 'paper', folia: 'paper', fabric: 'fabric', neoforge: 'forge', forge: 'forge' };
// Proxy-Mods je Loader: Modrinth-Slug und Erkennung der Datei
const PROXY_MOD = { fabric: { slug: 'fabricproxy-lite', name: 'FabricProxy-Lite', re: /fabricproxy-lite/i }, forge: { slug: 'proxy-compatible-forge', name: 'Proxy Compatible Forge', re: /proxy-?compatible-?forge|^pcf-/i } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'server';

function readProps(file) {
  const out = {};
  try { for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const m = l.match(/^([\w.-]+)=(.*)$/); if (m) out[m[1]] = m[2]; } } catch { /* fehlt */ }
  return out;
}
function writeProps(file, values) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = '#Minecraft server properties\n'; }
  const done = new Set();
  const lines = text.split(/\r?\n/).map((l) => {
    const m = l.match(/^([\w.-]+)=/);
    if (m && m[1] in values) { done.add(m[1]); return `${m[1]}=${values[m[1]]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(values)) if (!done.has(k)) lines.push(`${k}=${v}`);
  fs.writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));
}
/** Abschnitt [name] in TOML ersetzen (bis zum nächsten [abschnitt]) – oder anhängen. */
function replaceSection(toml, name, body) {
  const re = new RegExp(`^\\[${name.replace(/[-]/g, '\\-')}\\][^\\n]*\\n[\\s\\S]*?(?=^\\[[^\\]\\n]+\\]\\s*$|(?![\\s\\S]))`, 'm');
  const block = `[${name}]\n${body}\n\n`;
  return re.test(toml) ? toml.replace(re, block) : `${toml.replace(/\n*$/, '\n\n')}${block}`;
}
/**
 * Forced hosts prüfen: Adresse (Domain/Subdomain, klein) → Liste von Netzwerk-Namen, die es geben muss. Wirft bei Unsinn.
 * → TOML-Zeilen für [forced-hosts]
 */
function forcedHostLines(forced, keys) {
  const out = [];
  for (const [host, list] of Object.entries(forced || {})) {
    const h = String(host).trim().toLowerCase();
    if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(h)) throw new Error(`„${host}“ ist keine gültige Adresse für forced hosts.`);
    const targets = [].concat(list || []).map(String);
    if (!targets.length || targets.some((k) => !keys.includes(k))) throw new Error(`forced host „${h}“ zeigt auf einen Server, der nicht im Netzwerk ist.`);
    out.push(`"${h}" = [${targets.map((k) => `"${k}"`).join(', ')}]`);
  }
  return out;
}
/** [servers]-Abschnitt lesen: { servers: {name: adresse}, try: [...] } */
function parseServers(toml) {
  const m = String(toml || '').match(/^\[servers\][^\n]*\n([\s\S]*?)(?=^\[[^\]\n]+\]\s*$|(?![\s\S]))/m);
  const out = { servers: {}, try: [] };
  if (!m) return out;
  const body = m[1].replace(/#.*$/gm, '');
  const t = body.match(/^\s*try\s*=\s*\[([\s\S]*?)\]/m);
  if (t) out.try = [...t[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const l of body.replace(/^\s*try\s*=\s*\[[\s\S]*?\]/m, '').split(/\r?\n/)) {
    const kv = l.match(/^\s*"?([\w-]+)"?\s*=\s*"([^"]+)"/);
    if (kv) out.servers[kv[1]] = kv[2];
  }
  return out;
}

class Network {
  constructor(mc) { this.mc = mc; }
  tomlFile(id) { return path.join(this.mc.dir(id), 'velocity.toml'); }
  secret(id) { try { return fs.readFileSync(path.join(this.mc.dir(id), 'forwarding.secret'), 'utf8').trim(); } catch { return null; } }

  status(id) {
    const proxy = this.mc.get(id);
    if (!this.mc.isProxy(proxy)) throw new Error('Das ist kein Velocity-Proxy.');
    if (proxy.type !== 'velocity') throw new Error('Dieses Netzwerk (BungeeCord) richtet die Erweiterung „Minecraft-Servernetzwerk“ ein.');
    let toml = null;
    try { toml = fs.readFileSync(this.tomlFile(id), 'utf8'); } catch { /* noch nie gestartet */ }
    const cfg = parseServers(toml);
    const mode = toml ? ((toml.match(/^\s*player-info-forwarding-mode\s*=\s*"([^"]+)"/m) || [])[1] || null) : null;
    // Bedrock Dedicated Server kann nicht hinter einen Java-Proxy (Bedrock-Spieler kommen über Geyser am Proxy)
    const candidates = this.mc.list().filter((s) => s.id !== id && !this.mc.isProxy(s) && !(this.mc.isBedrock && this.mc.isBedrock(s))).map((s) => ({
      id: s.id, name: s.name, type: s.type, version: s.version, port: s.port,
      compat: COMPAT[s.type] || null,
      member: !!(s.network && s.network.proxy === id),
      key: (s.network && s.network.proxy === id && s.network.key) || keyName(s.name),
      running: this.mc.proc(s.id).isRunning(),
    }));
    return { configured: !!toml, mode, servers: cfg.servers, try: cfg.try, candidates, port: proxy.port, secret: !!this.secret(id) };
  }

  /** Server einmal starten und wieder stoppen, damit er seine Einstellungsdateien anlegt. */
  async startOnce(id, job, label) {
    job.log(`${label} einmal starten, damit die Einstellungen angelegt werden …`);
    await this.mc.start(id);
    const p = this.mc.proc(id);
    for (let i = 0; i < 360 && !p.extra.ready && p.isRunning(); i++) await sleep(500);
    const ready = !!p.extra.ready; // stop() setzt „ready“ zurück – vorher merken
    await this.mc.stop(id);
    if (!ready) throw new Error(`${label} ist beim ersten Start nicht bereit geworden – siehe Konsole.`);
  }

  /** Netzwerk speichern: members = [{ id, key }] in der gewünschten Reihenfolge (erster = Lobby/Einstieg). */
  apply(id, { members = [], forcedHosts = null } = {}) {
    const proxy = this.mc.get(id);
    if (!this.mc.isProxy(proxy) || proxy.type !== 'velocity') throw new Error('Das ist kein Velocity-Proxy.');
    return runJob(`Netzwerk von „${proxy.name}“ einrichten`, async (job) => {
      const all = this.mc.list();
      const wanted = members.map((m) => ({ s: all.find((x) => x.id === m.id), key: keyName(m.key || m.id) })).filter((m) => m.s && !this.mc.isProxy(m.s));
      for (const m of wanted) if (!COMPAT[m.s.type]) throw new Error(`„${m.s.name}“ (${m.s.type}) kann nicht hinter Velocity laufen – möglich sind Paper, Purpur, Folia, Fabric, NeoForge und Forge.`);
      const keys = wanted.map((m) => m.key);
      if (new Set(keys).size !== keys.length) throw new Error('Jeder Server braucht im Netzwerk einen eigenen Namen.');
      const forcedLines = forcedHostLines(forcedHosts, keys); // vor allen Änderungen prüfen
      const running = new Set(all.filter((s) => this.mc.proc(s.id).isRunning()).map((s) => s.id));

      // 1) Proxy-Einstellungen anlegen lassen (velocity.toml, forwarding.secret)
      if (!fs.existsSync(this.tomlFile(id)) || !this.secret(id)) {
        if (running.has(id)) await this.mc.stop(id);
        await this.startOnce(id, job, proxy.name);
      }
      const secret = this.secret(id);
      if (!secret) throw new Error('Velocity hat keinen Weiterleitungs-Schlüssel (forwarding.secret) angelegt.');

      // 2) Server ins Netzwerk nehmen
      let n = 0;
      for (const { s, key } of wanted) {
        job.progress(15 + (n++ / Math.max(1, wanted.length)) * 60, `„${s.name}“ verbinden …`);
        const dir = this.mc.dir(s.id);
        if (this.mc.proc(s.id).isRunning()) await this.mc.stop(s.id);
        const kind = COMPAT[s.type];
        if (kind === 'paper') {
          const file = path.join(dir, 'config', 'paper-global.yml');
          if (!fs.existsSync(file)) await this.startOnce(s.id, job, s.name);
          const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
          doc.setIn(['proxies', 'velocity', 'enabled'], true);
          doc.setIn(['proxies', 'velocity', 'online-mode'], true);
          doc.setIn(['proxies', 'velocity', 'secret'], secret);
          fs.writeFileSync(file, String(doc));
        } else if (kind === 'fabric') {
          await this.ensureProxyMod(s, 'fabric', job);
          const conf = path.join(dir, 'config', 'FabricProxy-Lite.toml');
          fs.mkdirSync(path.dirname(conf), { recursive: true });
          let t = fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : 'hackOnlineMode = true\nhackEarlySend = false\nhackMessageChain = true\ndisconnectMessage = "Bitte über den Netzwerk-Proxy verbinden."\n';
          t = /^\s*secret\s*=/m.test(t) ? t.replace(/^\s*secret\s*=.*$/m, `secret = "${secret}"`) : `${t.replace(/\n*$/, '\n')}secret = "${secret}"\n`;
          fs.writeFileSync(conf, t);
        } else if (kind === 'forge') {
          await this.ensureProxyMod(s, 'forge', job);
          const conf = path.join(dir, 'config', 'proxy-compatible-forge.toml');
          fs.mkdirSync(path.dirname(conf), { recursive: true });
          const t = fs.existsSync(conf) ? fs.readFileSync(conf, 'utf8') : '';
          fs.writeFileSync(conf, replaceSection(t, 'forwarding', `enabled = true\nmode = "MODERN"\nsecret = "${secret}"\napprovedProxyHosts = []`));
        }
        // Nur noch der Proxy erreicht den Server; Accounts prüft der Proxy
        const propsFile = path.join(dir, 'server.properties');
        const props = readProps(propsFile);
        if (!(s.network && s.network.proxy === id)) s.network = { proxy: id, prevOnline: props['online-mode'] || 'true', prevIp: props['server-ip'] || '' };
        s.network.key = key;
        writeProps(propsFile, { 'online-mode': 'false', 'server-ip': '127.0.0.1' });
        job.log(`✓ „${s.name}“ als „${key}“ (127.0.0.1:${s.port})`);
      }

      // 3) Server, die nicht mehr dazugehören, wiederherstellen
      for (const s of all.filter((x) => x.network && x.network.proxy === id && !wanted.some((m) => m.s.id === x.id))) {
        if (this.mc.proc(s.id).isRunning()) await this.mc.stop(s.id);
        const dir = this.mc.dir(s.id);
        writeProps(path.join(dir, 'server.properties'), { 'online-mode': s.network.prevOnline || 'true', 'server-ip': s.network.prevIp || '' });
        const file = path.join(dir, 'config', 'paper-global.yml');
        if (fs.existsSync(file)) { const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8')); doc.setIn(['proxies', 'velocity', 'enabled'], false); fs.writeFileSync(file, String(doc)); }
        // Proxy-Mods abschalten – sonst lassen sie keine direkten Verbindungen mehr zu
        const mods = path.join(dir, 'mods');
        if (fs.existsSync(mods)) for (const f of fs.readdirSync(mods)) if (/\.jar$/i.test(f) && Object.values(PROXY_MOD).some((pm) => pm.re.test(f))) fs.renameSync(path.join(mods, f), path.join(mods, f + '.disabled'));
        job.log(`„${s.name}“ aus dem Netzwerk genommen – wieder direkt erreichbar.`);
        delete s.network;
      }

      // 4) velocity.toml: Server-Liste, Reihenfolge, modern forwarding; Beispiel-„forced hosts“ entfernen
      job.progress(85, 'Proxy-Einstellungen schreiben …');
      if (running.has(id) && this.mc.proc(id).isRunning()) await this.mc.stop(id);
      let toml = fs.readFileSync(this.tomlFile(id), 'utf8');
      toml = /^\s*player-info-forwarding-mode\s*=/m.test(toml) ? toml.replace(/^(\s*player-info-forwarding-mode\s*=\s*).*$/m, '$1"modern"') : `player-info-forwarding-mode = "modern"\n${toml}`;
      const lines = ['# Von Hostwerk verwaltet (Minecraft → Proxy → Netzwerk) – Änderungen dort vornehmen', ...wanted.map((m) => `${m.key} = "127.0.0.1:${m.s.port}"`), `try = [${wanted.map((m) => `"${m.key}"`).join(', ')}]`];
      toml = replaceSection(toml, 'servers', lines.join('\n'));
      toml = replaceSection(toml, 'forced-hosts', forcedLines.length ? ['# Von Hostwerk verwaltet – Adresse → Server', ...forcedLines].join('\n') : '# (leer – Hostwerk nutzt die Reihenfolge unter [servers])');
      fs.writeFileSync(this.tomlFile(id), toml);
      this.mc.settings.save();

      // 5) Wieder starten, was vorher lief
      job.progress(92, 'Neu starten …');
      for (const sid of running) { try { await this.mc.start(sid); } catch (e) { job.log(`Start von ${sid}: ${e.message}`); } }
      return this.status(id);
    }, { key: `mc-network-${id}` });
  }

  /** Proxy-Mod für den Loader sicherstellen (abgeschaltete wieder einschalten, sonst passende Version laden). */
  async ensureProxyMod(s, kind, job) {
    const pm = PROXY_MOD[kind];
    const mods = path.join(this.mc.dir(s.id), 'mods');
    fs.mkdirSync(mods, { recursive: true });
    const files = fs.readdirSync(mods);
    if (files.some((f) => /\.jar$/i.test(f) && pm.re.test(f))) return;
    const off = files.find((f) => /\.jar\.disabled$/i.test(f) && pm.re.test(f));
    if (off) { fs.renameSync(path.join(mods, off), path.join(mods, off.replace(/\.disabled$/i, ''))); job.log(`${pm.name} für „${s.name}“ wieder eingeschaltet.`); return; }
    const q = `loaders=${encodeURIComponent(JSON.stringify([s.type]))}&game_versions=${encodeURIComponent(JSON.stringify([s.version]))}`;
    const v = (await fetchJson(`${MR}/project/${pm.slug}/version?${q}`))[0];
    if (!v) throw new Error(`${pm.name} gibt es (noch) nicht für ${s.type === 'neoforge' ? 'NeoForge' : s.type === 'forge' ? 'Forge' : 'Fabric'} ${s.version} – „${s.name}“ kann deshalb noch nicht hinter Velocity. Sobald die Mod erscheint, klappt es mit demselben Knopf.`);
    const f = v.files.find((x) => x.primary) || v.files[0];
    await downloadFile(f.url, path.join(mods, path.basename(f.filename)), { sha1: f.hashes && f.hashes.sha1 });
    job.log(`${pm.name} ${v.version_number} für „${s.name}“ installiert.`);
  }

  /** Lobby-Vorlage: kleiner Paper-Server (flach, Abenteuer, friedlich) als Einstieg ins Netzwerk. */
  createLobby(id, { name = 'Lobby' } = {}) {
    const proxy = this.mc.get(id);
    if (!this.mc.isProxy(proxy)) throw new Error('Das ist kein Velocity-Proxy.');
    return runJob(`Lobby für „${proxy.name}“ anlegen`, async (job) => {
      const { providers } = require('./providers');
      const ver = (await providers.paper.versions()).latest;
      job.progress(5, `Paper ${ver} für die Lobby laden …`);
      const r = await this.mc.create({ type: 'paper', version: ver, name, eula: true, memMax: 2048, gamemode: 'adventure', difficulty: 'peaceful', maxPlayers: 100, onlineMode: true });
      const res = await r.promise;
      const lobby = this.mc.get(res.id);
      writeProps(path.join(this.mc.dir(lobby.id), 'server.properties'), {
        'level-type': 'minecraft\\:flat', 'generate-structures': 'false', 'spawn-monsters': 'false', pvp: 'false', 'allow-nether': 'false',
        'spawn-protection': '0', 'force-gamemode': 'true', motd: `${proxy.name} – Lobby`,
      });
      job.log('Lobby angelegt: flache Welt, Abenteuermodus, friedlich, kein PvP. Gestalten: Server starten und in der Konsole „gamemode creative <Name>“.');
      // An die erste Stelle des Netzwerks
      const st = this.status(id);
      const members = [{ id: lobby.id, key: 'lobby' }, ...st.candidates.filter((c) => c.member).map((c) => ({ id: c.id, key: c.key }))];
      job.progress(70, 'Lobby ins Netzwerk aufnehmen …');
      await this.apply(id, { members }).promise;
      return { id: lobby.id };
    }, { key: `mc-lobby-${id}` });
  }

  routes(r) {
    r.post('/mc/servers/:id/network/lobby', (req, res) => res.json({ job: this.createLobby(req.params.id, req.body || {}).id }));
    r.get('/mc/servers/:id/network', (req, res) => res.json(this.status(req.params.id)));
    r.post('/mc/servers/:id/network', (req, res) => res.json({ job: this.apply(req.params.id, req.body || {}).id }));
  }
}

module.exports = { Network, parseServers, replaceSection, keyName, forcedHostLines };
