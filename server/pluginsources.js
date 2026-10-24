'use strict';
/*
 * Weitere Plugin-Quellen: Plugins, die nicht von Modrinth/Hangar stammen, mit ihrer Quelle verknüpfen – GitHub-Releases,
 * SpigotMC (über spiget.org), Jenkins-Build-Server oder eine feste Download-Adresse. Danach prüft Hostwerk auch für sie,
 * ob eine neue Version vorliegt, und spielt sie auf Wunsch ein (zusammen mit den übrigen Plugin-Updates).
 * Die Verknüpfung liegt in plugins/.hostwerk-quellen.json (wie beim Marktplatz). Aus der plugin.yml (website) schlägt
 * Hostwerk passende GitHub-Quellen selbst vor.
 */
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile, cached } = require('./hw').core('download');
const { runJob } = require('./hw').core('jobs');

const UA = { 'User-Agent': 'Hostwerk (github.com/Passimoritz/hostwerk)' };
const normVer = (v) => String(v || '').replace(/^v(?=\d)/i, '').replace(/^(release|build)[-_ ]?/i, '').trim();

/** Adresse → Quelle. */
function detect(url) {
  const u = String(url || '').trim();
  let m = u.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (m) return { source: 'github', id: `${m[1]}/${m[2].replace(/\.git$/, '')}`, label: `GitHub ${m[1]}/${m[2]}` };
  m = u.match(/spigotmc\.org\/resources\/(?:[\w-]+\.)?(\d+)/i);
  if (m) return { source: 'spigot', id: m[1], label: `SpigotMC #${m[1]}` };
  m = u.match(/^(https?:\/\/[^\s]+?\/job\/[^/\s]+)\/?/i);
  if (m) return { source: 'jenkins', id: m[1].replace(/\/$/, ''), label: 'Jenkins' };
  if (/^https?:\/\/\S+\.jar(\?\S*)?$/i.test(u)) return { source: 'url', id: u, label: 'Direkter Download' };
  if (/^\d+$/.test(u)) return { source: 'spigot', id: u, label: `SpigotMC #${u}` };
  return null;
}

const LABEL = { modrinth: 'Modrinth', hangar: 'Hangar', github: 'GitHub', spigot: 'SpigotMC', jenkins: 'Jenkins', url: 'Link', project: 'Eigenes Projekt', hostwerk: 'Von Hostwerk' };
const crypto = require('crypto');
const { buildJar } = require('./pluginprojects');
const BRIDGE_JAR = path.join(__dirname, 'bridge', 'HostwerkBridge.jar');
const sha1 = (f) => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
/** Zwei JARs gleich? Größe zuerst (billig), dann Inhalt. */
const sameJar = (a, b) => { try { if (fs.statSync(a).size !== fs.statSync(b).size) return false; } catch { return false; } return sha1(a) === sha1(b); };
/** Seite der Quelle (für den Link-Knopf). */
function pageUrl(x) {
  if (!x) return null;
  if (x.page) return x.page;
  if (x.source === 'github') return `https://github.com/${x.id}`;
  if (x.source === 'spigot') return `https://www.spigotmc.org/resources/${x.id}/`;
  if (x.source === 'jenkins') return x.id;
  if (x.source === 'url') return x.url || x.id;
  if (x.source === 'modrinth') return `https://modrinth.com/project/${x.slug || x.id}`;
  if (x.source === 'hangar') return `https://hangar.papermc.io/${x.id}`;
  if (x.source === 'project' || x.source === 'hostwerk') return null;
  return null;
}

class PluginSources {
  constructor(mc) { this.mc = mc; this.state = new Map(); /* serverId -> { file -> check } */ this.lastSuggestions = new Map(); }
  market() { return this.mc.market; }
  isExternal(x) { return x && ['github', 'spigot', 'jenkins', 'url', 'project', 'hostwerk'].includes(x.source); }
  /** Lokale Quellen brauchen kein Netz (eigenes Projekt, mitgelieferte Hostwerk-Bridge). */
  isLocal(x) { return x && ['project', 'hostwerk'].includes(x.source); }

