'use strict';
/*
 * Plugin-Marktplatz für Minecraft-Server: durchsucht Modrinth und Hangar (PaperMC) gemeinsam – mit Kategorien,
 * Sortierung, Detailansicht (Beschreibung, Bilder, Links) und Versionswahl. Installierte Plugins merkt sich
 * Hostwerk in plugins/.hostwerk-quellen.json, damit sie im Marktplatz als „installiert“ erscheinen und
 * auch Hangar-Plugins Updates bekommen.
 */
const fs = require('fs');
const path = require('path');
const { runJob } = require('./hw').core('jobs');
const { fetchJson, downloadFile, cached } = require('./hw').core('download');
const { providers } = require('./providers');

const MR = 'https://api.modrinth.com/v2';
const HG = 'https://hangar.papermc.io/api/v1';
const LIMIT = 20;

/** Gemeinsame Kategorien → Modrinth-Kategorie / Hangar-Kategorie (null = Quelle hat keine passende). */
const CATEGORIES = [
  { id: 'admin', label: 'Verwaltung', modrinth: 'management', hangar: 'admin_tools' },
  { id: 'protection', label: 'Schutz & Anti-Cheat', modrinth: null, hangar: 'protection' },
  { id: 'chat', label: 'Chat & Soziales', modrinth: 'social', hangar: 'chat' },
  { id: 'economy', label: 'Wirtschaft', modrinth: 'economy', hangar: 'economy' },
  { id: 'gameplay', label: 'Spielmechanik', modrinth: 'game-mechanics', hangar: 'gameplay' },
  { id: 'minigames', label: 'Minispiele', modrinth: 'minigame', hangar: 'games' },
  { id: 'world', label: 'Welten', modrinth: 'worldgen', hangar: 'world_management' },
  { id: 'rpg', label: 'Abenteuer & RPG', modrinth: 'adventure', hangar: 'role_playing' },
  { id: 'performance', label: 'Leistung', modrinth: 'optimization', hangar: null },
  { id: 'utility', label: 'Werkzeuge', modrinth: 'utility', hangar: 'misc' },
  { id: 'library', label: 'Bibliotheken', modrinth: 'library', hangar: 'dev_tools' },
  // Nur für Mod-Server
  { id: 'tech', label: 'Technik', modrinth: 'technology', hangar: null, mods: true },
  { id: 'magic', label: 'Magie', modrinth: 'magic', hangar: null, mods: true },
  { id: 'storage', label: 'Lager', modrinth: 'storage', hangar: null, mods: true },
  { id: 'mobs', label: 'Kreaturen', modrinth: 'mobs', hangar: null, mods: true },
  { id: 'decoration', label: 'Deko & Bauen', modrinth: 'decoration', hangar: null, mods: true },
];
const SORTS = { relevance: { modrinth: 'relevance', hangar: '-downloads' }, downloads: { modrinth: 'downloads', hangar: '-downloads' }, updated: { modrinth: 'updated', hangar: '-updated' }, newest: { modrinth: 'newest', hangar: '-newest' } };

const mmOf = (v) => String(v || '').split('.').slice(0, 2).join('.');
const cmpMc = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/**
 * Kompatibilität auf einen Blick: welche Minecraft-Versionen das Plugin überhaupt unterstützt (über alle Versionen)
 * und ob die des Servers dabei ist. „nur bis 1.20.4“ = neueste unterstützte Version liegt unter der des Servers.
 */
function compatSummary(versions, serverVersion) {
  const all = [...new Set(versions.flatMap((v) => v.gameVersions || []).filter((x) => /^\d+\.\d+(\.\d+)?(\.x)?$/.test(x)).map((x) => x.replace(/\.x$/, '')))].sort(cmpMc);
  if (!all.length) return { known: false };
  const min = all[0]; const max = all[all.length - 1];
  const fits = !serverVersion || versions.some((v) => v.fits);
  const newer = serverVersion && cmpMc(serverVersion, max) > 0 && !versions.some((v) => v.fits);
  return { known: true, min, max, fits, status: !serverVersion ? 'unknown' : fits ? 'ok' : newer ? 'too-new' : 'other', serverVersion: serverVersion || null };
}

class PluginMarket {
  constructor(mc) { this.mc = mc; }

