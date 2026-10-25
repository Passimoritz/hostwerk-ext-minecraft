'use strict';
/*
 * Kopieren von Minecraft-Servern (SDK 3.5, kind.copy): Umzug auf einen anderen Rechner, Spiegel, Klonen und „beim
 * Entfernen behalten“. Hostwerk macht Ablauf, Pakete, Dateilisten und Abgleich – hier steht, was Minecraft braucht:
 * welcher Ordner, was nie mit soll, wie ein neuer Eintrag aussieht, Port in server.properties, Probelauf.
 * Dateinamen und Felder sind dieselben wie bis Hostwerk 3.1 (server.zip, meta.mc, Ordner minecraft/<id>), damit ältere
 * Umzugspakete und Behalten-Ordner weiter funktionieren.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hw = require('./hw');
const T = (text, vars) => hw.t(text, vars);

const SKIP = ['logs', 'crash-reports', 'cache', '.hostwerk-tmp', 'session.lock', 'debug'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function minecraftCopy(mc) {
  const { findFreePort, isPortFree } = hw.core('ports');
  const { slug } = hw.core('util');
  const freeId = (name) => {
    let id = slug(name) || 'server';
    while (mc.list().some((s) => s.id === id) || fs.existsSync(mc.paths.mcDir(id))) id = `${slug(name) || 'server'}-${crypto.randomBytes(2).toString('hex')}`;
    return id;
  };
  /** Port des Eintrags in server.properties eintragen (Datei kommt vom anderen Rechner bzw. aus der Kopie) */
  const writePort = (id, port) => {
    const f = path.join(mc.dir(id), 'server.properties');
    if (!fs.existsSync(f)) return;
    const t = fs.readFileSync(f, 'utf8');
    const n = t.replace(/^server-port=.*$/m, `server-port=${port}`).replace(/^query\.port=.*$/m, `query.port=${port}`);
    if (n !== t) fs.writeFileSync(f, n);
  };
  const holds = new Map();

  return {
    folder: 'minecraft',
    moveNote: { de: 'Der Server wird kurz gestoppt, damit die Welt sauber gespeichert ist, und läuft danach hier weiter. Am Ziel bekommt er einen freien Port.', en: 'The server is stopped briefly so the world is saved cleanly, and keeps running here afterwards. On the target it gets a free port.' },
    zip: 'server.zip',
    skip: SKIP,
    stopForExport: true,
    dir: (id) => mc.dir(id),
    dirFor: (id) => mc.paths.mcDir(id),
    external: (entry) => !!(entry && entry.externalDir),
    isRunning: (id) => { try { return mc.proc(id).isRunning(); } catch { return false; } },
    /** Passendes Java gleich mitnehmen (kein erneuter Download) */
    extras: (entry) => (entry && entry.javaMajor ? [{ rel: path.join('bin', 'java', String(entry.javaMajor)), abs: mc.paths.binDir('java', entry.javaMajor) }] : []),
    /** Einstellungen ohne ID, Port und Autostart */
    entry(id) {
      const { id: _i, port, autostart: _a, ...entry } = mc.get(id); // eslint-disable-line no-unused-vars
      return { entry, port };
    },
    /** Fertigen Eintrag übernehmen (Behalten → neues Hostwerk) */
    add(entry) {
      mc.list().push(entry);
      mc.settings.save();
      mc.proc(entry.id);
      return entry;
    },
    /**
     * Ziel anlegen oder nachziehen: id gesetzt und vorhanden → Einstellungen übernehmen (Port, Autostart bleiben);
     * sonst neuer Eintrag ohne Autostart, Port möglichst wie gewünscht. tag landet im Eintrag (mirrorOf/movedFrom …).
     */
    async place({ id, name, entry = {}, port, tag = {} }) {
      const { geyser: _g, ...rest } = entry; // eslint-disable-line no-unused-vars — Bedrock-Port wird bei Bedarf neu vergeben
      if (id && mc.list().some((s) => s.id === id)) {
        if (mc.proc(id).isRunning()) throw Object.assign(new Error(T('“{name}” is running – please stop it first.', { name: mc.get(id).name })), { status: 409 });
        const e = mc.get(id);
        Object.assign(e, rest, { id: e.id, port: e.port, autostart: false }, tag);
        mc.settings.save();
        return { id, dir: mc.dir(id), port: e.port, created: false };
      }
      const nid = freeId(rest.name || name);
      const want = Number(port) || 25565;
      const used = mc.list().map((s) => s.port);
      const p = !used.includes(want) && (await isPortFree(want)) ? want : await findFreePort(25565, used);
      mc.list().push({ ...rest, id: nid, port: p, autostart: false, ...tag });
      mc.settings.save();
      mc.proc(nid);
      fs.mkdirSync(mc.dir(nid), { recursive: true });
      return { id: nid, dir: mc.dir(nid), port: p, created: true, warn: p !== want ? T('Port {want} is in use here – using {port}. Remember the port forwarding when switching.', { want, port: p }) : null };
    },
    afterFiles: (id) => { try { writePort(id, mc.get(id).port); } catch { /* egal */ } },
    /** Vor dem ersten Start: passendes Java laden */
    async prepare(id, job, range = [55, 70]) {
      const e = mc.get(id);
      const java = mc.ctx.services && mc.ctx.services.java;
      if (java && e.javaMajor) { job.progress(range[0], T('Checking Java {v} …', { v: e.javaMajor })); await java.ensure(e.javaMajor, job, range); }
    },
    /** Probelauf: starten, bis „bereit“ (höchstens 4 Minuten), wieder stoppen → true/false */
    async probe(id) {
      await mc.start(id);
      const p = mc.proc(id);
      for (let i = 0; i < 480 && !p.extra.ready && p.isRunning(); i++) await sleep(500);
      const ok = !!p.extra.ready;
      await mc.stop(id).catch(() => {});
      return ok;
    },
    /** Spiegel: Schreiben beim Lesen anhalten („save-off“ + „save-all flush“), nach spätestens 10 Min. wieder „save-on“ */
    async hold(id, on) {
      let p; try { p = mc.proc(id); } catch { return; }
      if (!p || !p.child) return;
      clearTimeout(holds.get(id));
      if (on) {
        if (!holds.has(id)) { p.write('save-off'); p.write('save-all flush'); await sleep(3000); }
        const t = setTimeout(() => this.hold(id, false), 600000); if (t.unref) t.unref();
        holds.set(id, t);
      } else { holds.delete(id); p.write('save-on'); }
    },
    /** Klonen: Ordner ohne Sicherungen/Protokolle (ohne Daten = ohne Welten), neuer Port, neuer RCON-Port */
    async clone(id, { name, withData }, job) {
      const src = mc.get(id);
      if (withData && mc.proc(id).isRunning()) throw Object.assign(new Error(T('Please stop the server first to copy the world.')), { status: 409, svc: { base: `/mc/servers/${id}`, action: 'stop' } });
      const { copyDir, parseProps, writeProps } = mc.helpers;
      const nm = name || T('{name} (copy)', { name: src.name });
      const port = await findFreePort(25565, mc.list().map((s) => s.port));
      const nid = freeId(nm);
      const to = mc.paths.mcDir(nid);
      job.progress(15, withData ? T('Copying server with world …') : T('Copying server without world …'));
      copyDir(mc.dir(id), to, { skipWorlds: !withData });
      const props = path.join(to, 'server.properties');
      if (fs.existsSync(props)) {
        const text = fs.readFileSync(props, 'utf8');
        const p = parseProps(text);
        const vals = { 'server-port': String(port) };
        if (p['query.port']) vals['query.port'] = String(port);
        if (p['rcon.port']) vals['rcon.port'] = String(await findFreePort(25575, [Number(p['rcon.port'])]));
        fs.writeFileSync(props, writeProps(text, vals));
      }
      const copy = JSON.parse(JSON.stringify(src));
      delete copy.externalDir; delete copy.autostart;
      mc.list().push({ ...copy, id: nid, name: nm, port, autostart: false, createdAt: Date.now(), clonedFrom: src.id });
      mc.settings.save();
      mc.proc(nid);
      job.log(withData ? T('New Minecraft server “{name}” on port {port} with world.', { name: nm, port }) : T('New Minecraft server “{name}” on port {port} without world (created on first start).', { name: nm, port }));
      return { id: nid, href: `#/mc/${nid}` };
    },
  };
}

module.exports = { minecraftCopy, SKIP };
