'use strict';
/*
 * Plugin-Live-Update: neue Plugin-Versionen in einen laufenden Minecraft-Server bringen.
 *
 *  - „hot“:     Hostwerk-Bridge entlädt das alte Plugin und lädt das neue – ohne Neustart.
 *  - „restart“: JAR austauschen und den Server mit Countdown für die Spieler neu starten (immer sauber).
 *  - „auto“:    hot, wenn es sicher geht (keine abhängigen Plugins, kein Paper-Plugin), sonst restart.
 *
 * Auslöser: Knopf in Hostwerk, ein Skript im Plugin-Projekt (hostwerk-deploy.cmd/.sh, auch als Gradle-Task)
 * oder die Ordnerüberwachung (neue JAR in target/ bzw. build/libs/ wird automatisch übernommen).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runJob } = require('./hw').core('jobs');
const { broadcast } = require('./hw').core('events');

const BRIDGE_JAR = path.join(__dirname, 'bridge', 'HostwerkBridge.jar');
const HW_LINE = /\[HW\] (.+)$/;

class LiveUpdate {
  constructor(ctx, mc, readPluginMeta) {
    this.ctx = ctx;
    this.mc = mc;
    this.readMeta = readPluginMeta;
    this.waiters = new Map(); // id -> [{ test, resolve }]
    this.watchers = new Map(); // id -> { close }
    this.busy = new Set();
    this.lastDeployed = new Map(); // id -> Signatur der zuletzt eingespielten JAR (gegen doppeltes Einspielen)
    setTimeout(() => { for (const s of this.mc.list()) this.applyWatch(s.id); }, 2000);
  }

  cfg(id) {
    const s = this.mc.get(id);
    if (!s.liveUpdate) s.liveUpdate = { mode: 'auto', countdown: 10, key: crypto.randomBytes(18).toString('hex'), watch: [] };
    if (!s.liveUpdate.key) s.liveUpdate.key = crypto.randomBytes(18).toString('hex');
    if (!Array.isArray(s.liveUpdate.watch)) s.liveUpdate.watch = [];
    return s.liveUpdate;
  }
  pluginsDir(id) { return path.join(this.mc.dir(id), 'plugins'); }
  supported(id) { return this.mc.info(this.mc.get(id)).pluginsSupported !== false; }

  /* ---------------- Bridge ---------------- */
  /** Bridge-Plugin in den Server legen (bzw. aktualisieren). Wirkt beim nächsten Start. */
  bridgeDisabled(id) { return fs.existsSync(path.join(this.pluginsDir(id), 'HostwerkBridge.jar.disabled')); }
  bridgePresent(id) { return fs.existsSync(path.join(this.pluginsDir(id), 'HostwerkBridge.jar')); }
  /**
   * Live-Update hängt an der Bridge: abgeschaltet oder gelöscht → Live-Update aus (gemerkt als „wegen Bridge pausiert“);
   * ist sie wieder da und aktiv → Live-Update von selbst wieder an, falls es vorher an war.
   */
  syncBridge(id) {
    let cfg; try { cfg = this.cfg(id); } catch { return null; }
    if (!this.supported(id)) return null;
    const present = this.bridgePresent(id);
    let changed = null;
    if (!present && cfg.enabled) { cfg.enabled = false; cfg.pausedByBridge = true; changed = 'off'; }
    else if (present && cfg.pausedByBridge) { cfg.enabled = true; delete cfg.pausedByBridge; changed = 'on'; }
    if (changed) {
      try { this.ctx.settings.save(); } catch { /* egal */ }
      this.applyWatch(id);
      const s = this.mc.get(id);
      broadcast({ type: 'toast', kind: changed === 'on' ? 'success' : 'warn', text: changed === 'on' ? `${s.name}: HostwerkBridge ist wieder aktiv – Plugin-Live-Update ist wieder an.` : `${s.name}: Ohne HostwerkBridge ist Plugin-Live-Update ausgeschaltet. Es schaltet sich wieder ein, sobald die Bridge zurück ist.` });
    }
    return changed;
  }
  ensureBridge(id, { force = false } = {}) {
    if (!this.supported(id) || !fs.existsSync(BRIDGE_JAR)) return false;
    const dir = this.pluginsDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'HostwerkBridge.jar');
    // Vom Nutzer unter „Plugins“ abgeschaltet: nicht heimlich wieder dazulegen (sonst liegt sie doppelt da)
    if (fs.existsSync(target + '.disabled')) {
      if (!force) return false;
      try { fs.rmSync(target, { force: true }); fs.renameSync(target + '.disabled', target); } catch { return false; }
    }
    const src = fs.readFileSync(BRIDGE_JAR);
    if (!fs.existsSync(target) || !src.equals(fs.readFileSync(target))) {
      try { fs.writeFileSync(target, src); } catch { return false; } // gesperrt, solange der Server läuft
    }
    return true;
  }

  /** Konsolenzeile vom Server – Antworten der Bridge herausfischen. */
  onLine(id, line) {
    const m = line.match(HW_LINE);
    if (!m) return;
    const msg = m[1].trim();
    const p = this.mc.proc(id);
    if (/^READY /.test(msg)) p.setExtra({ bridge: msg.slice(6) });
    const list = this.waiters.get(id) || [];
    for (const w of [...list]) if (w.test(msg)) { w.resolve(msg); list.splice(list.indexOf(w), 1); }
  }
  waitFor(id, test, timeout) {
    return new Promise((resolve) => {
      const list = this.waiters.get(id) || [];
      const w = { test, resolve };
      list.push(w);
      this.waiters.set(id, list);
      setTimeout(() => { const i = list.indexOf(w); if (i >= 0) { list.splice(i, 1); resolve(null); } }, timeout);
    });
  }

  /* ---------------- Bereitstellen ---------------- */
  /** Neueste Plugin-JAR in einem Projektordner (Maven: target/, Gradle: build/libs/). */
  findJar(projectDir) {
    const cands = [];
    for (const sub of ['build/libs', 'target', 'out', '.']) {
      const d = path.join(projectDir, sub);
      if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue;
      for (const f of fs.readdirSync(d)) {
        if (!/\.jar$/i.test(f) || /-(sources|javadoc|tests?)\.jar$/i.test(f) || /^original-/i.test(f)) continue;
        const full = path.join(d, f);
        cands.push({ full, t: fs.statSync(full).mtimeMs });
      }
    }
    cands.sort((a, b) => b.t - a.t);
    if (!cands.length) throw new Error(`Keine JAR in ${projectDir} gefunden (gesucht in build/libs/ und target/). Erst das Plugin bauen.`);
    return cands[0].full;
  }

  /** Alle JARs im plugins-Ordner, die zu diesem Plugin-Namen gehören. */
  async jarsOf(id, name) {
    const dir = this.pluginsDir(id);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
      if (!/\.jar$/i.test(f)) continue;
      const meta = await this.readMeta(path.join(dir, f));
      if (meta && meta.name && meta.name.toLowerCase() === name.toLowerCase()) out.push(path.join(dir, f));
    }
    return out;
  }

  /* ---------------- Warteschlange für Plugin-Updates ----------------
   * Läuft der Server und ist kein Live-Austausch möglich, wartet die neue JAR in plugins/.hostwerk/pending/ (mit
   * Eintrag in pending.json). Hostwerk spielt sie ein, sobald der Server stoppt – und sicherheitshalber vor jedem Start
   * (z. B. nach einem Absturz). Funktioniert für Paper, Spigot, Purpur, Folia … gleich und ohne „plugins/update“-Eigenheiten.
   */
  pendingDir(id) { return path.join(this.pluginsDir(id), '.hostwerk', 'pending'); }
  pendingList(id) { try { return JSON.parse(fs.readFileSync(path.join(this.pendingDir(id), 'pending.json'), 'utf8')); } catch { return []; } }
  savePending(id, list) { fs.mkdirSync(this.pendingDir(id), { recursive: true }); fs.writeFileSync(path.join(this.pendingDir(id), 'pending.json'), JSON.stringify(list, null, 2)); }
  /** JAR einreihen (ersetzt einen älteren Eintrag desselben Plugins). */
  queue(id, jar, meta) {
    const fileName = path.basename(jar);
    fs.mkdirSync(this.pendingDir(id), { recursive: true });
    const target = path.join(this.pendingDir(id), fileName);
    if (path.resolve(jar) !== path.resolve(target)) fs.copyFileSync(jar, target);
    const list = this.pendingList(id).filter((x) => x.name !== meta.name);
    for (const old of this.pendingList(id).filter((x) => x.name === meta.name && x.file !== fileName)) { try { fs.rmSync(path.join(this.pendingDir(id), old.file), { force: true }); } catch { /* egal */ } }
    list.push({ name: meta.name, version: meta.version || null, file: fileName, at: Date.now(), replace: meta.replace || null, dir: meta.dir || 'plugins' });
    this.savePending(id, list);
    return list;
  }
  /** Wartende Updates einspielen (Server gestoppt). Liefert die eingespielten Namen. */
  async applyPending(id) {
    if (this.mc.proc(id).isRunning()) return [];
    if (!fs.existsSync(path.join(this.pendingDir(id), 'pending.json'))) return [];
    const list = this.pendingList(id);
    if (!list.length) return [];
    const done = []; const rest = [];
    for (const x of list) {
      const src = path.join(this.pendingDir(id), x.file);
      if (!fs.existsSync(src)) continue;
      const dir = path.join(this.mc.dir(id), x.dir === 'mods' ? 'mods' : 'plugins');
      try {
        fs.mkdirSync(dir, { recursive: true });
        if (x.replace && x.replace !== x.file) fs.rmSync(path.join(dir, x.replace), { force: true });
        if (x.dir !== 'mods') for (const old of await this.jarsOf(id, x.name)) if (path.basename(old) !== x.file) fs.rmSync(old, { force: true });
        fs.copyFileSync(src, path.join(dir, x.file));
        fs.rmSync(src, { force: true });
        done.push(`${x.name} ${x.version || ''}`.trim());
      } catch { rest.push(x); } // Datei noch gesperrt (Server-Prozess gerade beendet) → beim nächsten Versuch
    }
    this.savePending(id, rest);
    if (done.length) {
      const s = this.mc.get(id);
      this.mc.proc(id).log(`Hostwerk: eingereihte Plugin-Updates eingespielt – ${done.join(', ')}`, 'sys');
      broadcast({ type: 'toast', kind: 'success', text: `${s.name}: Plugin-Updates eingespielt – ${done.join(', ')}` });
    }
    return done;
  }

  /**
   * Plugin bereitstellen. jar = Pfad zu einer JAR (wird kopiert, das Original bleibt liegen).
   * fallback = 'restart' (Live-Update-Knopf: notfalls Neustart mit Vorwarnung) oder 'queue' (Updates: nie zwangsweise
   * neu starten – einreihen und beim nächsten Stopp/Start einspielen).
   * Liefert { mode: 'hot'|'restart'|'copy'|'queued', name, version, text }.
   */
  deploy(id, jar, { mode: forced = null, source = 'Hostwerk', fallback = 'restart', expectName = null } = {}) {
    const s = this.mc.get(id);
    return runJob(`Plugin-Update auf „${s.name}“`, async (job) => {
      if (!fs.existsSync(jar)) throw new Error(`Datei nicht gefunden: ${jar}`);
      const jst = fs.statSync(jar);
      this.lastDeployed.set(id, `${path.resolve(jar)}|${jst.size}|${jst.mtimeMs}`);
      // Prüfungen vor dem Einspielen: echte JAR (ZIP), plugin.yml, gleicher Plugin-Name wie das zu ersetzende Plugin
      const head = Buffer.alloc(2); const fd = fs.openSync(jar, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
      if (head.toString() !== 'PK') throw new Error('Die Datei ist keine JAR (kein ZIP-Archiv) – vermutlich eine Webseite statt des Downloads.');
      const meta = await this.readMeta(jar);
      if (!meta || !meta.name) throw new Error('Das ist keine Plugin-JAR (plugin.yml oder paper-plugin.yml fehlt).');
      if (expectName && meta.name.toLowerCase() !== String(expectName).toLowerCase()) throw new Error(`Die neue JAR enthält das Plugin „${meta.name}“ statt „${expectName}“ – nicht eingespielt.`);
      const name = meta.name;
      job.log(`${name} ${meta.version || ''} (${path.basename(jar)}) – angestoßen von ${source}`);
      const cfg = this.cfg(id);
      const p = this.mc.proc(id);
      // Startet der Server gerade? Dann warten, bis er bereit ist (Dateien sind solange gesperrt)
      if (p.isRunning() && !p.extra.ready) {
        job.progress(10, 'Server startet gerade – warte, bis er bereit ist …');
        for (let i = 0; i < 300 && p.isRunning() && !p.extra.ready; i++) await new Promise((r) => setTimeout(r, 1000));
      }
      const running = p.isRunning() && p.extra.ready;
      const dir = this.pluginsDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const fileName = path.basename(jar);

      // Server aus: einfach austauschen
      if (!running) {
        for (const old of await this.jarsOf(id, name)) if (path.basename(old) !== fileName) fs.rmSync(old, { force: true });
        fs.copyFileSync(jar, path.join(dir, fileName));
        const text = `${name} ${meta.version || ''} liegt bereit – aktiv beim nächsten Start.`;
        job.log(text);
        return { mode: 'copy', name, version: meta.version, text };
      }

      let mode = forced || cfg.mode || 'auto';
      if (mode !== 'restart' && this.bridgeDisabled(id)) {
        job.log('Die Hostwerk-Bridge ist unter „Plugins“ abgeschaltet – ohne sie geht nur das Update per Neustart.');
        mode = 'restart';
      } else if (mode !== 'restart' && !p.extra.bridge) {
        job.log('Die Hostwerk-Bridge läuft auf diesem Server (noch) nicht – sie wird beim nächsten Neustart aktiv. Jetzt per Neustart.');
        mode = 'restart';
      }
      // Hat der Live-Austausch auf genau dieser Server-Version schon versagt (z. B. neue Paper-Version ändert Interna)?
      // Dann gleich sicher neu starten statt jedes Mal 60 s auf die Bridge zu warten.
      const ver = `${s.type} ${s.version || ''}`.trim();
      if (mode === 'auto' && cfg.hotBroken === ver) { job.log(`Live-Austausch klappt auf ${ver} nicht – direkt per Neustart.`); mode = 'restart'; }
      let hotAnswer = null; // Antwort der Bridge auf den Live-Austausch (für FAIL → Neustart statt Warteschlange)
      if (mode !== 'restart') {
        // Datei in einen Unterordner legen (Bukkit lädt nur JARs direkt in plugins/)
        const stageDir = path.join(dir, '.hostwerk');
        fs.mkdirSync(stageDir, { recursive: true });
        const staged = path.join(stageDir, 'hw-staged-' + fileName);
        fs.copyFileSync(jar, staged);
        // Andere alte Dateinamen desselben Plugins (z. B. mit anderer Versionsnummer) merkt sich die Bridge selbst
        const others = (await this.jarsOf(id, name)).filter((f) => path.basename(f) !== fileName);
        job.progress(40, 'Plugin wird im laufenden Server ausgetauscht …');
        const answer = this.waitFor(id, (m) => new RegExp(`^RELOAD (OK|NO|FAIL) ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(m), 60000);
        this.mc.command(id, `hostwerk reload ${name} ${staged}`);
        const res = await answer;
        hotAnswer = res;
        if (res && /^RELOAD OK/i.test(res)) {
          if (cfg.hotBroken) { delete cfg.hotBroken; this.mc.settings.save(); }
          if (this.mc.ctx && this.mc.ctx.keeper) this.mc.ctx.keeper.note(`bridge-${id}`, { ok: true, label: `Plugin-Live-Update (${s.name})`, text: `Live-Austausch funktioniert auf ${ver}.` });
          // Übrig gebliebene alte Dateien (anderer Dateiname) entfernen – sonst lädt der nächste Start beide
          for (const o of others) { try { fs.rmSync(o, { force: true }); } catch { /* egal */ } }
          // Bridge ab 1.2 lädt abhängige Plugins mit neu: „RELOAD OK VoiceAPI 1.8.0 -> 1.8.1 +NoteAPI“
          const [, change, also] = res.replace(/^RELOAD OK \S+ ?/i, '').match(/^(.*?)(?:\s\+(\S+))?$/) || [];
          const text = `${name} live aktualisiert (${change})${also ? `, ${also.split(',').join(', ')} mit neu geladen` : ''} – ohne Neustart.`;
          job.log(text);
          this.mc.proc(id).log(`Hostwerk: ${text}`, 'sys');
          broadcast({ type: 'toast', kind: 'success', text: `${s.name}: ${text}` });
          return { mode: 'hot', name, version: meta.version, text };
        }
        try { fs.rmSync(staged, { force: true }); } catch { /* schon verschoben */ }
        const why = !res ? 'keine Antwort der Bridge' : res.replace(/^RELOAD (NO|FAIL) \S+ ?/i, '');
        job.log(`Live-Austausch nicht möglich: ${why}`);
        // Keine Antwort oder FAIL = die Bridge passt nicht (mehr) zu dieser Server-Version → merken
        if (!res || /^RELOAD FAIL/i.test(res)) {
          cfg.hotBroken = ver;
          this.mc.settings.save();
          if (this.mc.ctx && this.mc.ctx.keeper) this.mc.ctx.keeper.note(`bridge-${id}`, { ok: true, label: `Plugin-Live-Update (${s.name})`, text: `Auf ${ver} klappt der Live-Austausch nicht (${why}) – Plugin-Updates laufen automatisch per kurzem Neustart.` });
        }
        // FAIL = altes Plugin ist evtl. schon entladen – dann hilft nur der Neustart
        if (mode === 'hot' && res && /^RELOAD NO/i.test(res) && fallback !== 'queue') throw new Error(`Live-Austausch nicht möglich: ${why}. Stelle „Automatisch“ oder „Neustart“ ein.`);
        if (fallback !== 'queue') job.log('Weiter mit sicherem Neustart …');
      }

      // Updates: nicht zwangsweise neu starten – einreihen, beim nächsten Stopp oder Start einspielen.
      // Ausnahme: der Live-Austausch ist mittendrin gescheitert (FAIL) – dann fehlt das Plugin schon, nur ein Neustart hilft.
      const broke = !!hotAnswer && /^RELOAD FAIL/i.test(hotAnswer);
      if (broke) job.log('Das alte Plugin ist schon entladen – sicherer Neustart statt Warten.');
      if (fallback === 'queue' && !broke) {
        this.queue(id, jar, meta);
        const text = `${name} ${meta.version || ''} wartet – wird beim nächsten Stopp oder Neustart eingespielt.`;
        job.log(text);
        this.mc.proc(id).log(`Hostwerk: ${text}`, 'sys');
        return { mode: 'queued', name, version: meta.version, text };
      }

      // Sicherer Neustart mit Vorwarnung
      const secs = Math.max(0, Number(cfg.countdown) || 0);
      if (secs > 0 && (p.extra.playerCount || (p.extra.players || []).length)) {
        job.progress(60, `Neustart in ${secs} Sekunden (Spieler werden gewarnt) …`);
        this.mc.command(id, `say §e[Hostwerk] §fServer startet in ${secs} Sekunden neu (Plugin-Update ${name}).`);
        for (let left = secs; left > 0; left--) {
          if (left <= 5) this.mc.command(id, `say §e[Hostwerk] §fNeustart in ${left} …`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      job.progress(75, 'Server wird gestoppt …');
      await this.mc.stop(id);
      for (const old of await this.jarsOf(id, name)) if (path.basename(old) !== fileName) fs.rmSync(old, { force: true });
      fs.copyFileSync(jar, path.join(dir, fileName));
      this.ensureBridge(id);
      job.progress(85, 'Server wird gestartet …');
      await this.mc.start(id);
      const text = `${name} ${meta.version || ''} installiert – Server wurde neu gestartet.`;
      job.log(text);
      broadcast({ type: 'toast', kind: 'success', text: `${s.name}: ${text}` });
      return { mode: 'restart', name, version: meta.version, text };
    }, { key: 'mc-deploy-' + id });
  }

  /* ---------------- Ordnerüberwachung ---------------- */
  applyWatch(id) {
    const old = this.watchers.get(id);
    if (old) old.close();
    this.watchers.delete(id);
    let cfg;
    try { cfg = this.cfg(id); } catch { return; }
    const dirs = cfg.enabled ? (cfg.watch || []).filter((d) => d && fs.existsSync(d)) : [];
    if (!dirs.length) return;
    const handles = [];
    const timers = new Map();
    const lastSeen = new Map();
    const kick = (projectDir) => {
      clearTimeout(timers.get(projectDir));
      // Warten, bis der Build die JAR fertig geschrieben hat (Größe 2 s stabil)
      timers.set(projectDir, setTimeout(async () => {
        let jar;
        try { jar = this.findJar(projectDir); } catch { return; }
        const st = fs.statSync(jar);
        const sig = `${jar}|${st.size}|${st.mtimeMs}`;
        if (lastSeen.get(projectDir) === sig) return;
        lastSeen.set(projectDir, sig);
        // Schon per Skript/Knopf eingespielt? Dann nicht ein zweites Mal
        if (this.lastDeployed.get(id) === `${path.resolve(jar)}|${st.size}|${st.mtimeMs}`) return;
        if (Date.now() - st.mtimeMs > 60000) return; // keine frische JAR
        this.deploy(id, jar, { source: 'Ordnerüberwachung' }).promise.catch((e) => broadcast({ type: 'toast', kind: 'error', text: `Plugin-Update: ${e.message}` }));
      }, 2500));
    };
    for (const projectDir of dirs) {
      // Merken, was gerade da ist – nur neue Builds lösen ein Update aus
      try { const j = this.findJar(projectDir); const st = fs.statSync(j); lastSeen.set(projectDir, `${j}|${st.size}|${st.mtimeMs}`); } catch { /* noch nichts gebaut */ }
      // Ganzes Projekt beobachten (auch wenn build/libs bzw. target noch nicht existieren), nur JARs zählen
      try {
        handles.push(fs.watch(projectDir, { recursive: true }, (ev, file) => {
          const f = String(file || '').replace(/\\/g, '/');
          if (/\.jar$/i.test(f) && /(^|\/)(build\/libs|target)\//.test(f)) kick(projectDir);
        }));
      } catch { /* Ordner weg */ }
    }
    this.watchers.set(id, { close: () => { handles.forEach((h) => h.close()); timers.forEach((t) => clearTimeout(t)); } });
  }

  /* ---------------- Skript fürs Plugin-Projekt ---------------- */
  /** Legt hostwerk-deploy.cmd/.sh (und bei Gradle einen Task) im Plugin-Projekt an. */
  installScript(id, projectDir) {
    const s = this.mc.get(id);
    if (!projectDir || !fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error('Projektordner nicht gefunden.');
    const cfg = this.cfg(id);
    this.ctx.settings.save();
    const port = this.ctx.uiPort ? this.ctx.uiPort() : 7780;
    const url = `http://127.0.0.1:${port}/hook/mc/${encodeURIComponent(id)}/deploy?key=${cfg.key}`;
    const files = [];
    const cmd = [
      '@echo off',
      `rem Hostwerk: Plugin per Live-Update auf den Minecraft-Server „${s.name}“ bringen.`,
      'rem Aufruf nach dem Bauen: hostwerk-deploy.cmd  (optional mit Pfad zu einer bestimmten JAR)',
      'rem Hostwerk sucht sonst die neueste JAR in build\\libs\\ bzw. target\\.',
      'setlocal',
      'set "HW_PROJECT=%~dp0"',
      `curl.exe -s -S --fail-with-body --data-urlencode "project=%HW_PROJECT:~0,-1%" --data-urlencode "jar=%~1" "${url}"`,
      'if errorlevel 1 (echo. & echo Hostwerk-Deploy fehlgeschlagen – laeuft Hostwerk? & exit /b 1)',
      'echo.',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(projectDir, 'hostwerk-deploy.cmd'), cmd);
    files.push('hostwerk-deploy.cmd');
    const sh = [
      '#!/bin/sh',
      `# Hostwerk: Plugin per Live-Update auf den Minecraft-Server „${s.name}“ bringen.`,
      '# Aufruf nach dem Bauen: ./hostwerk-deploy.sh  (optional mit Pfad zu einer bestimmten JAR)',
      'DIR="$(cd "$(dirname "$0")" && pwd)"',
      `curl -s -S --fail-with-body --data-urlencode "project=$DIR" --data-urlencode "jar=$1" "${url}" || { echo; echo "Hostwerk-Deploy fehlgeschlagen – läuft Hostwerk?"; exit 1; }`,
      'echo',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(projectDir, 'hostwerk-deploy.sh'), sh);
    try { fs.chmodSync(path.join(projectDir, 'hostwerk-deploy.sh'), 0o755); } catch { /* Windows */ }
    files.push('hostwerk-deploy.sh');

    // Gradle: Task „deployHostwerk“ (baut und bringt das Plugin auf den Server)
    const kts = path.join(projectDir, 'build.gradle.kts');
    const groovy = path.join(projectDir, 'build.gradle');
    const gradleFile = fs.existsSync(kts) ? kts : fs.existsSync(groovy) ? groovy : null;
    let gradle = false;
    if (gradleFile) {
      const src = fs.readFileSync(gradleFile, 'utf8');
      const jarTask = /shadow/i.test(src) ? 'shadowJar' : 'build';
      if (!/deployHostwerk/.test(src)) {
        const block = gradleFile === kts
          ? `\n// Hostwerk: bauen und per Live-Update auf den Minecraft-Server bringen – ./gradlew deployHostwerk\ntasks.register<Exec>("deployHostwerk") {\n    group = "hostwerk"\n    dependsOn("${jarTask}")\n    commandLine(if (System.getProperty("os.name").startsWith("Windows")) listOf("cmd", "/c", file("hostwerk-deploy.cmd").absolutePath) else listOf("sh", file("hostwerk-deploy.sh").absolutePath))\n}\n`
          : `\n// Hostwerk: bauen und per Live-Update auf den Minecraft-Server bringen – ./gradlew deployHostwerk\ntasks.register('deployHostwerk', Exec) {\n    group = 'hostwerk'\n    dependsOn '${jarTask}'\n    commandLine System.getProperty('os.name').startsWith('Windows') ? ['cmd', '/c', file('hostwerk-deploy.cmd').absolutePath] : ['sh', file('hostwerk-deploy.sh').absolutePath]\n}\n`;
        fs.appendFileSync(gradleFile, block);
      }
      gradle = true;
      files.push(`${path.basename(gradleFile)} (Task deployHostwerk)`);
    }
    const maven = fs.existsSync(path.join(projectDir, 'pom.xml'));
    return {
      files, gradle, maven, url,
      howto: gradle ? './gradlew deployHostwerk  (bzw. gradlew.bat deployHostwerk)'
        : maven ? 'mvn package && hostwerk-deploy.cmd   (Linux: mvn package && ./hostwerk-deploy.sh)'
          : 'Nach dem Bauen hostwerk-deploy.cmd bzw. ./hostwerk-deploy.sh ausführen',
    };
  }

  status(id) {
    this.syncBridge(id);
    const cfg = this.cfg(id);
    const p = this.mc.proc(id);
    const target = path.join(this.pluginsDir(id), 'HostwerkBridge.jar');
    return {
      enabled: !!cfg.enabled, pausedByBridge: !!cfg.pausedByBridge, mode: cfg.mode, countdown: cfg.countdown, watch: cfg.watch,
      supported: this.supported(id),
      bridge: { installed: fs.existsSync(target), active: !!p.extra.bridge, version: p.extra.bridge || null, disabled: this.bridgeDisabled(id) },
      port: this.ctx.uiPort ? this.ctx.uiPort() : 7780,
    };
  }

  routes(r, upload) {
    r.get('/mc/servers/:id/live-update', (req, res) => res.json(this.status(req.params.id)));
    r.put('/mc/servers/:id/live-update', (req, res) => {
      const cfg = this.cfg(req.params.id);
      const b = req.body || {};
      if (['auto', 'hot', 'restart'].includes(b.mode)) cfg.mode = b.mode;
      if (typeof b.enabled === 'boolean') { cfg.enabled = b.enabled; delete cfg.pausedByBridge; if (b.enabled) this.ensureBridge(req.params.id, { force: true }); }
      if (b.countdown != null && Number.isFinite(Number(b.countdown))) cfg.countdown = Math.max(0, Math.min(300, Math.round(Number(b.countdown))));
      if (Array.isArray(b.watch)) cfg.watch = b.watch.filter((d) => typeof d === 'string' && d.trim()).map((d) => path.resolve(d.trim())).slice(0, 10);
      this.ctx.settings.save();
      this.applyWatch(req.params.id);
      res.json(this.status(req.params.id));
    });
    r.post('/mc/servers/:id/live-update/bridge', (req, res) => {
      const ok = this.ensureBridge(req.params.id, { force: true });
      res.json({ ok, ...this.status(req.params.id) });
    });
    r.post('/mc/servers/:id/live-update/script', (req, res) => res.json(this.installScript(req.params.id, String((req.body || {}).dir || ''))));
    r.post('/mc/servers/:id/deploy', upload.single('file'), async (req, res) => {
      const b = req.body || {};
      let jar = b.jar || null;
      if (req.file) {
        if (!/\.jar$/i.test(req.file.originalname)) throw new Error('Bitte eine .jar-Datei hochladen.');
        jar = path.join(path.dirname(req.file.path), req.file.originalname);
        fs.renameSync(req.file.path, jar);
      } else if (b.project) jar = this.findJar(b.project);
      if (!jar) throw new Error('Keine JAR angegeben.');
      res.json({ job: this.deploy(req.params.id, jar, { mode: b.mode || null }).id });
    });
  }

  /**
   * Endpunkt für das Deploy-Skript (ohne Anmelde-Cookie, aber nur von diesem PC und mit Server-Schlüssel).
   * Antwortet als Text, sobald das Update durch ist – so sieht man das Ergebnis direkt im Terminal.
   */
  hook(app, express) {
    app.post('/hook/mc/:id/deploy', express.urlencoded({ extended: false }), (req, res) => this.deployHook(req, res));
  }

  /**
   * Die Adresse /hook/mc/<id>/deploy steht in den Skripten der Plugin-Projekte – sie bleibt im Kern angemeldet (außerhalb
   * von /api) und reicht hierher weiter, solange die Erweiterung läuft. req.body = urlencoded (project, jar).
   */
  async deployHook(req, res) {
    {
      const ip = req.socket.remoteAddress || '';
      if (!/^(::1|127\.|::ffff:127\.)/.test(ip)) return res.status(403).type('text').send('Nur lokal erlaubt.\n');
      let s;
      try { s = this.mc.get(req.params.id); } catch { return res.status(404).type('text').send('Minecraft-Server nicht gefunden.\n'); }
      const key = String(req.query.key || '');
      const want = this.cfg(s.id).key;
      if (key.length !== want.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want))) return res.status(403).type('text').send('Falscher Schlüssel – Skript in Hostwerk neu installieren.\n');
      try {
        const b = req.body || {};
        const jar = b.jar ? path.resolve(b.jar) : this.findJar(path.resolve(String(b.project || '.')));
        const job = this.deploy(s.id, jar, { source: 'Deploy-Skript' });
        const r = await job.promise;
        res.type('text').send(`Hostwerk: ${r.text}\n`);
      } catch (e) {
        res.status(500).type('text').send(`Hostwerk: ${e.message}\n`);
      }
    }
  }
}

module.exports = { LiveUpdate, BRIDGE_JAR };
