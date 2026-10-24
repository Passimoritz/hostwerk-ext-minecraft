'use strict';
/*
 * Spieler-Statistiken je Minecraft-Server:
 *   Sitzungen (Hostwerk zeichnet auf):  erstes/letztes Mal online, Anzahl Besuche, gesamte Online-Zeit, Spitzen je Tag
 *     → data/mc-stats/<server>.json
 *   Welt-Statistik (schreibt Minecraft selbst): <welt>/stats/<uuid>.json + usercache.json (Name zur UUID)
 *     → Spielzeit, Tode, Kills, abgebaute Blöcke, Laufstrecke, Sprünge
 */
const fs = require('fs');
const path = require('path');
const { writeFileSafe } = require('./hw').core('safewrite');

const DAY = 86400000;
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
/** Kalenderwoche nach ISO (Montag–Sonntag, Ortszeit): „2026-W43“. */
function weekKey(t = Date.now()) {
  const d = new Date(t); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Donnerstag derselben Woche bestimmt das Jahr
  const y = d.getFullYear();
  const jan4 = new Date(y, 0, 4, 12);
  jan4.setDate(jan4.getDate() + 3 - ((jan4.getDay() + 6) % 7));
  return `${y}-W${String(1 + Math.round((d - jan4) / (7 * DAY))).padStart(2, '0')}`;
}
/** Stunde der Woche (0 = Montag 0 Uhr … 167 = Sonntag 23 Uhr, Ortszeit). */
const hourOfWeek = (t) => { const d = new Date(t); return ((d.getDay() + 6) % 7) * 24 + d.getHours(); };

