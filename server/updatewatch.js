'use strict';
/*
 * Modpack- und Mod-/Plugin-Updates melden: prüft alle 6 Stunden (erstmals 3 Minuten nach dem Start) jeden
 * Minecraft-Server – Modpack (neuere Version mit gleichem Loader) und installierte Mods/Plugins (Modrinth/Hangar).
 * Neues meldet Hostwerk EINMAL je Version als Hinweis (in der App und als Windows-Benachrichtigung); der Stand
 * steht an jedem Server (info().updates) – die Oberfläche zeigt ein Abzeichen.
 * Abschaltbar: settings.minecraft.updateCheck = false.
 */
const { broadcast } = require('./hw').core('events');
const { providers } = require('./providers');
const { cmpVersion } = require('./hw').core('download');
const { backgroundOnline } = require('./hw').core('testmode');

class UpdateWatch {
  constructor(mc) {
    this.mc = mc;
    this.state = new Map(); // id -> { at, modpack: {number, mc, mcChange} | null, addons: n, names: [] }
    if (backgroundOnline('mc-updates')) {
      this.first = setTimeout(() => this.checkAll().catch(() => {}), 3 * 60000);
      this.timer = setInterval(() => this.checkAll().catch(() => {}), 6 * 3600000);
      // Wartender Server-Build: einspielen, sobald der Server gestoppt ist (ohne Netz, nur lokaler Zustand)
      this.pendingTimer = setInterval(() => this.applyPending().catch(() => {}), 120000);
      for (const t of [this.first, this.timer, this.pendingTimer]) if (t.unref) t.unref();
    }
  }
  /** Zeitgeber und Ordner-Beobachter beenden (Erweiterung wird entladen). */
  dispose() {
    clearTimeout(this.first); clearInterval(this.timer); clearInterval(this.pendingTimer);
    for (const w of (this.watchers || new Map()).values()) { try { w.close(); } catch { /* egal */ } }
    if (this.watchers) this.watchers.clear();
  }
  get cfg() { const s = this.mc.settings.get(); s.minecraft = s.minecraft || {}; if (s.minecraft.updateCheck === undefined) s.minecraft.updateCheck = true; s.minecraft.notified = s.minecraft.notified || {}; return s.minecraft; }

  /*
   * Der Hinweis „Updates verfügbar“ muss stimmen, sobald sich der Plugin-Ordner ändert – egal ob Hostwerk, der Marktplatz,
   * Live-Update oder der Nutzer von Hand eine JAR austauscht. Darum beobachtet jede Server-Zeile ihren Ordner (fs.watch)
   * und prüft 4 s nach der letzten Änderung neu (ohne erneute Benachrichtigung). Kein Abgleich an einzelnen Stellen nötig.
   */
  watch(id) {
    if (process.env.HW_TEST && !process.env.HW_TEST_WATCH) return;
    this.watchers = this.watchers || new Map();
    if (this.watchers.has(id)) return;
    let dir;
    try { dir = this.mc.addonDir(id); } catch { return; }
    if (!dir || !require('fs').existsSync(dir)) return;
    try {
      let t = null;
      const w = require('fs').watch(dir, (ev, f) => {
        if (f && !/\.jar(\.disabled)?$/i.test(f)) return;
        clearTimeout(t);
        t = setTimeout(() => { if (this.state.has(id)) this.check(id, { notify: false }).catch(() => {}); }, 4000);
        if (t.unref) t.unref();
      });
      w.on('error', () => { try { w.close(); } catch { /* egal */ } this.watchers.delete(id); });
      if (w.unref) w.unref();
      this.watchers.set(id, w);
    } catch { /* Ordner nicht beobachtbar – dann bleibt die 6-h-Prüfung */ }
  }
  get(id) { this.watch(id); return this.state.get(id) || null; }