  /**
   * Quellen ohne Zutun verknüpfen (läuft bei jeder Plugin-Liste, ohne Netz):
   *   - HostwerkBridge → „Von Hostwerk“ (aktualisiert sich mit Hostwerk)
   *   - Plugin mit eigenem Projekt auf diesem PC → „Eigenes Projekt“ (neue Builds werden erkannt)
   *   - website in plugin.yml zeigt auf GitHub/SpigotMC/… → diese Quelle
   * Bewusst entkoppelte Quellen (pausiert) bleiben, wie sie sind.
   */
  autoLink(id, plugins) {
    const src = this.market().sources(id);
    let dirty = false;
    const suggestions = [];
    for (const p of plugins) {
      const base = p.file.replace(/\.disabled$/i, '');
      if (!/^[\w.+ -]+\.jar$/i.test(base)) continue;
      const x = src[base];
      if (x && x.source !== 'none') continue; // Marktplatz, verknüpft oder pausiert
      const unlinked = x && x.source === 'none';
      if (/^hostwerkbridge$/i.test(p.name || '')) { src[base] = { source: 'hostwerk', id: 'bridge', title: 'HostwerkBridge', version: p.version || null, linkedAt: Date.now(), auto: true }; dirty = true; continue; }
      const proj = this.mc.projects && this.mc.projects.find(p.name);
      if (proj) { src[base] = { source: 'project', id: proj.dir, title: p.name, version: p.version || null, linkedAt: Date.now(), auto: true }; dirty = true; continue; }
      if (unlinked) continue; // GitHub-Vorschlag wurde abgelehnt – nicht erneut
      const d = p.website ? detect(p.website) : null;
      if (!d) continue;
      try { this.link(id, p.file, p.website, { auto: true }); } catch { suggestions.push({ file: p.file, name: p.name, url: p.website, ...d }); }
    }
    if (dirty) this.market().saveSources(id, src);
    return suggestions;
  }
  /**
   * Taucht ein Plugin auf, das weder eine Quelle hat noch zu einem bekannten Projekt gehört (z. B. gerade erst gebaut), wird die
   * Projektliste sofort neu gesucht – sonst gälte es bis zu 6 Stunden lang als „Von Hand“. Je Name nur einmal, höchstens 3 s Warten.
   */
  async freshenProjects(id, plugins) {
    const pr = this.mc.projects;
    if (!pr) return;
    if (!this.checkedNames) this.checkedNames = new Set();
    const src = this.market().sources(id);
    const unknown = plugins.filter((p) => {
      const base = p.file.replace(/\.disabled$/i, '');
      const name = String(p.name || '').toLowerCase();
      return name && !src[base] && !/^hostwerkbridge$/.test(name) && !this.checkedNames.has(name) && !pr.find(p.name);
    });
    if (!unknown.length) return;
    unknown.forEach((p) => this.checkedNames.add(String(p.name).toLowerCase()));
    await Promise.race([pr.refresh(true), new Promise((r) => { const t = setTimeout(r, 3000); if (t.unref) t.unref(); })]);
  }
  /** Verknüpft und nicht pausiert (Entkoppeln pausiert nur – die Quelle bleibt gespeichert). */
  isActive(x) { return this.isExternal(x) && !x.paused; }

  /** Verknüpfte Plugins + Vorschläge (website in plugin.yml zeigt auf GitHub). */
  async list(id) {
    const plugins = await this.mc.plugins(id);
    try { this.lastSuggestions.set(id, this.autoLink(id, plugins)); } catch { /* egal */ } // billig, ohne Netz – auch wenn die Liste anders entstand
    const src = this.market().sources(id);
    const linked = []; const suggestions = [];
    for (const p of plugins) {
      const base = p.file.replace(/\.disabled$/i, '');
      const x = src[base];
      if (x && this.isExternal(x)) { linked.push({ file: p.file, name: p.name, size: p.size, source: x.source, label: LABEL[x.source], id: x.id, dir: x.source === 'project' ? x.id : null, page: pageUrl(x), auto: !!x.auto, paused: !!x.paused, version: x.version || p.version || null, check: x.paused ? null : (this.state.get(id) || {})[base] || null }); continue; }
    }
    for (const sg of this.lastSuggestions.get(id) || []) if (!linked.some((l) => l.file === sg.file)) suggestions.push(sg);
    return { linked, suggestions };
  }