class PlayerStats {
  constructor(mc) { this.mc = mc; this.data = new Map(); this.timers = new Map(); }
  file(id) { return path.join(this.mc.paths.data, 'mc-stats', `${id}.json`); }
  load(id) {
    if (!this.data.has(id)) {
      let d = { players: {}, daily: {}, weeks: {}, hours: null, hoursSince: null };
      try { d = { ...d, ...JSON.parse(fs.readFileSync(this.file(id), 'utf8')) }; } catch { /* neu */ }
      this.data.set(id, d);
    }
    return this.data.get(id);
  }
  save(id) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => { try { writeFileSafe(this.file(id), JSON.stringify(this.load(id))); } catch { /* egal */ } }, 1000));
  }
  flush(id) { clearTimeout(this.timers.get(id)); try { writeFileSafe(this.file(id), JSON.stringify(this.load(id))); } catch { /* egal */ } }

  join(id, name, now = Date.now()) {
    const d = this.load(id);
    const p = d.players[name] || (d.players[name] = { first: now, last: now, sessions: 0, total: 0, online: null });
    if (p.online) return;
    p.online = now; p.last = now; p.sessions++;
    const k = dayKey(now);
    const day = d.daily[k] || (d.daily[k] = { peak: 0, unique: [] });
    if (!day.unique.includes(name)) day.unique.push(name);
    const online = Object.values(d.players).filter((x) => x.online).length;
    day.peak = Math.max(day.peak, online);
    // Nur die letzten 90 Tage behalten
    for (const key of Object.keys(d.daily)) if (Date.parse(key) < now - 90 * DAY) delete d.daily[key];
    this.save(id);
  }
  leave(id, name, now = Date.now()) {
    const d = this.load(id);
    const p = d.players[name];
    if (!p || !p.online) return;
    const start = p.online;
    const ms = Math.max(0, now - start);
    p.total += ms;
    p.last = now;
    p.online = null;
    this.activity(d, name, start, now);
    this.save(id);
    return ms;
  }
  /**
   * Spieler-Aktivität: Spielzeit je Spieler und Kalenderwoche (12 Wochen) und Spieler-Minuten je Stunde der Woche
   * (für „Stoßzeiten“). Eine Sitzung über Mitternacht oder das Wochenende wird sauber auf die Stunden verteilt.
   */
  activity(d, name, start, end) {
    if (!d.weeks) d.weeks = {};
    if (!Array.isArray(d.hours) || d.hours.length !== 168) { d.hours = new Array(168).fill(0); d.hoursSince = start; }
    for (let t = start; t < end;) {
      const h = new Date(t); h.setMinutes(60, 0, 0); // Beginn der nächsten vollen Stunde
      const stop = Math.min(end, h.getTime());
      const ms = stop - t;
      d.hours[hourOfWeek(t)] += ms / 60000;
      const wk = weekKey(t);
      const w = d.weeks[wk] || (d.weeks[wk] = {});
      w[name] = (w[name] || 0) + ms;
      t = stop;
    }
    const keys = Object.keys(d.weeks).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete d.weeks[k];
  }
  /** Server gestoppt/abgestürzt: alle offenen Sitzungen beenden. */
  closeAll(id, now = Date.now()) {
    const d = this.load(id);
    for (const name of Object.keys(d.players)) if (d.players[name].online) this.leave(id, name, now);
    this.flush(id);
  }

  /** Statistik aus den Welt-Dateien (vom Spiel selbst geschrieben). */
  world(id) {
    const dir = this.mc.dir(id);
    let level = 'world';
    try { const m = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8').match(/^level-name=(.*)$/m); if (m && m[1].trim()) level = m[1].trim(); } catch { /* Standard */ }
    const names = {};
    try { for (const u of JSON.parse(fs.readFileSync(path.join(dir, 'usercache.json'), 'utf8'))) names[u.uuid] = u.name; } catch { /* fehlt */ }
    const sdir = path.join(dir, level, 'stats');
    const out = {};
    let files = [];
    try { files = fs.readdirSync(sdir).filter((f) => f.endsWith('.json')); } catch { return out; }
    for (const f of files) {
      const uuid = f.replace(/\.json$/, '');
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(sdir, f), 'utf8')); } catch { continue; }
      const st = j.stats || {};
      const c = st['minecraft:custom'] || {};
      const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (Number(b) || 0), 0);
      const cm = ['walk_one_cm', 'sprint_one_cm', 'swim_one_cm', 'fly_one_cm', 'boat_one_cm', 'horse_one_cm', 'minecart_one_cm', 'walk_on_water_one_cm', 'walk_under_water_one_cm', 'crouch_one_cm', 'climb_one_cm', 'aviate_one_cm'].reduce((a, k) => a + (Number(c[`minecraft:${k}`]) || 0), 0);
      out[names[uuid] || uuid.slice(0, 8)] = {
        uuid,
        playTicks: Number(c['minecraft:play_time'] || c['minecraft:play_one_minute']) || 0,
        deaths: Number(c['minecraft:deaths']) || 0,
        mobKills: Number(c['minecraft:mob_kills']) || 0,
        playerKills: Number(c['minecraft:player_kills']) || 0,
        jumps: Number(c['minecraft:jump']) || 0,
        mined: sum(st['minecraft:mined']),
        crafted: sum(st['minecraft:crafted']),
        distanceKm: Math.round(cm / 100000 * 10) / 10,
      };
    }
    return out;
  }

  report(id, now = Date.now()) {
    const d = this.load(id);
    const w = this.world(id);
    const names = new Set([...Object.keys(d.players), ...Object.keys(w)]);
    const players = [...names].map((name) => {
      const p = d.players[name] || {};
      const live = p.online ? now - p.online : 0;
      return {
        name, online: !!p.online, first: p.first || null, last: p.online ? now : p.last || null, sessions: p.sessions || 0,
        totalMs: (p.total || 0) + live, world: w[name] || null,
      };
    });
    // Spielzeit: Welt-Statistik (Ticks, 20/s) ist genauer und reicht weiter zurück – sonst Hostwerks Sitzungen
    for (const p of players) p.playMs = p.world && p.world.playTicks ? Math.round(p.world.playTicks / 20 * 1000) : p.totalMs;
    players.sort((a, b) => b.playMs - a.playMs);
    const days = [];
    for (let i = 13; i >= 0; i--) { const k = dayKey(now - i * DAY); const x = d.daily[k]; days.push({ date: k, peak: x ? x.peak : 0, unique: x ? x.unique.length : 0 }); }
    const sum = (f) => players.reduce((a, p) => a + (f(p) || 0), 0);
    // Aktivität: die letzten 8 Wochen (laufende Sitzungen mitgezählt) und durchschnittliche Spieler je Stunde der Woche
    const live = { weeks: JSON.parse(JSON.stringify(d.weeks || {})), hours: Array.isArray(d.hours) && d.hours.length === 168 ? [...d.hours] : null, hoursSince: d.hoursSince };
    for (const [name, p] of Object.entries(d.players)) if (p.online) this.activity(live, name, p.online, now);
    const hours = live.hours || new Array(168).fill(0);
    const span = Math.max(1, (now - (live.hoursSince || now)) / (7 * DAY));
    const avg = hours.map((m) => Math.round((m / 60 / span) * 100) / 100);
    const best = avg.reduce((b, v, i) => (v > avg[b] ? i : b), 0);
    const wk = [];
    for (let i = 7; i >= 0; i--) { const k = weekKey(now - i * 7 * DAY); const w = live.weeks[k] || {}; wk.push({ week: k, total: Object.values(w).reduce((a, b) => a + b, 0), players: w }); }
    const activity = { weeks: wk, hours: avg, since: live.hoursSince || null, peak: avg[best] > 0 ? { day: Math.floor(best / 24), hour: best % 24, players: avg[best] } : null };
    return {
      players, days, activity,
      totals: { players: players.length, playMs: sum((p) => p.playMs), sessions: sum((p) => p.sessions), deaths: sum((p) => p.world && p.world.deaths), mined: sum((p) => p.world && p.world.mined), activeWeek: players.filter((p) => p.last && now - p.last < 7 * DAY).length },
    };
  }

  routes(r) {
    r.get('/mc/servers/:id/stats', (req, res) => { this.mc.get(req.params.id); res.json(this.report(req.params.id)); });
  }
}

module.exports = { PlayerStats, weekKey, hourOfWeek };
