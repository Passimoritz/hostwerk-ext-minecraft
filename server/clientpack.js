'use strict';
/*
 * Client-Paket für Spieler: die Mods eines Mod-Servers als Modrinth-Modpack (.mrpack), das Freunde in der
 * Modrinth-App, Prism Launcher oder ATLauncher importieren – mit genau den Mods, die sie zum Mitspielen brauchen.
 *
 *   Mods von Modrinth      → als Download-Verweis (Datei-Hash stimmt mit dem Server überein)
 *   reine Server-Mods      → bleiben weg (Modrinth: client_side = "unsupported", z. B. Chunky, FabricProxy-Lite)
 *   unbekannte Mods        → werden ins Paket gelegt (overrides/mods)
 *   Einstellungen (config) → auf Wunsch, ohne Dateien mit Geheimnissen (Schlüssel, Passwörter)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipDir, slug } = require('./hw').core('util');
const { APP_UA, fetchJson } = require('./hw').core('download');

const MR = 'https://api.modrinth.com/v2';
const LOADER_KEY = { fabric: 'fabric-loader', neoforge: 'neoforge', forge: 'forge' };
const SECRET_FILE = /secret|password|passwort|token|fabricproxy|velocity|discord|webhook/i;

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': APP_UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Modrinth antwortet mit ${res.status}`);
  return res.json();
}

class ClientPack {
  constructor(mc) { this.mc = mc; }

  /** Welche Mods ins Paket kommen (und warum nicht). */
  async analyze(id) {
    const s = this.mc.get(id);
    if (this.mc.content(s) !== 'mods' || !LOADER_KEY[s.type]) throw new Error('Ein Client-Paket gibt es nur für Mod-Server (Fabric, NeoForge, Forge).');
    const dir = this.mc.addonDir(id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jar$/i.test(f)) : []; // deaktivierte (.disabled) bleiben weg
    const mods = files.map((file) => {
      const buf = fs.readFileSync(path.join(dir, file));
      return { file, size: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex'), sha512: crypto.createHash('sha512').update(buf).digest('hex') };
    });
    let known = {};
    let projects = {};
    if (mods.length) {
      known = await post(`${MR}/version_files`, { hashes: mods.map((m) => m.sha1), algorithm: 'sha1' });
      const ids = [...new Set(Object.values(known).map((v) => v.project_id))];
      if (ids.length) for (const p of await fetchJson(`${MR}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)) projects[p.id] = p;
    }
    for (const m of mods) {
      const v = known[m.sha1];
      if (!v) { Object.assign(m, { name: m.file.replace(/\.jar$/i, ''), source: 'datei', include: true, note: 'nicht auf Modrinth – wird mitgepackt' }); continue; }
      const p = projects[v.project_id] || {};
      const f = v.files.find((x) => x.hashes && x.hashes.sha1 === m.sha1) || v.files[0];
      Object.assign(m, { name: p.title || v.name, source: 'modrinth', url: f && f.url, clientSide: p.client_side || 'unknown', include: p.client_side !== 'unsupported', note: p.client_side === 'unsupported' ? 'nur für den Server – Spieler brauchen ihn nicht' : p.client_side === 'optional' ? 'für Spieler optional' : '' });
    }
    return { server: { id: s.id, name: s.name, mc: s.version, loader: s.type, loaderVersion: s.build }, mods };
  }

  /** .mrpack bauen → Pfad der Datei (wird nach dem Senden gelöscht). */
  async build(id, { config = false } = {}) {
    const a = await this.analyze(id);
    const s = this.mc.get(id);
    if (!a.server.loaderVersion) throw new Error('Die Loader-Version des Servers ist unbekannt – bitte unter „Version“ einmal neu laden.');
    const stage = path.join(this.mc.paths.cache, `clientpack-${id}-${Date.now()}`);
    fs.mkdirSync(path.join(stage, 'overrides', 'mods'), { recursive: true });
    const files = [];
    for (const m of a.mods.filter((x) => x.include)) {
      if (m.source === 'modrinth' && m.url) {
        files.push({ path: `mods/${m.file}`, hashes: { sha1: m.sha1, sha512: m.sha512 }, env: { client: m.clientSide === 'optional' ? 'optional' : 'required', server: 'required' }, downloads: [m.url], fileSize: m.size });
      } else fs.copyFileSync(path.join(this.mc.addonDir(id), m.file), path.join(stage, 'overrides', 'mods', m.file));
    }
    if (config) {
      const src = path.join(this.mc.dir(id), 'config');
      if (fs.existsSync(src)) fs.cpSync(src, path.join(stage, 'overrides', 'config'), { recursive: true, filter: (f) => !SECRET_FILE.test(path.basename(f)) });
    }
    const index = {
      formatVersion: 1, game: 'minecraft',
      versionId: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      name: `${s.name} (Client)`,
      summary: `Client-Paket für den Server „${s.name}“ – erstellt mit Hostwerk.`,
      files,
      dependencies: { minecraft: a.server.mc, [LOADER_KEY[a.server.loader]]: a.server.loaderVersion },
    };
    fs.writeFileSync(path.join(stage, 'modrinth.index.json'), JSON.stringify(index, null, 2));
    const out = path.join(this.mc.paths.cache, `${slug(s.name) || 'server'}-client.mrpack`);
    fs.rmSync(out, { force: true });
    // tar wählt das Format nach der Endung – also erst als .zip anlegen, dann umbenennen
    await zipDir(stage, out + '.zip');
    fs.renameSync(out + '.zip', out);
    fs.rmSync(stage, { recursive: true, force: true });
    return { file: out, name: `${slug(s.name) || 'server'}-client.mrpack`, count: files.length + a.mods.filter((x) => x.include && x.source !== 'modrinth').length };
  }

  routes(r) {
    r.get('/mc/servers/:id/client-pack', async (req, res) => res.json(await this.analyze(req.params.id)));
    r.get('/mc/servers/:id/client-pack/download', async (req, res) => {
      const b = await this.build(req.params.id, { config: req.query.config === '1' });
      res.download(b.file, b.name, () => fs.rmSync(b.file, { force: true }));
    });
  }
}

module.exports = { ClientPack };