  link(id, file, url, { auto = false } = {}) {
    const d = detect(url);
    if (!d) throw new Error('Diese Adresse erkenne ich nicht. Unterstützt: GitHub-Repository, SpigotMC-Ressource, Jenkins-Job (…/job/NAME) oder ein direkter Link auf eine .jar.');
    const base = String(file || '').replace(/\.disabled$/i, '');
    if (!/^[\w.+ -]+\.jar$/i.test(base)) throw new Error('Ungültiger Dateiname');
    const src = this.market().sources(id);
    const prev = src[base] || {};
    const { unlinkedAt, paused, ...keep } = prev; // eslint-disable-line no-unused-vars
    src[base] = { ...keep, source: d.source, id: d.id, title: prev.title || base.replace(/\.jar$/i, ''), version: prev.version || null, url: String(url).trim(), linkedAt: Date.now(), auto };
    this.market().saveSources(id, src);
    return src[base];
  }
  /**
   * Entkoppeln = vorübergehend pausieren: Die Quelle bleibt gespeichert (und in „Weitere Quellen“ sichtbar),
   * Hostwerk prüft aber keine Updates mehr, bis sie wieder verknüpft wird. Ohne gespeicherte Quelle wird ein
   * Merker gesetzt, damit die Quelle aus der plugin.yml nicht gleich wieder automatisch verknüpft wird.
   */
  unlink(id, file) {
    const base = String(file || '').replace(/\.disabled$/i, '');
    const src = this.market().sources(id);
    if (this.isExternal(src[base])) src[base] = { ...src[base], paused: true, unlinkedAt: Date.now() };
    else if (!src[base]) src[base] = { source: 'none', unlinkedAt: Date.now() };
    this.market().saveSources(id, src);
    const st = this.state.get(id); if (st) delete st[base];
  }
  /** Pausierte Quelle wieder aktivieren. */
  resume(id, file) {
    const base = String(file || '').replace(/\.disabled$/i, '');
    const src = this.market().sources(id);
    if (!this.isExternal(src[base])) throw new Error('Für dieses Plugin ist keine Quelle gespeichert.');
    const { paused, unlinkedAt, ...keep } = src[base]; // eslint-disable-line no-unused-vars
    src[base] = { ...keep, linkedAt: Date.now() };
    this.market().saveSources(id, src);
    return src[base];
  }

  /** Herkunft je Plugin-Datei: { source, label, page } – Modrinth/Hangar/GitHub/… oder „von Hand“. */
  origins(id) {
    const src = this.market().sources(id);
    const out = {};
    for (const [base, x] of Object.entries(src)) {
      if (!x || x.source === 'none') out[base] = { source: 'manual', label: 'Von Hand (entkoppelt)', page: null };
      else out[base] = { source: x.source, label: (LABEL[x.source] || x.source) + (x.paused ? ' (entkoppelt)' : ''), page: pageUrl(x), auto: !!x.auto, paused: !!x.paused };
    }
    return out;
  }

