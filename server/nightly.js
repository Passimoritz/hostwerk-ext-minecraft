'use strict';
/*
 * Nächtliche Sicherung der Minecraft-Server (Sicherheitsnetz ab Werk, seit Hostwerk 2.13, bis 3.1 im Kern): neue Server bekommen
 * nightlyBackup = { enabled, everyHours: 24, keep: 7, hour: 3 } – beim Anlegen abwählbar, je Server umschaltbar.
 * Gleicher Zeitplan wie bei Hostwerks Datenbanken (host.core('nightly').dueNightly): zur Wunsch-Stunde, verpasste Nächte werden nachgeholt.
 * Ein gestoppter Server wird nur gesichert, wenn sich seit der letzten Sicherung etwas geändert hat. Aufbewahrung:
 * die neuesten „keep“ automatischen Sicherungen (…-auto.zip); eigene Sicherungen bleiben, bis du sie löschst.
 */
const fs = require('fs');
const path = require('path');
const { dueNightly, newestMtime } = require('./hw').core('nightly');

class NightlyBackups {
  constructor(ctx, mc) {
    this.ctx = ctx;
    this.mcRef = mc || null;
    this.busy = new Set();
    if (!process.env.HW_TEST) {
      const t1 = setTimeout(() => this.tick().catch(() => {}), 3 * 60000);
      const t2 = setInterval(() => this.tick().catch(() => {}), 5 * 60000);
      for (const t of [t1, t2]) if (t.unref) t.unref();
      this.timers = [t1, t2];
    }
  }
  /** Beim Ausschalten/Update der Erweiterung: Zeitplan anhalten */
  dispose() { for (const t of this.timers || []) { clearTimeout(t); clearInterval(t); } this.timers = []; }
  get mc() { return this.mcRef || this.ctx.minecraft; }
  cfg(s) { return s.nightlyBackup || null; }

  /** Fällige Server (gestellte Uhr in den Tests). */
  dueList(now = Date.now()) {
    const out = [];
    for (const s of this.mc.list()) {
      const c = this.cfg(s);
      if (!dueNightly(c, now) || this.busy.has(s.id)) continue;
      const running = (() => { try { return this.mc.proc(s.id).isRunning(); } catch { return false; } })();
      // Gestoppt und seit der letzten Sicherung unverändert: nichts zu tun (die letzte Sicherung ist noch aktuell)
      if (!running && c.lastRun && newestMtime(this.mc.dir(s.id)) <= c.lastRun) continue;
      out.push(s);
    }
    return out;
  }

  async tick(now = Date.now()) {
    const done = [];
    for (const s of this.dueList(now)) {
      this.busy.add(s.id);
      const c = this.cfg(s);
      try {
        await this.mc.backup(s.id, 'auto').promise;
        c.lastRun = Date.now(); c.lastError = null;
        this.prune(s.id, c.keep);
        done.push({ id: s.id, ok: true });
      } catch (e) {
        c.lastRun = Date.now(); c.lastError = e.message;
        require('./hw').core('events').broadcast({ type: 'toast', kind: 'error', text: `Nächtliches Backup von „${s.name}“ fehlgeschlagen: ${e.message}` });
        done.push({ id: s.id, ok: false, error: e.message });
      } finally { this.busy.delete(s.id); this.ctx.settings.save(); }
    }
    return done;
  }

  /** Nur automatische Sicherungen aufräumen – die neuesten „keep“ bleiben. */
  prune(id, keep = 7) {
    const dir = this.mc.backupDir(id);
    let list = [];
    try { list = fs.readdirSync(dir).filter((f) => /-auto\.zip$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t); } catch { return 0; }
    const old = list.slice(Math.max(1, Number(keep) || 7));
    for (const x of old) fs.rmSync(path.join(dir, x.f), { force: true });
    return old.length;
  }

  routes(r) {
    const view = (s) => ({ config: this.cfg(s) || { enabled: false, everyHours: 24, keep: 7, hour: 3 } });
    r.get('/mc/servers/:id/nightly-backup', (req, res) => res.json(view(this.mc.get(req.params.id))));
    r.put('/mc/servers/:id/nightly-backup', (req, res) => {
      const s = this.mc.get(req.params.id);
      const b = req.body || {};
      const c = s.nightlyBackup || (s.nightlyBackup = { enabled: false, everyHours: 24, keep: 7, hour: 3 });
      if (typeof b.enabled === 'boolean') { c.enabled = b.enabled; if (b.enabled && !c.lastRun && !c.since) c.since = Date.now(); }
      if (Number(b.keep) > 0) c.keep = Math.min(90, Math.round(Number(b.keep)));
      if (Number.isInteger(Number(b.hour)) && Number(b.hour) >= 0 && Number(b.hour) <= 23 && b.hour !== null && b.hour !== '') c.hour = Number(b.hour);
      this.ctx.settings.save();
      res.json(view(s));
    });
  }
}

module.exports = { NightlyBackups };
