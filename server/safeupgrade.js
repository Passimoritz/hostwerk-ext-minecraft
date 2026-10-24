'use strict';
/*
 * Sicherer Versionssprung: Vor einem Wechsel der Minecraft-Version prüft Hostwerk,
 *   1. ob alle Plugins/Mods für die Zielversion freigegeben sind (Modrinth per Datei-Hash, Hangar, verknüpfte Quellen),
 *   2. ob der Server mit der neuen Version auf einer KOPIE startet (Probelauf in Temp-Ordner, eigener Port),
 * und spielt die neue Version erst dann ein – mit Backup vorher und auf Wunsch mit den passenden Plugin-Updates.
 * Ergebnisse je Server in this.last (GET /mc/servers/:id/safe-upgrade).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runJob } = require('./hw').core('jobs');
const { fetchJson, downloadFile } = require('./hw').core('download');
const { providers, javaFor } = require('./providers');
const { trialRun } = require('./trial');

const MR = 'https://api.modrinth.com/v2';
const HG = 'https://hangar.papermc.io/api/v1';
const UA = 'Hostwerk (github.com/Passimoritz/hostwerk)';

class SafeUpgrade {
  constructor(mc) { this.mc = mc; this.last = new Map(); this.hist = new Map(); }
  remember(id, result) { this.last.set(id, result); const h = (this.hist.get(id) || []).filter((x) => x.at !== result.at); h.unshift(result); this.hist.set(id, h.slice(0, 10)); }

  /** Plugin-Verträglichkeit mit der Zielversion. */
  async check(id, { version, type } = {}) {
    const s = this.mc.get(id);
    const t = type || s.type;
    if (!version) throw new Error('Zielversion fehlt.');
    const loaders = (providers[t] && providers[t].loaders) || ['paper', 'spigot', 'bukkit'];
    const dir = this.mc.addonDir(id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/i.test(f) && !/^HostwerkBridge\.jar/i.test(f)) : [];
    const out = [];
    if (!files.length) return { version, type: t, plugins: out, ok: true, summary: 'Keine Plugins/Mods – nichts zu prüfen.' };
    const hashes = {};
    for (const f of files) hashes[crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex')] = f;
    const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error(`Modrinth antwortet mit ${r.status}`); return r.json(); };
    let current = {}; let forTarget = {};
    try { [current, forTarget] = await Promise.all([post(`${MR}/version_files`, { hashes: Object.keys(hashes), algorithm: 'sha1' }), post(`${MR}/version_files/update`, { hashes: Object.keys(hashes), algorithm: 'sha1', loaders, game_versions: [version] })]); } catch (e) { return { version, type: t, plugins: files.map((f) => ({ file: f, status: 'unknown', note: 'Modrinth nicht erreichbar: ' + e.message })), ok: false, offline: true }; }
    const src = this.mc.market.sources(id);
    const meta = await this.mc.plugins(id);
    for (const [hash, file] of Object.entries(hashes)) {
      const base = file.replace(/\.disabled$/i, '');
      const m = meta.find((p) => p.file === file) || {};
      const cur = current[hash]; const nxt = forTarget[hash];
      const entry = { file, name: m.name || base, current: (cur && cur.version_number) || m.version || null, enabled: !/\.disabled$/i.test(file) };
      if (cur) {
        if (nxt && nxt.id === cur.id) Object.assign(entry, { status: 'ok', note: `${entry.current} ist für ${version} freigegeben` });
        else if (nxt) Object.assign(entry, { status: 'update', latest: nxt.version_number, versionId: nxt.id, projectId: cur.project_id, file_url: (nxt.files.find((x) => x.primary) || nxt.files[0] || {}).url, filename: (nxt.files.find((x) => x.primary) || nxt.files[0] || {}).filename, sha1: ((nxt.files.find((x) => x.primary) || nxt.files[0] || {}).hashes || {}).sha1, note: `Version ${nxt.version_number} passt zu ${version}` });
        else Object.assign(entry, { status: 'none', note: `Keine Version für ${version} auf Modrinth` });
      } else if (src[base] && src[base].source === 'hangar') {
        try {
          const vj = await fetchJson(`${HG}/projects/${encodeURIComponent(src[base].id)}/versions?limit=25&platform=PAPER&platformVersion=${encodeURIComponent(version)}`);
          const v = (vj.result || [])[0];
          if (!v) Object.assign(entry, { status: 'none', note: `Keine Hangar-Version für ${version}` });
          else if (v.name === src[base].version) Object.assign(entry, { status: 'ok', note: `${v.name} ist für ${version} freigegeben` });
          else Object.assign(entry, { status: 'update', latest: v.name, hangarId: src[base].id, note: `Version ${v.name} passt zu ${version}` });
        } catch (e) { Object.assign(entry, { status: 'unknown', note: 'Hangar: ' + e.message }); }
      } else if (src[base] && ['github', 'spigot', 'jenkins', 'url'].includes(src[base].source)) {
        Object.assign(entry, { status: 'unknown', note: `Quelle ${src[base].source}: Verträglichkeit nicht prüfbar – der Probelauf entscheidet` });
      } else {
        // Hinweis aus plugin.yml: api-version größer als Ziel-Hauptversion → sicher inkompatibel
        const api = m.apiVersion ? String(m.apiVersion) : null;
        const mm = (v) => String(v).split('.').slice(0, 2).join('.');
        if (api && Number(mm(api).split('.')[0]) === 1 && Number(mm(version).split('.')[0]) === 1 && Number(mm(api).split('.')[1]) > Number(mm(version).split('.')[1])) Object.assign(entry, { status: 'none', note: `plugin.yml verlangt API ${api} – neuer als ${version}` });
        else Object.assign(entry, { status: 'unknown', note: 'Nicht auf Modrinth/Hangar – der Probelauf entscheidet' });
      }
      out.push(entry);
    }
    const n = (st) => out.filter((x) => x.status === st && x.enabled).length;
    const ok = n('none') === 0;
    const summary = `${n('ok')} passen, ${n('update')} brauchen ein Update, ${n('unknown')} unbekannt, ${n('none')} ohne passende Version`;
    return { version, type: t, plugins: out, ok, summary, counts: { ok: n('ok'), update: n('update'), unknown: n('unknown'), none: n('none') } };
  }

  /** Probelauf auf Kopie und (optional) Einspielen. */
  run(id, { version, type, updatePlugins = true, apply = false, keepWorlds = true } = {}) {
    const s = this.mc.get(id);
    const t = type || s.type;
    if (!providers[t]) throw new Error('Unbekannter Servertyp');
    // Bedrock hat sein eigenes Update mit Probestart und Rücksprung (Version → Bedrock aktualisieren)
    if (this.mc.isBedrock(s) || providers[t].edition === 'bedrock') throw new Error('Für Bedrock-Server gibt es das Update mit Probestart unter „Version“.');
    if (!version) throw new Error('Zielversion fehlt.');
    const ctx = this.mc.ctx;
    return runJob(`Sicherer Versionssprung: ${s.name} → ${providers[t].label} ${version}`, async (job) => {
      const result = { at: Date.now(), from: `${s.type} ${s.version}`, to: `${t} ${version}`, applied: false };
      job.progress(3, 'Plugins prüfen …');
      result.check = await this.check(id, { version, type: t });
      job.log(`Plugins: ${result.check.summary}`);
      const dls = updatePlugins ? result.check.plugins.filter((p) => p.status === 'update' && p.file_url) : [];
      const javaMajor = t === 'custom' ? s.javaMajor : await javaFor(version, t);
      const javaExe = await ctx.services.java.ensure(javaMajor, job, [5, 15]);
      const prepare = async (work) => {
        job.progress(20, `${providers[t].label} ${version} in die Kopie laden …`);
        const tmp = path.join(work, 'server.jar.neu');
        const r = await providers[t].download(version, tmp, job, { paths: ctx.paths, javaExe });
        if (!(r && (r.launch || r.jar))) { fs.rmSync(path.join(work, s.jar || 'server.jar'), { force: true }); fs.renameSync(tmp, path.join(work, 'server.jar')); }
        for (const p of dls) {
          job.log(`Plugin-Update in der Kopie: ${p.name} → ${p.latest}`);
          const dir = path.join(work, this.mc.content(s) === 'mods' ? 'mods' : 'plugins');
          const target = path.join(dir, path.basename(p.filename || p.file).replace(/\.disabled$/i, '') + (p.enabled ? '' : '.disabled'));
          await downloadFile(p.file_url, target + '.neu', { sha1: p.sha1 });
          if (path.join(dir, p.file) !== target) fs.rmSync(path.join(dir, p.file), { force: true });
          fs.renameSync(target + '.neu', target);
        }
        result.launch = r && r.launch ? r.launch : null; result.jar = r && r.jar ? r.jar : null;
      };
      job.progress(30, 'Probelauf auf einer Kopie …');
      const trial = await trialRun(this.mc.dir(id), { ...s, type: t, version, javaMajor, launch: undefined, jar: 'server.jar' }, ctx, job, { keepWorlds, prepare, timeoutMs: 5 * 60000 });
      result.trial = { ok: trial.ok, doneSec: trial.doneSec, crashed: trial.crashed, timeout: trial.timeout, errors: trial.errors.slice(0, 20), failedPlugins: trial.failedPlugins, seconds: trial.seconds, lines: trial.lines.slice(-30) };
      job.log(trial.ok ? `Probelauf bestanden – bereit nach ${trial.doneSec} s.` : `Probelauf gescheitert: ${trial.crashed ? 'Absturz' : trial.timeout ? 'nicht bereit geworden' : 'Plugins laden nicht: ' + trial.failedPlugins.join(', ')}`);
      result.ok = trial.ok && result.check.ok;
      this.remember(id, result);
      if (!apply) return result;
      if (!result.ok) throw new Error('Nicht eingespielt – der Probelauf oder die Plugin-Prüfung ist gescheitert (Details im Ergebnis).');
      if (this.mc.proc(id).isRunning()) { job.progress(70, 'Server stoppen …'); await this.mc.stop(id); }
      job.progress(74, 'Backup vor dem Versionssprung …');
      if (this.mc.ctx && this.mc.ctx.timeMachine) await this.mc.ctx.timeMachine.withData(`Minecraft: ${this.mc.get(id).name} – vor dem Versionssprung`, { mc: [id] }, job);
      else await this.mc.backup(id, 'vor-versionssprung').promise;
      job.progress(84, 'Neue Version einspielen …');
      await this.mc.changeVersion(id, { type: t, version }).promise;
      const dir = this.mc.addonDir(id);
      for (const p of dls) {
        const target = path.join(dir, path.basename(p.filename || p.file).replace(/\.disabled$/i, '') + (p.enabled ? '' : '.disabled'));
        await downloadFile(p.file_url, target + '.neu', { sha1: p.sha1 });
        if (path.join(dir, p.file) !== target) fs.rmSync(path.join(dir, p.file), { force: true });
        fs.renameSync(target + '.neu', target);
        job.log(`✓ ${p.name} → ${p.latest}`);
      }
      result.applied = true;
      this.remember(id, result);
      job.progress(96, 'Server starten …');
      await this.mc.start(id).catch((e) => job.log('Start: ' + e.message));
      return result;
    }, { key: 'mc-safe-upgrade-' + id });
  }

  routes(r) {
    r.get('/mc/servers/:id/safe-upgrade', (req, res) => res.json(this.last.get(req.params.id) || null));
    r.get('/mc/servers/:id/safe-upgrade/history', (req, res) => res.json(this.hist.get(req.params.id) || []));
    r.post('/mc/servers/:id/safe-upgrade/check', async (req, res) => res.json(await this.check(req.params.id, req.body || {})));
    r.post('/mc/servers/:id/safe-upgrade', (req, res) => res.json({ job: this.run(req.params.id, req.body || {}).id }));
  }
}

module.exports = { SafeUpgrade };