  server(id) {
    const s = this.mc.get(id);
    const loaders = (providers[s.type] && providers[s.type].loaders) || ['paper', 'spigot', 'bukkit'];
    const version = s.version && s.type !== 'custom' ? s.version : null;
    // Mod-Server (Fabric, NeoForge, Forge): Modrinth-Mods statt Plugins, Ordner mods/
    const kind = this.mc.content(s) === 'mods' ? 'mod' : 'plugin';
    // Hangar kennt Paper- und Velocity-Plugins (getrennte Plattformen)
    const platform = loaders.includes('velocity') ? 'VELOCITY' : loaders.includes('paper') ? 'PAPER' : null;
    // Velocity-Versionen (4.2.0 …) haben mit Minecraft-Versionen nichts zu tun – nicht danach filtern
    return { s, loaders, version: loaders.includes('velocity') ? null : version, kind, platform };
  }

  /* ---------- Merkliste: welche JAR stammt aus welcher Quelle ---------- */
  sourcesFile(id) { return path.join(this.mc.addonDir(id), '.hostwerk-quellen.json'); }
  sources(id) { try { return JSON.parse(fs.readFileSync(this.sourcesFile(id), 'utf8')); } catch { return {}; } }
  saveSources(id, data) { fs.mkdirSync(path.dirname(this.sourcesFile(id)), { recursive: true }); fs.writeFileSync(this.sourcesFile(id), JSON.stringify(data, null, 2)); }

  /** Installierte Plugins (Quelle:ID und Namen) für die Kennzeichnung in Suchergebnissen. */
  async installedIndex(id) {
    const src = this.sources(id);
    const dir = this.mc.addonDir(id);
    const files = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
    const keys = new Map();
    for (const [file, x] of Object.entries(src)) if (files.has(file) || files.has(file + '.disabled')) keys.set(`${x.source}:${x.id}`, { file, version: x.version });
    const names = new Map((await this.mc.plugins(id)).map((p) => [String(p.name).toLowerCase().replace(/[^a-z0-9]/g, ''), p]));
    return { keys, names };
  }