  /** Neueste Version einer Quelle: { version, url, filename, hash?, external? } */
  async latest(x, hint = '') {
    if (x.source === 'project') {
      const j = buildJar(x.id);
      if (!j) throw new Error('Noch nicht gebaut (keine JAR in target/ oder build/libs/)');
      const meta = await this.mc.readMeta(j.file).catch(() => null);
      return { version: (meta && meta.version) || null, localFile: j.file, filename: path.basename(j.file), date: new Date(j.t).toISOString(), external: false, built: j.t };
    }
    if (x.source === 'hostwerk') {
      const meta = await this.mc.readMeta(BRIDGE_JAR).catch(() => null);
      return { version: (meta && meta.version) || null, localFile: BRIDGE_JAR, filename: 'HostwerkBridge.jar', external: false };
    }
    const pick = (assets) => {
      const jars = assets.filter((a) => /\.jar$/i.test(a.name) && !/sources|javadoc|-api\b/i.test(a.name));
      const base = hint.replace(/[-_ ]?v?\d[\d.]*.*$/, '').toLowerCase();
      return jars.find((a) => base && a.name.toLowerCase().startsWith(base)) || jars[0] || null;
    };
    if (x.source === 'github') {
      const rel = await cached(`gh-rel:${x.id}`, 30 * 60e3, () => fetchJson(`https://api.github.com/repos/${x.id}/releases/latest`).catch(async (e) => { if (/404/.test(e.message)) { const all = await fetchJson(`https://api.github.com/repos/${x.id}/releases?per_page=5`); if (all[0]) return all[0]; } throw e; }));
      const a = pick((rel.assets || []).map((z) => ({ name: z.name, url: z.browser_download_url, size: z.size })));
      return { version: normVer(rel.tag_name || rel.name), url: a && a.url, filename: a && a.name, external: !a, page: rel.html_url, date: rel.published_at };
    }
    if (x.source === 'spigot') {
      const v = await cached(`spiget:${x.id}`, 30 * 60e3, () => fetchJson(`https://api.spiget.org/v2/resources/${x.id}/versions/latest`));
      const r = await cached(`spiget-r:${x.id}`, 60 * 60e3, () => fetchJson(`https://api.spiget.org/v2/resources/${x.id}`));
      const external = !!(r.external || (r.file && r.file.type !== '.jar'));
      return { version: normVer(v.name), url: external ? null : `https://api.spiget.org/v2/resources/${x.id}/download`, filename: `${(r.name || 'plugin').replace(/[^\w.-]/g, '_')}.jar`, external, page: `https://www.spigotmc.org/resources/${x.id}`, date: v.releaseDate ? new Date(v.releaseDate * 1000).toISOString() : null, title: r.name };
    }
    if (x.source === 'jenkins') {
      const j = await cached(`jenkins:${x.id}`, 15 * 60e3, () => fetchJson(`${x.id}/lastSuccessfulBuild/api/json?tree=number,timestamp,url,artifacts[fileName,relativePath]`));
      const a = pick((j.artifacts || []).map((z) => ({ name: z.fileName, url: `${x.id}/lastSuccessfulBuild/artifact/${z.relativePath}` })));
      return { version: `Build ${j.number}`, url: a && a.url, filename: a && a.name, external: !a, page: j.url, date: j.timestamp ? new Date(j.timestamp).toISOString() : null };
    }
    // Direkter Link: Änderung an ETag/Last-Modified erkennen
    const r = await fetch(x.id, { method: 'HEAD', headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Adresse antwortet mit ${r.status}`);
    const tag = r.headers.get('etag') || r.headers.get('last-modified') || String(r.headers.get('content-length') || '');
    return { version: tag.replace(/"/g, '').slice(0, 40), url: x.id, filename: path.basename(new URL(x.id).pathname), external: false };
  }

  /** Alle verknüpften Plugins eines Servers prüfen → [{ file, name, current, latest, update, source }] */
  async check(id) {
    const src = this.market().sources(id);
    const out = [];
    const st = this.state.get(id) || {};
    for (const [file, x] of Object.entries(src)) {
      if (!this.isActive(x)) continue;
      try {
        const l = await this.latest(x, file);
        let update = !!l.version && normVer(l.version) !== normVer(x.version || '');
        if (this.isLocal(x)) {
          const dir = this.mc.addonDir(id);
          const inst = [path.join(dir, file), path.join(dir, file + '.disabled')].find((f) => fs.existsSync(f));
          // Neuer Build = andere Datei als die installierte (auch bei gleicher Versionsnummer); beim Projekt nur, wenn neuer
          update = !!inst && !sameJar(inst, l.localFile) && (x.source === 'hostwerk' || (l.built || 0) > fs.statSync(inst).mtimeMs);
          if (!l.version) l.version = update ? 'neuer Build' : x.version;
        }
        const r = { file, name: x.title || l.title || file, current: x.version || null, latest: l.version, update, source: x.source, external: !!l.external, page: l.page || null, at: Date.now() };
        st[file] = r; out.push(r);
      } catch (e) { st[file] = { file, source: x.source, error: e.message, at: Date.now() }; out.push({ file, name: x.title || file, source: x.source, error: e.message }); }
    }
    this.state.set(id, st);
    return out;
  }
  async checkAll() { let n = 0; for (const s of this.mc.list()) { try { n += (await this.check(s.id)).filter((x) => x.update).length; } catch { /* egal */ } } return n; }

  /** Neue Version herunterladen und einspielen (Datei gleichen Namens ersetzen). */
  update(id, file) {
    const base = String(file).replace(/\.disabled$/i, '');
    return runJob(`Plugin aktualisieren: ${base}`, async (job) => {
      const src = this.market().sources(id);
      const x = src[base];
      if (!x || !this.isExternal(x)) throw new Error('Dieses Plugin ist mit keiner Quelle verknüpft.');
      if (x.paused) throw new Error('Die Quelle ist entkoppelt – erst wieder verknüpfen.');
      const l = await this.latest(x, base);
      if (!l.url && !l.localFile) throw new Error(`Diese Version muss auf der Seite des Herstellers geladen werden: ${l.page || x.url || x.id}`);
      const dir = this.mc.addonDir(id);
      const disabled = fs.existsSync(path.join(dir, base + '.disabled')) && !fs.existsSync(path.join(dir, base));
      job.log(`${x.title || base}: ${x.version || '?'} → ${l.version} (${x.source})`);
      const tmp = path.join(require('os').tmpdir(), `hw-plugin-${process.pid}-${Date.now()}.jar`);
      if (l.localFile) fs.copyFileSync(l.localFile, tmp);
      else await downloadFile(l.url, tmp, { onProgress: (r, t) => job.progress(t ? (r / t) * 100 : 50, `${base} herunterladen`) });
      // Gleicher Dateiname: Server aus → ersetzen, Server an → live austauschen oder einreihen (kein EPERM mehr)
      const r = await this.mc.placeAddon(id, tmp, { finalName: base, replace: base, disabled });
      job.log(r.mode === 'queued' ? 'Wartet – wird beim nächsten Stopp oder Neustart eingespielt.' : r.mode === 'hot' ? 'Live ausgetauscht – ohne Neustart.' : 'Ersetzt.');
      src[base] = { ...x, version: l.version, updatedAt: Date.now(), pending: r.mode === 'queued' ? l.version : undefined };
      this.market().saveSources(id, src);
      const st = this.state.get(id); if (st && st[base]) st[base] = { ...st[base], current: l.version, update: false };
      return { file: base, version: l.version, mode: r.mode, needsRestart: false };
    }, { key: `mc-src-update-${id}-${base}` });
  }

  routes(r) {
    r.get('/mc/servers/:id/plugins/sources', async (req, res) => res.json(await this.list(req.params.id)));
    r.put('/mc/servers/:id/plugins/source', (req, res) => { const b = req.body || {}; res.json(this.link(req.params.id, b.file, b.url)); });
    r.delete('/mc/servers/:id/plugins/source', (req, res) => { this.unlink(req.params.id, (req.body || {}).file || req.query.file); res.json({ ok: true }); });
    r.post('/mc/servers/:id/plugins/source/open', async (req, res) => {
      const base = String((req.body || {}).file || '').replace(/\.disabled$/i, '');
      const x = this.market().sources(req.params.id)[base];
      if (!x || x.source !== 'project' || !fs.existsSync(x.id)) return res.status(404).json({ error: 'Kein Projektordner gespeichert.' });
      const { exec } = require('./hw').core('util');
      if (!process.env.HW_TEST) exec(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [x.id]).catch(() => {});
      res.json({ ok: true, dir: x.id });
    });
    r.post('/mc/servers/:id/plugins/sources/rescan', async (req, res) => { await this.mc.projects.refresh(true); res.json(await this.list(req.params.id)); });
    r.post('/mc/servers/:id/plugins/source/resume', (req, res) => res.json(this.resume(req.params.id, (req.body || {}).file)));
    r.post('/mc/servers/:id/plugins/sources/check', async (req, res) => res.json(await this.check(req.params.id)));
    r.post('/mc/servers/:id/plugins/sources/update', (req, res) => res.json({ job: this.update(req.params.id, (req.body || {}).file).id }));
  }
}

module.exports = {PluginSources, detect, normVer, pageUrl, LABEL };
