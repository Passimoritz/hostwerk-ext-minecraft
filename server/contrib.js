'use strict';
/*
 * Beiträge zu Hostwerks Bereichen (SDK 3.5, host.contribute): Selbstwartung, Gesundheits-Check, Inhaltssuche und das
 * Livegang-Ziel „Minecraft für Freunde“. Bis Hostwerk 3.1 standen diese Teile im Kern.
 * Texte sind – wie Hostwerks eigene in diesen Bereichen – Deutsch.
 */
const fs = require('fs');
const path = require('path');

const DAY = 86400000;

function contributions(mc) {
  const readProps = (s) => { try { return fs.readFileSync(path.join(mc.dir(s.id), 'server.properties'), 'utf8'); } catch { return ''; } };
  const isProxy = (s) => (typeof mc.isProxy === 'function' ? mc.isProxy(s) : false);
  return {
    // Verbindungen nach außen (Einstellungen → Datenschutz)
    connections: { id: 'minecraft', kind: 'auto', active: () => mc.list().length > 0, hosts: ['api.papermc.io', 'fill.papermc.io', 'api.purpurmc.org', 'api.modrinth.com', 'hangar.papermc.io', 'api.spiget.org', 'piston-meta.mojang.com', 'meta.fabricmc.net'],
      de: { what: 'Minecraft: Server-Versionen, Plugins und Mods', when: 'alle 6 Stunden für angelegte Server (abschaltbar), sonst beim Öffnen des Marktplatzes', data: 'Abfrage von Versionen und Suchbegriffen' },
      en: { what: 'Minecraft: server versions, plugins and mods', when: 'every 6 hours for existing servers (can be turned off), otherwise when opening the marketplace', data: 'Query of versions and search terms' } },
    keeper: {
      checks: [
        { label: 'Plugin-Quellen (GitHub/Spigot/Jenkins)', run: () => mc.sources && mc.sources.checkAll() },
        { label: 'Minecraft-Updates', run: () => mc.updates && mc.updates.checkAll() },
      ],
      areas: [{
        id: 'mc-plugins', label: 'Minecraft-Plugins/Mods', auto: 'teils', url: '#/mc', every: DAY, keys: ['mc-quelle-'],
        text: 'Updates werden gemeldet (Modrinth, Hangar, GitHub, SpigotMC, Jenkins); Einspielen per Klick – ein Versionssprung läuft erst auf einer Kopie.',
        detail: ['Hostwerk vergleicht installierte Plugins und Mods mit Modrinth, Hangar, GitHub, SpigotMC und Jenkins. Updates werden angezeigt; ein Minecraft-Versionssprung wird vorher auf einer Kopie des Servers ausprobiert.', 'Updates mit einem Klick einspielen – automatisch passiert es nicht, weil Plugins Welten verändern können.'],
      }],
    },
    health: {
      run() {
        const out = [];
        for (const s of mc.list()) {
          const u = mc.updates && mc.updates.get(s.id);
          if (u && (u.modpack || u.addons)) out.push({ level: 'info', area: 'Minecraft', text: `${s.name}: ${u.modpack ? `Modpack ${u.modpack.number}` : ''}${u.modpack && u.addons ? ', ' : ''}${u.addons ? `${u.addons} Plugin/Mod-Updates` : ''}.`, fix: { kind: 'link', url: `#/mc/${s.id}/plugins`, label: 'Aktualisieren' } });
        }
        return out;
      },
    },
    search: {
      async run(match, { cached }) {
        const out = [];
        for (const s of mc.list()) {
          // Spieler: online, Whitelist, OPs
          const l = mc.playerLists(s.id);
          const names = new Map();
          for (const n of l.online || []) names.set(n, 'online');
          for (const x of [...(l.whitelist || []), ...(l.ops || [])]) if (x && x.name && !names.has(x.name)) names.set(x.name, 'bekannt');
          for (const [n, st] of names) if (match(n)) out.push({ type: 'player', label: n, hint: `Spieler · ${s.name}${st === 'online' ? ' · online' : ''}`, href: `#/mc/${s.id}/players` });
          // Plugins und Mods
          const list = await cached(`plugins:${s.id}`, () => mc.plugins(s.id));
          for (const p of list || []) if (match(p.name, p.file, p.description)) out.push({ type: 'plugin', label: p.name || p.file, hint: `${mc.content(s) === 'mods' ? 'Mod' : 'Plugin'} · ${s.name}`, href: `#/mc/${s.id}/market` });
        }
        return out.slice(0, 20);
      },
    },
    guide: {
      id: 'minecraft', icon: 'gamepad-2', title: 'Minecraft für Freunde',
      text: 'Freunde über das Internet auf deinen Server lassen – sicher mit Online-Modus und Whitelist.',
      run({ step, routerStep, fwHas, fwTool, lan, ip, isCgnat }) {
        const mcs = mc.list().filter((m) => !isProxy(m) || !m.network);
        const state = (m) => { try { return mc.proc(m.id).state; } catch { return 'stopped'; } };
        const mcRun = mcs.filter((m) => state(m) === 'running');
        const offline = mcs.filter((m) => !isProxy(m) && /online-mode=false/.test(readProps(m)) && !(m.network && m.network.proxy));
        const wl = mcs.filter((m) => /white-list=true/.test(readProps(m)));
        const mcBackups = mcs.filter((m) => { try { const b = mc.backups(m.id); return b.length && Date.now() - (b[0].time || 0) < 7 * DAY; } catch { return false; } });
        const addr = (m) => `${ip}${m.port === 25565 ? '' : ':' + m.port}`;
        return [
          step('server', 'Server läuft', mcRun.length ? 'done' : 'todo', mcs.length ? mcs.map((m) => `${m.name}: ${state(m) === 'running' ? 'läuft' : 'gestoppt'} (Port ${m.port})`).join(' · ') : 'Lege zuerst einen Minecraft-Server an.', { kind: 'link', href: mcs.length === 1 ? `#/mc/${mcs[0].id}` : '#/mc', label: 'Minecraft' }),
          step('address', 'Adresse für deine Freunde', ip ? (isCgnat(ip) ? 'err' : 'done') : 'warn',
            !ip ? 'Öffentliche IP nicht ermittelbar.' : isCgnat(ip) ? `Dein Anschluss hat keine eigene öffentliche IPv4 (Carrier-NAT, ${ip}) – Portfreigaben funktionieren dann nicht. Lösung: beim Anbieter eine öffentliche IPv4 anfragen oder einen Dienst wie playit.gg nutzen.` : mcs.map(addr).join(' · ') || ip,
            ip && mcs[0] ? { kind: 'copy', value: addr(mcs[0]), label: 'Adresse kopieren' } : null),
          routerStep(mcs.map((m) => m.port), 'Router: Minecraft-Port weiterleiten', `Im Router TCP ${[...new Set(mcs.map((m) => m.port))].join(', ') || '25565'} an ${lan[0] || 'diesen PC'} weiterleiten. Im eigenen WLAN verbinden sich Freunde über ${lan[0] || 'die PC-Adresse'}${mcs[0] && mcs[0].port !== 25565 ? ':' + mcs[0].port : ''}.`),
          step('firewall', 'Firewall-Freigabe', !fwTool ? 'done' : mcs.length && mcs.every((m) => fwHas(m.port)) ? 'done' : 'todo', !fwTool ? 'Keine Firewall aktiv.' : 'Ein Klick legt die Regeln für alle Minecraft-Ports an.', { kind: 'tab', tab: 'firewall', label: 'Firewall' }),
          step('online', 'Nur echte Accounts (Online-Modus) oder Whitelist', offline.length ? 'err' : 'done', offline.length ? `${offline.map((m) => m.name).join(', ')}: Online-Modus ist aus – dann kann sich jeder als beliebiger Spieler (auch als du/OP) ausgeben.` : `Online-Modus an${wl.length ? `, Whitelist bei ${wl.map((m) => m.name).join(', ')}` : ' – für einen privaten Server zusätzlich die Whitelist einschalten'}.`, offline[0] ? { kind: 'link', href: `#/mc/${offline[0].id}/settings`, label: 'Einstellungen' } : null),
          step('backup', 'Regelmäßige Sicherung', mcs.length && mcBackups.length === mcs.length ? 'done' : 'optional', mcs.length ? `${mcBackups.length} von ${mcs.length} Server(n) in den letzten 7 Tagen gesichert.` : '', mcs[0] ? { kind: 'link', href: `#/mc/${mcs[0].id}/automation`, label: 'Zeitplan' } : null),
        ];
      },
    },
  };
}

