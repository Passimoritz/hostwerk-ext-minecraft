'use strict';
/*
 * Modpacks von CurseForge. Die CurseForge-Schnittstelle verlangt einen eigenen API-Schlüssel (kostenlos unter
 * console.curseforge.com) – Hostwerk speichert ihn verschlüsselt in den Einstellungen und schickt ihn nur an
 * api.curseforge.com. Installiert wird wie bei Modrinth-Packs: passender Loader (Forge/NeoForge/Fabric) über Hostwerk,
 * dann alle Mods aus manifest.json und die overrides. Mods, deren Autor fremde Downloads verbietet, listet Hostwerk
 * zum Herunterladen von Hand auf.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secrets = require('./hw').core('secrets');
const { downloadFile, jobProgress, APP_UA } = require('./hw').core('download');
const { unzipTo } = require('./hw').core('util');

const API = 'https://api.curseforge.com/v1';
/** Basis-Adresse der Schnittstelle – nur in Testläufen (HW_TEST) auf eine Nachbildung umstellbar (scripts/lib/sim/curseforge.js). */
const apiBase = () => (process.env.HW_TEST && /^https?:\/\//.test(process.env.HW_CURSEFORGE_API || '') ? process.env.HW_CURSEFORGE_API.replace(/\/$/, '') : API);
const GAME = 432; // Minecraft
const CLASS_MODPACK = 4471;
const CLASS_MOD = 6;

/** Loader aus „forge-47.2.0“, „neoforge-21.1.1“, „fabric-0.15.7“. */
function parseLoader(id) {
  const m = String(id || '').match(/^(forge|neoforge|fabric|quilt)-(.+)$/i);
  if (!m) return null;
  return { type: m[1].toLowerCase(), version: m[2] };
}
/** Minecraft-Version aus den gameVersions einer CurseForge-Datei. */
const mcOf = (gv) => (gv || []).filter((x) => /^\d+\.\d+(\.\d+)?$/.test(x)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] || null;

class CurseForge {
  constructor(settings) { this.settings = settings; }
  get cfg() { const m = this.settings.get().minecraft; return m; }
  key() { const k = this.cfg.curseforgeKey; return k ? secrets.open(k) : ''; }
  hasKey() { return !!this.cfg.curseforgeKey; }
  setKey(key) {
    const k = String(key || '').trim();
    this.cfg.curseforgeKey = k ? secrets.seal(k) : undefined;
    this.settings.save();
  }
  async api(p, { method = 'GET', body } = {}) {
    const key = this.key();
    if (!key) throw Object.assign(new Error('Für CurseForge braucht Hostwerk deinen API-Schlüssel (kostenlos unter console.curseforge.com).'), { status: 412 });
    let res;
    // Zu viele Anfragen (429) bzw. kurz überlastet (503): wie verlangt warten (Retry-After, höchstens 15 s) und nochmal
    for (let attempt = 0; ; attempt++) {
      res = await fetch(apiBase() + p, { method, headers: { 'x-api-key': key, Accept: 'application/json', 'User-Agent': APP_UA, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      if ((res.status !== 429 && res.status !== 503) || attempt >= 2) break;
      const wait = Math.min(15, Math.max(1, Number(res.headers.get('retry-after')) || 2 * (attempt + 1)));
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
    if (res.status === 403 || res.status === 401) throw new Error('CurseForge lehnt den API-Schlüssel ab – bitte prüfen.');
    if (res.status === 429) throw new Error('CurseForge meldet zu viele Anfragen – bitte in ein paar Minuten nochmal versuchen.');
    if (!res.ok) throw new Error(`CurseForge antwortet mit ${res.status}`);
    return (await res.json()).data;
  }

  async search(q = '', offset = 0) {
    const params = new URLSearchParams({ gameId: GAME, classId: CLASS_MODPACK, searchFilter: q, sortField: q ? '1' : '2', sortOrder: 'desc', pageSize: '20', index: String(Number(offset) || 0) });
    const list = await this.api(`/mods/search?${params}`);
    return { hits: list.map((m) => ({ id: m.id, slug: m.slug, title: m.name, description: m.summary, icon: (m.logo && m.logo.thumbnailUrl) || null, downloads: m.downloadCount, versions: [...new Set((m.latestFilesIndexes || []).map((f) => f.gameVersion))].slice(0, 3), loaders: [...new Set((m.latestFilesIndexes || []).map((f) => ({ 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' })[f.modLoader]).filter(Boolean))], url: m.links && m.links.websiteUrl })) };
  }
  /** Neueste (oder gewählte) Datei des Packs mit Minecraft-Version und Loader. */
  async packInfo(modId, fileId) {
    // Neueste zuerst (CurseForge sagt keine Reihenfolge zu); Server-Packs sind eigene Dateien ohne manifest.json – nie wählen
    const files = (fileId ? [await this.api(`/mods/${Number(modId)}/files/${Number(fileId)}`)] : await this.api(`/mods/${Number(modId)}/files?pageSize=50`))
      .filter((x) => fileId || !x.isServerPack).sort((a, b) => String(b.fileDate || '').localeCompare(String(a.fileDate || '')));
    const f = files.find((x) => x.releaseType === 1) || files[0];
    if (!f) throw new Error('Dieses Modpack hat keine Dateien.');
    const gv = f.gameVersions || [];
    const loader = ['NeoForge', 'Forge', 'Fabric'].find((l) => gv.includes(l));
    return { id: f.id, number: f.displayName, name: f.displayName, mc: mcOf(gv), loader: loader ? loader.toLowerCase() : null, size: f.fileLength || null, serverPack: f.serverPackFileId || null, date: f.fileDate };
  }
  async downloadUrl(modId, fileId, known) {
    if (known) return known;
    try { return await this.api(`/mods/${Number(modId)}/files/${Number(fileId)}/download-url`); } catch { return null; }
  }

  /**
   * Pack installieren → { type, mc, build, launch?, jar?, modpack, manual[] } (gleiche Form wie bei Modrinth).
   * providers: Hostwerks Server-Programme (Loader-Installation), ctx: { paths, javaExe }.
   */
  async install({ projectId, fileId }, dir, job, ctx, providers) {
    const file = await this.api(`/mods/${Number(projectId)}/files/${Number(fileId)}`);
    const url = await this.downloadUrl(projectId, fileId, file.downloadUrl);
    if (!url) throw new Error('Der Autor erlaubt keinen Download über andere Programme – bitte das Pack auf curseforge.com laden.');
    const tmp = path.join(ctx.paths.cache, `curseforge-${crypto.randomBytes(4).toString('hex')}`);
    const zip = tmp + '.zip';
    try {
      await downloadFile(url, zip, { onProgress: jobProgress(job, `Modpack ${file.displayName} herunterladen`, 36, 40) });
      await unzipTo(zip, tmp);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')); } catch { throw new Error('Das Paket enthält keine manifest.json – ist es wirklich ein CurseForge-Modpack?'); }
      const mc = manifest.minecraft && manifest.minecraft.version;
      const prim = ((manifest.minecraft && manifest.minecraft.modLoaders) || []).find((l) => l.primary) || ((manifest.minecraft && manifest.minecraft.modLoaders) || [])[0];
      const L = parseLoader(prim && prim.id);
      if (!mc || !L) throw new Error('Minecraft-Version oder Loader fehlen in der manifest.json.');
      if (!providers[L.type]) throw new Error(`Dieses Modpack nutzt ${L.type} – Hostwerk unterstützt Fabric, NeoForge und Forge.`);
      job.log(`Modpack ${file.displayName} – Minecraft ${mc}, ${providers[L.type].label} ${L.version}`);
      const r = await providers[L.type].download(mc, path.join(dir, 'server.jar'), job, { ...ctx, loaderVersion: L.version, noExtras: true });
      // Mods: Dateien und Projekte in Gruppen abfragen (Download-Link, Art, nur-Client)
      const entries = (manifest.files || []).filter((x) => x.required !== false);
      const infos = [];
      for (let i = 0; i < entries.length; i += 100) infos.push(...(await this.api('/mods/files', { method: 'POST', body: { fileIds: entries.slice(i, i + 100).map((x) => x.fileID) } })));
      const mods = [];
      for (let i = 0; i < entries.length; i += 100) mods.push(...(await this.api('/mods', { method: 'POST', body: { modIds: entries.slice(i, i + 100).map((x) => x.projectID) } })));
      // Dateien, die CurseForge nicht mehr kennt (vom Autor gelöscht), fehlen in der Antwort – nicht still übergehen
      const known = new Set(infos.map((f) => f.id));
      const gone = entries.filter((x) => !known.has(x.fileID));
      const classOf = new Map(mods.map((m) => [m.id, m.classId]));
      const nameOf = new Map(mods.map((m) => [m.id, m.name]));
      fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
      const manual = gone.map((x) => { const m = mods.find((y) => y.id === x.projectID); return { name: (m && m.name) || `Projekt ${x.projectID}`, file: null, url: `https://www.curseforge.com/minecraft/mc-mods/${(m && m.slug) || x.projectID}/files/${x.fileID}`, gone: true }; });
      let loaded = 0; let skipped = 0;
      for (const [i, f] of infos.entries()) {
        job.progress(60 + (i / Math.max(1, infos.length)) * 32, `Mods laden (${i + 1}/${infos.length}) …`);
        const gv = f.gameVersions || [];
        // Nur Mods (keine Shader/Ressourcenpakete) und nichts, was ausdrücklich nur im Spiel läuft
        if ((classOf.get(f.modId) || CLASS_MOD) !== CLASS_MOD || (gv.includes('Client') && !gv.includes('Server'))) { skipped++; continue; }
        const u = await this.downloadUrl(f.modId, f.id, f.downloadUrl);
        if (!u) { manual.push({ name: nameOf.get(f.modId) || f.fileName, file: f.fileName, url: `https://www.curseforge.com/minecraft/mc-mods/${(mods.find((m) => m.id === f.modId) || {}).slug || f.modId}/files/${f.id}` }); continue; }
        const sha1 = ((f.hashes || []).find((h) => h.algo === 1) || {}).value;
        await downloadFile(u, path.join(dir, 'mods', path.basename(f.fileName)), sha1 ? { sha1 } : {});
        loaded++;
      }
      // overrides (Einstellungen, Skripte) übernehmen – ohne reine Spiel-Ordner
      const ov = path.join(tmp, manifest.overrides || 'overrides');
      if (fs.existsSync(ov)) for (const e of fs.readdirSync(ov)) if (!['resourcepacks', 'shaderpacks', 'screenshots', 'options.txt'].includes(e)) fs.cpSync(path.join(ov, e), path.join(dir, e), { recursive: true });
      job.log(`${loaded} Mods geladen${skipped ? `, ${skipped} nur fürs Spiel bzw. keine Mods übersprungen` : ''}.`);
      const blocked = manual.filter((m) => !m.gone);
      if (blocked.length) job.log(`Von Hand herunterladen und in den Ordner „mods“ legen (der Autor erlaubt keinen Download über andere Programme): ${blocked.map((m) => `${m.name} – ${m.url}`).join(' · ')}`);
      if (gone.length) job.log(`Bei CurseForge nicht mehr vorhanden (im Pack noch eingetragen) – passende Version von Hand suchen: ${manual.filter((m) => m.gone).map((m) => `${m.name} – ${m.url}`).join(' · ')}`);
      return { ...r, type: L.type, mc, modpack: { source: 'curseforge', projectId: Number(projectId), fileId: Number(fileId), version: file.displayName, name: manifest.name || file.displayName }, manual };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(zip, { force: true });
    }
  }

  routes(r) {
    r.get('/mc/curseforge', (req, res) => res.json({ hasKey: this.hasKey() }));
    r.put('/mc/curseforge/key', async (req, res) => {
      const key = String((req.body || {}).key || '').trim();
      const old = this.cfg.curseforgeKey;
      this.setKey(key);
      if (key) { try { await this.api('/games/432'); } catch (e) { this.cfg.curseforgeKey = old; this.settings.save(); throw e; } }
      res.json({ hasKey: this.hasKey() });
    });
    r.get('/mc/curseforge/modpacks', async (req, res) => res.json(await this.search(String(req.query.q || ''), req.query.offset)));
    r.get('/mc/curseforge/modpacks/:id', async (req, res) => res.json(await this.packInfo(req.params.id, req.query.file)));
  }
}

module.exports = { CurseForge, parseLoader, mcOf, apiBase };