  async check(id, { notify = true } = {}) {
    const s = this.mc.get(id);
    const out = { at: Date.now(), modpack: null, addons: 0, names: [], server: null, mcVersion: null };
    /*
     * Server-Software: neuer Build derselben Minecraft-Version (Paper, Purpur, Folia, Velocity) wird – wenn eingeschaltet –
     * automatisch eingespielt, sobald der Server gestoppt ist (alte JAR bleibt als server.jar.alt). Eine neue
     * Minecraft-Version wird nur ANGEBOTEN: Der Sprung ist nicht umkehrbar und läuft über „Sicher aktualisieren“ mit Probelauf.
     */
    const prov = providers[s.type];
    /*
     * Bedrock: Spieler kommen nur mit passender App-Version hinein – neue Versionen werden (wenn eingeschaltet) eingespielt,
     * sobald niemand spielt: Update mit Rücksprung (bedrock.update). Plugins gibt es dort nicht.
     */
    if (this.mc.isBedrock && this.mc.isBedrock(s)) {
      try {
        const st = await this.mc.bedrock.check(id);
        if (st.update) out.mcVersion = st.latest;
      } catch { /* offline */ }
      const p = this.mc.proc(id);
      if (out.mcVersion && s.autoServerUpdates !== false && !(p.extra.players || []).length) {
        try {
          await this.mc.bedrock.update(id).promise;
          broadcast({ type: 'toast', kind: 'info', text: `${s.name}: Bedrock ${out.mcVersion} eingespielt.` });
          out.mcVersion = null;
        } catch { /* zurückgenommen oder offline – nächster Lauf */ }
      }
      this.state.set(id, out);
      if (notify) this.announce(s, out);
      broadcast({ type: 'mc-updates', id, updates: out });
      return out;
    }
    if (prov && !s.modpack && s.version) {
      try {
        if (prov.latestBuild && s.build) { const b = await prov.latestBuild(s.version); if (b && Number(b) > Number(s.build)) out.server = { build: b, version: s.version }; }
        const v = await prov.versions();
        if (v && v.latest && cmpVersion(v.latest, s.version) > 0 && !/snapshot|pre|rc/i.test(v.latest)) out.mcVersion = v.latest;
      } catch { /* offline */ }
      if (out.server && s.autoServerUpdates !== false && !this.mc.proc(id).isRunning()) {
        try {
          await this.mc.changeVersion(id, { type: s.type, version: s.version }).promise;
          broadcast({ type: 'toast', kind: 'info', text: `${s.name}: ${prov.label} ${s.version} Build #${out.server.build} eingespielt.` });
          out.server = null;
        } catch { /* nächster Lauf */ }
      }
    }
    if (s.modpack) {
      try { const u = await this.mc.modpackUpdates(id); if (u.latest) out.modpack = { id: u.latest.id, number: u.latest.number, mc: u.latest.mc, mcChange: u.latest.mcChange }; } catch { /* offline */ }
    }
    try {
      {
        const list = await this.mc.pluginUpdates(id);
        const up = list.filter((x) => x.update);
        out.addons = up.length;
        out.names = up.slice(0, 8).map((x) => `${x.name || x.file} ${x.latest || ''}`.trim());
        /*
         * Automatisch einspielen (Einstellung „Plugins automatisch aktualisieren“, Standard an): nur Plugins mit bekannter
         * Quelle und nur, wenn die neue Version zur Minecraft-Version des Servers passt (Modrinth filtert danach). Läuft der
         * Server, landen sie in plugins/update/ und werden beim nächsten Neustart übernommen – kein Neustart erzwungen.
         */
        if (up.length && this.cfg.autoPluginUpdates !== false && this.mc.get(id).autoPluginUpdates !== false && this.mc.content(s) !== 'mods') {
          try {
            const r = await this.mc.updatePlugins(id).promise;
            if (r && r.updated) { out.autoUpdated = out.names.slice(); out.addons = 0; broadcast({ type: 'toast', kind: 'info', text: `${s.name}: ${r.updated} Plugin-Update${r.updated > 1 ? 's' : ''} eingespielt${r.needsRestart ? ' – wirkt nach dem nächsten Neustart' : ''}.` }); }
          } catch { /* nächster Lauf */ }
        }
      }
    } catch { /* keine Plugins/Mods oder offline */ }
    this.state.set(id, out);
    if (notify) this.announce(s, out);
    broadcast({ type: 'mc-updates', id, updates: out });
    return out;
  }

  /** Nur Neues melden: je Server merkt sich Hostwerk, welche Modpack-Version bzw. welcher Mod-Stand schon gemeldet wurde. */
  announce(s, u) {
    const n = this.cfg.notified;
    const key = `${u.modpack ? u.modpack.number : ''}|${u.names.join(',')}|${u.server ? u.server.build : ''}|${u.mcVersion || ''}`;
    if (!u.modpack && !u.addons && !u.server && !u.mcVersion) return;
    if (n[s.id] === key) return;
    n[s.id] = key;
    this.mc.settings.save();
    const W = this.mc.content(s) === 'mods' ? 'Mod' : 'Plugin';
    const parts = [];
    if (u.modpack) parts.push(`Modpack ${u.modpack.number}${u.modpack.mcChange ? ` (Minecraft ${u.modpack.mc})` : ''}`);
    if (u.addons) parts.push(`${u.addons} ${W}-Update${u.addons > 1 ? 's' : ''}`);
    if (u.server) parts.push(`Server-Build #${u.server.build}`);
    if (u.mcVersion) parts.push(`Minecraft ${u.mcVersion}`);
    broadcast({ type: 'toast', kind: 'warn', text: `${s.name}: ${parts.join(' und ')} verfügbar – unter „${u.addons ? `${W}s` : 'Version'}“ einspielen.` });
  }

  async applyPending() {
    for (const [id, st] of this.state) {
      if (!st || !st.server) continue;
      let s; try { s = this.mc.get(id); } catch { continue; }
      if (s.autoServerUpdates === false || this.mc.proc(id).isRunning()) continue;
      await this.check(id, { notify: false });
    }
  }

  async checkAll() {
    if (!this.cfg.updateCheck) return;
    for (const s of this.mc.list()) {
      if (s.type === 'custom') continue;
      await this.check(s.id).catch(() => {});
    }
  }

  routes(r) {
    r.get('/mc/updates', (req, res) => res.json({ enabled: !!this.cfg.updateCheck, servers: Object.fromEntries([...this.state.entries()]) }));
    r.post('/mc/servers/:id/updates/check', async (req, res) => res.json(await this.check(req.params.id, { notify: false })));
    r.put('/mc/updates', (req, res) => { const b = req.body || {}; if (typeof b.enabled === 'boolean') this.cfg.updateCheck = b.enabled; this.mc.settings.save(); res.json({ enabled: this.cfg.updateCheck }); });
  }
}

module.exports = { UpdateWatch };