/** Sicherung prüfen (Wiederherstellungs-Probe): entpackt liegt sie in tmp; start = Kopie testweise starten */
function probeBackup(mc, ctx) {
  return async (id, file, { job, tmp, start }) => {
    const s = mc.get(id);
    const has = (f) => fs.existsSync(path.join(tmp, f));
    const details = []; const problems = [];
    if (has('server.properties')) details.push('server.properties vorhanden'); else problems.push('server.properties fehlt');
    const jar = s.jar || 'server.jar';
    if (has(jar) || (s.launch && s.launch.argsFile && has(s.launch.argsFile))) details.push('Server-Programm vorhanden'); else problems.push(`${jar} fehlt`);
    const worlds = fs.readdirSync(tmp).filter((f) => /^world/.test(f) && fs.existsSync(path.join(tmp, f, 'level.dat')));
    if (worlds.length) details.push(`Welten: ${worlds.join(', ')}`); else if (!mc.isProxy || !mc.isProxy(s)) problems.push('keine Welt mit level.dat');
    try { const n = fs.readdirSync(path.join(tmp, mc.content(s) === 'mods' ? 'mods' : 'plugins')).filter((f) => /\.jar$/i.test(f)).length; details.push(`${n} ${mc.content(s) === 'mods' ? 'Mods' : 'Plugins'}`); } catch { /* keine */ }
    if (problems.length) return { ok: false, error: problems.join(', '), details };
    if (!start) return { ok: true, summary: details.join(' · '), details, started: false };
    job.progress(40, 'Kopie starten …');
    const r = await mc.helpers.trialRun(tmp, s, ctx, job, { copy: false, timeoutMs: 4 * 60000 });
    if (!r.ok) return { ok: false, error: r.crashed ? 'Kopie stürzt beim Start ab' : r.timeout ? 'Kopie wird nicht bereit (4 Minuten)' : `Plugins laden nicht: ${r.failedPlugins.join(', ')}`, details: [...details, ...r.errors.slice(0, 5)], started: true };
    return { ok: true, summary: `${details.join(' · ')} · Kopie bereit nach ${r.doneSec} s`, details, started: true };
  };
}

module.exports = { contributions, probeBackup };