  /* ---------- Suche ---------- */
  async search(id, { q = '', source = 'all', category = '', sort = 'downloads', page = 0 } = {}) {
    const { loaders, version, kind, platform } = this.server(id);
    const cat = CATEGORIES.find((c) => c.id === category);
    const so = SORTS[sort] || SORTS.downloads;
    const offset = Math.max(0, Number(page) || 0) * LIMIT;
    const jobs = [];
    if (source !== 'hangar' && (!cat || cat.modrinth)) jobs.push(this.searchModrinth({ q, cat, sort: q && sort === 'relevance' ? 'relevance' : so.modrinth, offset, loaders, version, kind }));
    if (source !== 'modrinth' && (!cat || cat.hangar) && platform) jobs.push(this.searchHangar({ q, cat, sort: so.hangar, offset, version, platform }));
    const settled = await Promise.allSettled(jobs);
    const errors = settled.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    const lists = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!lists.length && errors.length) throw new Error('Marktplatz nicht erreichbar: ' + errors[0]);
    // Beide Listen abwechselnd mischen; Doppelte (gleicher Name auf beiden Seiten) nur einmal – bevorzugt mit Datei-Download
    const merged = [];
    const seen = new Map();
    const max = Math.max(0, ...lists.map((l) => l.hits.length));
    for (let i = 0; i < max; i++) for (const l of lists) {
      const h = l.hits[i];
      if (!h) continue;
      const key = h.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) { seen.get(key).alsoOn = { source: h.source, id: h.id }; continue; }
      seen.set(key, h);
      merged.push(h);
    }
    if (sort === 'downloads' && !q) merged.sort((a, b) => b.downloads - a.downloads);
    const idx = await this.installedIndex(id);
    for (const h of merged) {
      const inst = idx.keys.get(`${h.source}:${h.id}`) || (h.alsoOn && idx.keys.get(`${h.alsoOn.source}:${h.alsoOn.id}`)) || idx.names.get(h.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (inst) h.installed = { file: inst.file, version: inst.version };
    }
    return { hits: merged, more: lists.some((l) => l.total > offset + LIMIT), total: lists.reduce((n, l) => n + l.total, 0), errors, categories: CATEGORIES.filter((c) => !c.mods || kind === 'mod').map(({ id: cid, label, modrinth, hangar }) => ({ id: cid, label, sources: [modrinth && 'modrinth', hangar && 'hangar'].filter(Boolean) })), version, hangar: !!platform, kind };
  }

  async searchModrinth({ q, cat, sort, offset, loaders, version, kind = 'plugin' }) {
    const facets = [[`project_type:${kind}`], loaders.map((l) => `categories:${l}`)];
    // Mods: nur, was auf dem Server laufen kann (keine reinen Client-Mods wie Shader oder Minimaps)
    if (kind === 'mod') facets.push(['server_side:required', 'server_side:optional']);
    if (version) facets.push([`versions:${version}`]);
    if (cat) facets.push([`categories:${cat.modrinth}`]);
    const url = `${MR}/search?limit=${LIMIT}&offset=${offset}&index=${sort}&query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
    const j = await cached('mr:' + url, 5 * 60e3, () => fetchJson(url), { persist: false });
    return {
      total: j.total_hits,
      hits: j.hits.map((h) => ({ source: 'modrinth', id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url || null, downloads: h.downloads, follows: h.follows, author: h.author, categories: (h.display_categories || h.categories || []).filter((c) => !['paper', 'spigot', 'bukkit', 'purpur', 'folia', 'velocity', 'bungeecord', 'waterfall', 'sponge', 'fabric', 'forge', 'neoforge', 'quilt'].includes(c)), updated: h.date_modified, url: `https://modrinth.com/${kind}/${h.slug}` })),
    };
  }

  async searchHangar({ q, cat, sort, offset, version, platform = 'PAPER' }) {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), sort, platform });
    if (q) params.set('q', q);
    if (cat) params.set('category', cat.hangar);
    if (version) params.set('version', version);
    const url = `${HG}/projects?${params}`;
    const j = await cached('hg:' + url, 5 * 60e3, () => fetchJson(url), { persist: false });
    return {
      total: j.pagination.count,
      hits: j.result.map((h) => ({ source: 'hangar', id: h.namespace.slug, slug: h.namespace.slug, title: h.name, description: h.description, icon: h.avatarUrl && !/default\/default/.test(h.avatarUrl) ? h.avatarUrl : null, downloads: h.stats.downloads, follows: h.stats.stars, author: h.namespace.owner, categories: [h.category].filter(Boolean).map((c) => c.replace(/_/g, ' ')), updated: h.lastUpdated, url: `https://hangar.papermc.io/${h.namespace.owner}/${h.namespace.slug}` })),
    };
  }

  /* ---------- Details + Versionen ---------- */
  async detail(id, source, pid) {
    const { loaders, version, platform: PF = 'PAPER' } = this.server(id);
    const fits = (gv) => !version || gv.includes(version);
    if (source === 'modrinth') {
      const [p, versions] = await Promise.all([
        cached(`mrp:${pid}`, 10 * 60e3, () => fetchJson(`${MR}/project/${encodeURIComponent(pid)}`)),
        cached(`mrv:${pid}`, 10 * 60e3, () => fetchJson(`${MR}/project/${encodeURIComponent(pid)}/version`)),
      ]);
      const owner = await cached(`mrm:${pid}`, 60 * 60e3, () => fetchJson(`${MR}/project/${encodeURIComponent(pid)}/members`).catch(() => []));
      const vs = versions.filter((v) => v.loaders.some((l) => loaders.includes(l))).slice(0, 40).map((v) => ({
        id: v.id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published, downloads: v.downloads,
        gameVersions: v.game_versions, fits: fits(v.game_versions), changelog: (v.changelog || '').slice(0, 3000),
      }));
      return {
        source, id: p.id, slug: p.slug, title: p.title, description: p.description, body: p.body || '', icon: p.icon_url, downloads: p.downloads, follows: p.followers,
        author: (owner.find((m) => m.role === 'Owner') || owner[0] || {}).user?.username || null, license: p.license && p.license.id, updated: p.updated, published: p.published,
        categories: p.categories, gallery: (p.gallery || []).slice(0, 8).map((g) => ({ url: g.url, title: g.title })),
        links: [['Seite auf Modrinth', `https://modrinth.com/${p.project_type || 'plugin'}/${p.slug}`], ['Quellcode', p.source_url], ['Fehler melden', p.issues_url], ['Wiki', p.wiki_url], ['Discord', p.discord_url]].filter(([, u]) => u).map(([label, url]) => ({ label, url })),
        versions: vs, recommended: (vs.find((v) => v.fits && v.type === 'release') || vs.find((v) => v.fits) || {}).id || null, serverVersion: version, compat: compatSummary(vs, version),
      };
    }
    if (source === 'hangar') {
      const [p, vj] = await Promise.all([
        cached(`hgp:${pid}`, 10 * 60e3, () => fetchJson(`${HG}/projects/${encodeURIComponent(pid)}`)),
        cached(`hgv:${pid}`, 10 * 60e3, () => fetchJson(`${HG}/projects/${encodeURIComponent(pid)}/versions?limit=25&platform=${PF}`)),
      ]);
      const vs = vj.result.filter((v) => v.downloads && v.downloads[PF]).map((v) => {
        const gv = (v.platformDependencies && v.platformDependencies[PF]) || [];
        const dl = v.downloads[PF];
        return {
          id: v.name, name: v.name, number: v.name, type: /snapshot|beta|alpha|dev/i.test(v.channel && v.channel.name) ? 'beta' : 'release', channel: v.channel && v.channel.name, date: v.createdAt, downloads: v.stats && v.stats.totalDownloads,
          gameVersions: (v.platformDependenciesFormatted && v.platformDependenciesFormatted[PF]) || gv, fits: !version || gv.includes(version) || gv.includes(mmOf(version)), changelog: (v.description || '').slice(0, 3000), external: !dl.downloadUrl && !!dl.externalUrl,
        };
      });
      return {
        source, id: p.namespace.slug, slug: p.namespace.slug, title: p.name, description: p.description, body: p.mainPageContent || '', icon: p.avatarUrl, downloads: p.stats.downloads, follows: p.stats.stars,
        author: p.namespace.owner, license: p.settings && p.settings.license && (p.settings.license.name || p.settings.license.type), updated: p.lastUpdated, published: p.createdAt,
        categories: [p.category], gallery: [],
        links: [{ label: 'Seite auf Hangar', url: `https://hangar.papermc.io/${p.namespace.owner}/${p.namespace.slug}` }, ...((p.settings && p.settings.links) || []).flatMap((g) => g.links || []).filter((l) => /^https:\/\//.test(l.url)).slice(0, 6).map((l) => ({ label: l.name, url: l.url }))],
        versions: vs, recommended: (vs.find((v) => v.fits && v.type === 'release') || vs.find((v) => v.fits) || {}).id || null, serverVersion: version, compat: compatSummary(vs, version),
      };
    }
    throw new Error('Unbekannte Quelle');
  }

  /* ---------- Installieren ---------- */
  install(id, { source, id: pid, version: wanted }) {
    const s = this.mc.get(id);
    return runJob(`${this.mc.content(s) === 'mods' ? 'Mod' : 'Plugin'} installieren auf „${s.name}“`, async (job) => {
      const d = await this.detail(id, source, pid);
      const v = d.versions.find((x) => x.id === wanted) || d.versions.find((x) => x.id === d.recommended);
      if (!v) throw new Error(`Keine passende Version von ${d.title} für ${(providers[s.type] && providers[s.type].label) || s.type} ${s.version} gefunden.`);
      if (!v.fits) job.log(`Achtung: ${v.number} ist nicht ausdrücklich für ${s.version} freigegeben.`);
      const dir = this.mc.addonDir(id);
      fs.mkdirSync(dir, { recursive: true });
      let url, filename, hash = {};
      if (source === 'modrinth') {
        const full = await fetchJson(`${MR}/version/${encodeURIComponent(v.id)}`);
        const f = full.files.find((x) => x.primary) || full.files[0];
        url = f.url; filename = f.filename; hash = { sha1: f.hashes && f.hashes.sha1 };
      } else {
        const full = await fetchJson(`${HG}/projects/${encodeURIComponent(d.id)}/versions/${encodeURIComponent(v.id)}`);
        const dl = full.downloads[this.server(id).platform || 'PAPER'];
        url = dl.downloadUrl || dl.externalUrl;
        filename = (dl.fileInfo && dl.fileInfo.name) || `${d.slug}-${v.number}.jar`;
        if (dl.fileInfo && dl.fileInfo.sha256Hash) hash = { sha256: dl.fileInfo.sha256Hash };
        if (!dl.downloadUrl) job.log(`Download über die Seite des Herstellers: ${url}`);
      }
      filename = path.basename(filename).replace(/[^\w.+-]/g, '_');
      if (!/\.jar$/i.test(filename)) filename += '.jar';
      // Ältere Version desselben Plugins ersetzen
      const src = this.sources(id);
      const old = Object.entries(src).find(([, x]) => x.source === source && x.id === d.id);
      const target = path.join(dir, filename);
      job.log(`${d.title} ${v.number} (${source === 'modrinth' ? 'Modrinth' : 'Hangar'})`);
      await downloadFile(url, target + '.neu', { ...hash, onProgress: (r, t) => job.progress(t ? (r / t) * 100 : 50, `${filename} herunterladen`) });
      const head = Buffer.alloc(2); const fd = fs.openSync(target + '.neu', 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
      if (head.toString() !== 'PK') { fs.rmSync(target + '.neu', { force: true }); throw new Error('Der Download ist keine JAR-Datei (evtl. muss sie auf der Herstellerseite heruntergeladen werden).'); }
      // Update eines installierten Plugins bei laufendem Server: alte JAR ist gesperrt → sicherer Weg (live tauschen oder einreihen)
      const oldLive = old && fs.existsSync(path.join(dir, old[0])) ? old[0] : fs.existsSync(target) ? filename : null;
      if (oldLive && this.mc.proc(id).isRunning() && this.mc.placeAddon) {
        const r = await this.mc.placeAddon(id, target + '.neu', { finalName: filename, replace: oldLive });
        if (r.mode === 'queued') { src[oldLive] = { ...src[oldLive], pending: v.number }; if (oldLive !== filename) src[filename] = { source, id: d.id, title: d.title, version: v.number, versionId: v.id, installedAt: Date.now() }; }
        else { if (oldLive !== filename) delete src[oldLive]; src[filename] = { source, id: d.id, title: d.title, version: v.number, versionId: v.id, installedAt: Date.now() }; }
        this.saveSources(id, src);
        job.log(r.mode === 'queued' ? 'Wartet – wird beim nächsten Stopp oder Neustart eingespielt.' : 'Live ausgetauscht – ohne Neustart.');
        return { file: filename, title: d.title, version: v.number, mode: r.mode, needsRestart: false };
      }
      if (old && old[0] !== filename) { fs.rmSync(path.join(dir, old[0]), { force: true }); fs.rmSync(path.join(dir, old[0] + '.disabled'), { force: true }); delete src[old[0]]; }
      fs.rmSync(target + '.disabled', { force: true }); // deaktivierte Fassung gleichen Namens nicht daneben liegen lassen
      fs.renameSync(target + '.neu', target);
      src[filename] = { source, id: d.id, title: d.title, version: v.number, versionId: v.id, installedAt: Date.now() };
      this.saveSources(id, src);
      return { file: filename, title: d.title, version: v.number, needsRestart: this.mc.proc(id).isRunning() };
    }, { key: `mc-market-${id}-${pid}` });
  }

  /** Updates für über Hangar installierte Plugins (Modrinth-Plugins erkennt der Hash-Abgleich). */
  async hangarUpdates(id) {
    const src = this.sources(id);
    const out = [];
    for (const [file, x] of Object.entries(src)) {
      if (x.source !== 'hangar') continue;
      try {
        const d = await this.detail(id, 'hangar', x.id);
        const best = d.versions.find((v) => v.id === d.recommended);
        if (best && best.number !== x.version) out.push({ file, title: x.title, current: x.version, latest: best.number, source: 'hangar', id: x.id });
      } catch { /* Quelle nicht erreichbar */ }
    }
    return out;
  }

  routes(r) {
    r.get('/mc/servers/:id/market', async (req, res) => res.json(await this.search(req.params.id, req.query)));
    r.get('/mc/servers/:id/market/:source/:pid', async (req, res) => {
      const d = await this.detail(req.params.id, req.params.source, req.params.pid);
      const idx = await this.installedIndex(req.params.id);
      const inst = idx.keys.get(`${d.source}:${d.id}`) || idx.names.get(d.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
      res.json({ ...d, installed: inst ? { file: inst.file, version: inst.version } : null });
    });
    r.post('/mc/servers/:id/market/install', (req, res) => res.json({ job: this.install(req.params.id, req.body || {}).id }));
    r.get('/mc/servers/:id/market-updates', async (req, res) => res.json(await this.hangarUpdates(req.params.id)));
  }
}

module.exports = { PluginMarket, CATEGORIES, compatSummary };
