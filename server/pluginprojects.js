'use strict';
/*
 * Eigene Plugin-Projekte finden: Maven-/Gradle-Projekte mit plugin.yml (bzw. paper-plugin.yml) auf diesem PC.
 * Installierte Plugins mit gleichem Namen bekommen dadurch automatisch die Quelle „Eigenes Projekt“ – Hostwerk sieht
 * neue Builds (target/, build/libs/) und spielt sie per Klick ein, ohne dass jemand etwas verknüpft.
 *
 * Gesucht wird nur im Hintergrund (nie während einer Anfrage) und höchstens alle 6 Stunden:
 *   - Ordner der Plugin-Live-Update-Überwachung aller Server
 *   - übliche Entwicklungsordner: Dokumente, source/repos, IdeaProjects, git, Projects, dev, code (zwei Ebenen tief)
 * Ergebnis: <cache>/plugin-projects.json  { at, projects: { "<name klein>": { name, dir } } }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { backgroundOnline } = require('./hw').core('testmode');

const TTL = 6 * 3600000;
const SKIP = new Set(['node_modules', '.git', '.gradle', '.idea', 'target', 'build', 'out', 'dist', 'bin', 'obj', '.vscode', 'AppData']);
const BUILD = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
const META = ['src/main/resources/plugin.yml', 'src/main/resources/paper-plugin.yml', 'src/main/resources/bungee.yml', 'src/main/resources/velocity-plugin.json'];

class PluginProjects {
  constructor(ctx, mc) {
    this.ctx = ctx; this.mc = mc;
    this.file = path.join(ctx.paths.cache, 'plugin-projects.json');
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = { at: 0, projects: {} }; }
    this.running = null;
    // Kurz nach dem Start einmal im Hintergrund suchen, damit die erste Plugin-Liste schon Bescheid weiß
    if (backgroundOnline('mc-plugins')) { const t = setTimeout(() => this.refresh(), 8000); if (t.unref) t.unref(); }
  }

  roots() {
    const home = os.homedir();
    const out = new Set();
    for (const s of this.mc.list()) for (const d of ((s.liveUpdate || {}).watch || [])) if (d) { out.add(path.resolve(d)); out.add(path.dirname(path.resolve(d))); }
    for (const r of ['Documents', 'Dokumente', 'source/repos', 'IdeaProjects', 'git', 'Projects', 'Projekte', 'dev', 'code', 'workspace', 'Desktop']) out.add(path.join(home, r));
    return [...out].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  }

  /** Name aus plugin.yml (ohne YAML-Bibliothek; ${…}-Platzhalter von Maven → Ordnername). */
  static nameOf(dir) {
    for (const m of META) {
      const f = path.join(dir, m);
      if (!fs.existsSync(f)) continue;
      try {
        const txt = fs.readFileSync(f, 'utf8');
        const name = m.endsWith('.json') ? (JSON.parse(txt).name || JSON.parse(txt).id) : (txt.match(/^name\s*:\s*["']?([^"'\r\n#]+)/m) || [])[1];
        if (name && !/\$\{/.test(name)) return name.trim();
      } catch { /* weiter */ }
    }
    return null;
  }

  /** Ordner durchsuchen – asynchron, damit Hostwerk währenddessen weiter antwortet. */
  async scan() {
    const projects = {};
    const seen = new Set();
    const visit = async (dir, depth) => {
      if (seen.has(dir)) return; seen.add(dir);
      let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      const names = ents.map((e) => e.name);
      if (BUILD.some((x) => names.includes(x))) {
        const name = PluginProjects.nameOf(dir);
        if (name) { const key = name.toLowerCase(); const prev = projects[key]; if (!prev || newestBuild(dir) > newestBuild(prev.dir)) projects[key] = { name, dir }; }
      }
      if (depth <= 0) return;
      for (const e of ents) {
        if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
        await visit(path.join(dir, e.name), depth - 1);
      }
    };
    for (const r of this.roots()) await visit(r, 2);
    this.data = { at: Date.now(), projects };
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1)); } catch { /* egal */ }
    return this.data;
  }

  /** Im Hintergrund auffrischen (nicht blockierend). */
  refresh(force = false) {
    if (this.running) return this.running;
    if (!force && Date.now() - (this.data.at || 0) < TTL) return Promise.resolve(this.data);
    this.running = this.scan().catch(() => this.data).finally(() => { this.running = null; });
    return this.running;
  }

  /** Projekt zu einem Plugin-Namen (sofort, aus dem gemerkten Stand). */
  find(name) {
    if (!name) return null;
    this.refresh();
    const p = this.data.projects[String(name).toLowerCase()];
    return p && fs.existsSync(p.dir) ? p : null;
  }
}

/** Neueste gebaute JAR eines Projekts (oder null). */
function buildJar(dir) {
  const cands = [];
  for (const sub of ['build/libs', 'target']) {
    const d = path.join(dir, sub);
    let names; try { names = fs.readdirSync(d); } catch { continue; }
    for (const f of names) {
      if (!/\.jar$/i.test(f) || /-(sources|javadoc|tests?|api)\.jar$/i.test(f) || /^original-/i.test(f)) continue;
      try { const st = fs.statSync(path.join(d, f)); cands.push({ file: path.join(d, f), t: st.mtimeMs, size: st.size }); } catch { /* egal */ }
    }
  }
  cands.sort((a, b) => b.t - a.t);
  return cands[0] || null;
}
function newestBuild(dir) { const j = buildJar(dir); return j ? j.t : 0; }

module.exports = { PluginProjects, buildJar };
