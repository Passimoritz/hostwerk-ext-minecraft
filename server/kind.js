'use strict';
/*
 * Dienst-Art „mc“ (SDK 3.5): darüber behandelt Hostwerk Minecraft-Server überall wie eingebaute Dienste – Übersicht,
 * Seitenleiste, Zeitplan, Sicherungen, Umzug, Spiegel, Zeitmaschine, Firewall/Router, Überwachung, KI. Hostwerk selbst
 * kennt Minecraft nicht mehr; alles Minecraft-Spezifische steht hier bzw. im Manager.
 */
const T = (text, vars) => require('./hw').t(text, vars);

/** Ports eines Servers: Java (TCP), Bedrock/NetherNet (UDP/TCP), Geyser. public: false = nie von außen (hinter Proxy). */
function ports(mc, s) {
  const out = [];
  const add = (port, label, proto = 'TCP', pub = true) => { if (port && !out.some((x) => x.port === port && x.proto === proto)) out.push({ port, label, proto, public: pub }); };
  if (mc.isBedrock(s)) {
    add(s.port, T('Minecraft Bedrock: {name}', { name: s.name }), 'UDP');
    if (s.portv6) add(s.portv6, T('Minecraft Bedrock (IPv6): {name}', { name: s.name }), 'UDP');
    // NetherNet (Standard ab BDS 1.26.5x): Anmeldung über TCP auf server-port, dazu die festgelegten server-udp-ports
    const nn = s.bdsNet || {};
    if (nn.transport !== 'raknet') { add(s.port, T('Minecraft Bedrock (NetherNet): {name}', { name: s.name }), 'TCP'); for (const u of nn.udp || []) add(u, T('Minecraft Bedrock (NetherNet): {name}', { name: s.name }), 'UDP'); }
    return out;
  }
  // Server hinter einem Proxy lauschen nur auf 127.0.0.1 und prüfen keine Konten (online-mode=false) – nie von außen
  add(s.port, T('Minecraft: {name}', { name: s.name }), 'TCP', !(s.network && s.network.proxy));
  // Bedrock-Spieler über Geyser: eigener UDP-Port (RakNet), für NetherNet TCP auf demselben Port und ein UDP-Port (WebRTC)
  if (s.geyser && s.geyser.port) {
    add(s.geyser.port, T('Minecraft Bedrock: {name}', { name: s.name }), 'UDP');
    if (!(s.geyser.nethernet && s.geyser.nethernet.transport === 'raknet')) {
      add(s.geyser.port, T('Minecraft Bedrock (NetherNet): {name}', { name: s.name }), 'TCP');
      if (s.geyser.webrtcPort) add(s.geyser.webrtcPort, T('Minecraft Bedrock (NetherNet): {name}', { name: s.name }), 'UDP');
    }
  }
  return out;
}

function minecraftKind(mc) {
  const players = (id) => { try { return ((mc.proc(id).extra || {}).players || []).length; } catch { return 0; } };
  return {
    kind: 'mc',
    label: { de: 'Minecraft-Server', en: 'Minecraft servers' },
    one: { de: 'Minecraft-Server', en: 'Minecraft server' },
    icon: 'box', color: '#23964a', route: '/mc', api: '/mc/servers',
    list: () => mc.list(),
    get: (id) => mc.get(id),
    dir: (id) => mc.dir(id),
    proc: (id) => mc.proc(id),
    info: (s) => mc.info(s),
    start: (id) => mc.start(id),
    stop: (id) => mc.stop(id),
    restart: (id) => mc.restart(id),
    detail: (s) => `${s.type} ${s.version || ''} · Port ${s.port}`.replace(/\s+/g, ' '),
    stats: () => ({ players: mc.list().reduce((n, s) => n + players(s.id), 0) }),
    /** Übersicht: Kennzahl „Spieler online“ (nur wenn es Server gibt) */
    headline: () => {
      const list = mc.list();
      if (!list.length) return null;
      const n = list.reduce((m, s) => m + players(s.id), 0);
      return { icon: 'users', value: n, label: { de: 'Spieler online', en: 'Players online' }, sub: list.length === 1 ? { de: 'auf 1 Minecraft-Server', en: 'on 1 Minecraft server' } : { de: `auf ${list.length} Minecraft-Servern`, en: `on ${list.length} Minecraft servers` } };
    },
    /** Kontextmenü eines Servers (Übersicht, Suche) */
    actions: (s) => [
      { label: { de: 'Konsole öffnen', en: 'Open console' }, href: `#/mc/${s.id}/console` },
      (mc.info(s) || {}).pluginsSupported && { label: { de: 'Plugins & Marktplatz', en: 'Plugins & marketplace' }, href: `#/mc/${s.id}/market` },
      { label: { de: 'Adresse kopieren', en: 'Copy address' }, copy: `localhost:${s.port}` },
    ].filter(Boolean),
    /** Löschen über DELETE <api>/<id>: Bestätigung mit Namen, Text für den Dialog */
    remove: { text: { de: 'Welt, Plugins/Mods und Einstellungen werden gelöscht. Backups bleiben im Backup-Ordner.', en: 'World, plugins/mods and settings are deleted. Backups stay in the backup folder.' }, stopFirst: true },
    newHref: '#/mc',
    /** Programme, die ein Server braucht (Inventur: was darf weg?) */
    uses: (s) => (s.javaMajor ? [`java@${s.javaMajor}`] : []),
    /** Schnellsuche: „mc say Hallo“ schickt den Befehl an einen laufenden Server */
    console: { words: ['mc', 'minecraft'], path: 'command' },
    /** Ältere Erweiterungen kennen Minecraft-Server als SDK-Art „minecraft“ (Ereignis „minecraft“ bei Spielerwechsel) */
    // overviewKey: /overview hat die Server weiter unter „minecraft“ (öffentliche Schnittstelle bis Hostwerk 3.1)
    sdk: { kind: 'minecraft', base: '/mc/servers', playersEvent: 'minecraft', overviewKey: 'minecraft' },
    /** Serverbilder sind Pixelbilder (64×64) – nicht ans Farbschema anpassen */
    rawIcons: true,
    /** Bild eines Servers: server-icon.png im Serverordner, sonst das Logo der Server-Software (Favicon ihrer Seite) */
    iconSources: (id) => {
      const s = mc.get(id); const out = [];
      out.push({ file: require('path').join(mc.dir(id), 'server-icon.png') });
      const PAGE = { paper: 'https://papermc.io', folia: 'https://papermc.io', velocity: 'https://papermc.io', purpur: 'https://purpurmc.org', vanilla: 'https://www.minecraft.net', fabric: 'https://fabricmc.net', quilt: 'https://quiltmc.org', forge: 'https://files.minecraftforge.net', neoforge: 'https://neoforged.net', modpack: 'https://modrinth.com', custom: 'https://www.minecraft.net' };
      if (s && s.type === 'spigot') out.push({ url: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/spigotmc.svg', color: '#ED8106' });
      else if (s && PAGE[s.type]) out.push({ url: PAGE[s.type] });
      return out;
    },
    /** Ohne eigenes Bild immer das aktuelle server-icon.png (lässt sich auf der Minecraft-Seite ändern) */
    liveIcon: (id) => require('path').join(mc.dir(id), 'server-icon.png'),
    /** Docker-Compose-Export (System → Export): Server als itzg/minecraft-server, Ordner aus .env */
    compose: (m, { envName, env, path: fwd, name }) => {
      const E = envName('dir');
      env(`${E}=${fwd(mc.dir(m.id))}`);
      const TYPE = { paper: 'PAPER', purpur: 'PURPUR', spigot: 'SPIGOT', vanilla: 'VANILLA', fabric: 'FABRIC', forge: 'FORGE' }[m.type] || 'PAPER';
      const dirVar = '${' + E + '}';
      return { name: `mc-${name(m.id)}`, service: { image: 'itzg/minecraft-server:latest', restart: 'unless-stopped', tty: true, stdin_open: true, ports: [`${m.port}:25565`], environment: { EULA: 'TRUE', TYPE, VERSION: m.version, MEMORY: `${Math.round((m.memMax || 2048) / 1024)}G` }, volumes: [`${dirVar}:/data`] } };
    },
    /** Projektvorlage „Paper-Plugin“ (templates/projects): neueste Paper-API ermitteln */
    projectResolve: {
      async paperApi() {
        const { fetchText, cmpVersion } = require('./hw').core('download');
        const xml = await fetchText('https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/maven-metadata.xml');
        const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
        // Nur stabile Builds (neues Schema „26.3.build.181-stable“, altes „1.21.4-R0.1-SNAPSHOT“)
        const stable = all.filter((v) => /^\d+\.\d+(\.\d+)?\.build\.\d+-stable$/.test(v)).sort((a, b) => cmpVersion(a.replace('-stable', ''), b.replace('-stable', '')));
        const v = stable.pop() || all.filter((v2) => /-R0\.1-SNAPSHOT$/.test(v2)).pop() || '1.21.4-R0.1-SNAPSHOT';
        const ver = v.replace(/\.build\..*$/, '').replace(/-R0\.1-SNAPSHOT$/, '');
        // Ab Minecraft 26 braucht die Paper-API Java 25, davor Java 21
        return { PAPER_API: v, MC_VERSION: ver, JAVA_RELEASE: Number(ver.split('.')[0]) >= 26 ? 25 : 21, API_VERSION: ver.split('.').slice(0, 2).join('.') };
      },
    },
    /** Neues Plugin-Projekt mit dem gewählten Server verbinden: Live-Update, Bau-Skript, Ordnerüberwachung */
    projectLink(id, folder) {
      const live = mc.live;
      const cfg = live.cfg(id);
      cfg.enabled = true;
      if (!cfg.watch.includes(folder)) cfg.watch.push(folder);
      mc.settings.save();
      live.ensureBridge(id);
      live.applyWatch(id);
      const sc = live.installScript(id, folder);
      return { note: T('Connected to “{name}”: every newly built version is installed automatically. Build: {howto}', { name: mc.get(id).name, howto: sc.howto }) };
    },
    /** Aufgaben → Vorlagen (Ziel: erster Server); group "backup" steht bei den Sicherungen */
    templates: [
      { id: 'backup', group: 'backup', title: { de: 'Minecraft-Sicherung alle 6 Stunden', en: 'Minecraft backup every 6 hours' }, text: { de: 'Welten regelmäßig sichern.', en: 'Back up worlds regularly.' }, preset: { name: { de: 'Minecraft-Sicherung', en: 'Minecraft backup' }, action: { type: 'mc-backup' }, schedule: { mode: 'every', minutes: 360 } } },
      { id: 'restart', title: { de: 'Minecraft-Neustart um 4 Uhr', en: 'Minecraft restart at 4 am' }, text: { de: 'Mit Vorwarnung an die Spieler – gegen Lags nach langer Laufzeit.', en: 'With a warning to players – against lag after long uptimes.' }, preset: { name: { de: 'Täglicher Minecraft-Neustart', en: 'Daily Minecraft restart' }, action: { type: 'mc-restart', warnSeconds: 300 }, schedule: { mode: 'daily', time: '04:00', days: [] } } },
      { id: 'save', title: { de: 'Minecraft: alle 15 Min. speichern', en: 'Minecraft: save every 15 min' }, text: { de: 'save-all – gegen Datenverlust bei einem Absturz.', en: 'save-all – against data loss in a crash.' }, preset: { name: { de: 'Minecraft speichern', en: 'Save Minecraft' }, action: { type: 'mc-command', command: 'save-all' }, schedule: { mode: 'every', minutes: 15 }, options: { notify: 'never' } } },
      { id: 'announce', title: { de: 'Minecraft: Ansage alle 2 Stunden', en: 'Minecraft: announcement every 2 hours' }, text: { de: 'Eine Nachricht im Chat – Regeln, Discord-Link, Dankeschön.', en: 'A chat message – rules, Discord link, thank you.' }, preset: { name: { de: 'Minecraft-Ansage', en: 'Minecraft announcement' }, action: { type: 'mc-command', command: 'say §aDanke fürs Spielen! Fragen? Schreib uns.' }, schedule: { mode: 'every', minutes: 120 } } },
    ],
    area: 'mc',
    ports: (s) => ports(mc, s),
    settingsKey: 'minecraft.servers',
    hooks: { deploy: (req, res) => mc.live.deployHook(req, res) },
    /** Sicherheits-Check (Livebetrieb): Offline-Modus, schwaches RCON-Passwort, öffentlich ohne Whitelist */
    async security({ live }) {
      const out = [];
      for (const s of mc.list()) {
        let props = {};
        try { props = (await Promise.resolve(mc.properties(s.id))) || {}; } catch { props = {}; }
        if (props['online-mode'] === 'false') out.push({ id: `online:${s.id}`, title: `${s.name}: Offline-Modus`, titles: { de: `${s.name}: Offline-Modus`, en: `${s.name}: offline mode` }, text: 'Ohne Online-Modus kann sich jeder mit beliebigem Namen anmelden – auch als du oder ein Admin.', fix: 'Online-Modus einschalten (nach Neustart)' });
        if (props['enable-rcon'] === 'true' && String(props['rcon.password'] || '').length < 12) out.push({ id: `rcon:${s.id}`, title: `${s.name}: schwaches RCON-Passwort`, titles: { de: `${s.name}: schwaches RCON-Passwort`, en: `${s.name}: weak RCON password` }, text: 'Über RCON lässt sich der Server fernsteuern.', fix: 'Starkes Passwort setzen' });
        if (live && props['white-list'] !== 'true' && props['online-mode'] !== 'false') out.push({ id: `whitelist:${s.id}`, level: 'info', title: `${s.name}: ohne Whitelist`, titles: { de: `${s.name}: ohne Whitelist`, en: `${s.name}: without whitelist` }, text: 'Jeder, der die Adresse kennt, kann mitspielen. Mit Whitelist nur eingeladene Spieler.', link: `#/mc/${s.id}/players` });
      }
      return out;
    },
    /** Punkt aus security() beheben */
    async fix(id, { strongPw }) {
      const [what, sid] = String(id).split(':');
      if (what !== 'online' && what !== 'rcon') return null;
      const props = await Promise.resolve(mc.properties(sid));
      const pw = strongPw();
      await Promise.resolve(mc.setProperties(sid, { ...props, ...(what === 'online' ? { 'online-mode': 'true' } : { 'rcon.password': pw }) }));
      return { text: what === 'online' ? T('Online mode is on – takes effect after the next restart.') : T('New RCON password: {pw}', { pw }), ...(what === 'rcon' ? { secret: pw } : {}) };
    },
    /** Umzug, Spiegel, Klonen, Behalten (kind.copy) */
    copy: require('./copy').minecraftCopy(mc),
    /** Fremde Minecraft-Server übernehmen („Übernehmen“ in Hostwerk) */
    adopt: require('./adopt').minecraftAdopt(mc),
    /** Geplante Aufgaben „mc-restart“, „mc-backup“, „mc-command“ (Namen wie bis Hostwerk 3.1 – gespeicherte Aufgaben laufen weiter) */
    tasks: {
      restart: {
        label: { de: 'Minecraft: Neustart', en: 'Minecraft: restart' },
        help: 'target = Server-ID, warnSeconds',
        habit: { warnSeconds: 60 },
        fields: [{ key: 'warnSeconds', type: 'select', default: 60, label: { de: 'Vorwarnung an Spieler', en: 'Warning to players' }, hint: { de: 'Kündigt den Neustart im Chat an.', en: 'Announces the restart in chat.' }, options: [[0, { de: 'keine', en: 'none' }], [30, { de: '30 Sekunden', en: '30 seconds' }], [60, { de: '1 Minute', en: '1 minute' }], [300, { de: '5 Minuten', en: '5 minutes' }], [600, { de: '10 Minuten', en: '10 minutes' }]] }],
        clean: (a) => ({ warnSeconds: Math.max(0, Math.min(600, Number(a.warnSeconds ?? 60))) }),
        async run(a, { wait, en }) {
          const p = mc.proc(a.target);
          if (!p.child) { await mc.start(a.target); return en ? 'Server was stopped – started.' : 'Server war gestoppt – gestartet.'; }
          const warn = Number(a.warnSeconds) || 0;
          // Countdown im Spiel: volle Minuten, dann 30 und 10 Sekunden und die letzten 5 – in der Sprache von Hostwerk
          const say = (sec) => {
            const t = sec >= 60 && sec % 60 === 0 ? (en ? `${sec / 60} minute${sec === 60 ? '' : 's'}` : `${sec / 60} ${sec === 60 ? 'Minute' : 'Minuten'}`) : (en ? `${sec} second${sec === 1 ? '' : 's'}` : `${sec} ${sec === 1 ? 'Sekunde' : 'Sekunden'}`);
            try { mc.command(a.target, `say ${sec > 10 ? '§e' : '§c'}${en ? `Scheduled restart in ${t}.` : `Geplanter Neustart in ${t}.`}`); } catch { /* Server inzwischen aus */ }
          };
          if (warn > 0) {
            const steps = [warn, ...[540, 480, 420, 360, 300, 240, 180, 120, 60, 30, 10, 5, 4, 3, 2, 1].filter((x) => x < warn)];
            for (let i = 0; i < steps.length; i++) { say(steps[i]); await wait((steps[i] - (steps[i + 1] || 0)) * 1000); }
          }
          await mc.restart(a.target);
          return en ? 'Restarted.' : 'Neu gestartet.';
        },
      },
      backup: {
        label: { de: 'Minecraft: Backup', en: 'Minecraft: backup' },
        help: 'target = Server-ID',
        async run(a, { en }) {
          const r = await mc.backup(a.target, 'geplant').promise;
          return `${en ? 'Backup created' : 'Backup erstellt'}: ${r && r.file ? r.file : 'ok'}`;
        },
      },
      command: {
        label: { de: 'Minecraft: Befehl', en: 'Minecraft: command' },
        help: 'target = Server-ID, command (eine Zeile je Befehl)',
        habit: null,
        fields: [{ key: 'command', type: 'textarea', mono: true, label: { de: 'Befehle (einer pro Zeile)', en: 'Commands (one per line)' }, placeholder: 'say Willkommen!\nweather clear' }],
        validate: (a) => { if (!String(a.command || '').trim()) throw new Error(T('Please enter a Minecraft command.')); },
        async run(a, { wait, en }) {
          if (!mc.proc(a.target).child) throw new Error(T('Server is not running.'));
          for (const c of String(a.command).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) { mc.command(a.target, c); await wait(300); }
          return en ? 'Command sent.' : 'Befehl gesendet.';
        },
      },
    },
    /** Sicherungen: Sicherungs-Zentrale, externe Sicherung (Dateien „mc-<id>-…“), Wiederherstellungs-Probe, Zeitmaschine */
    backups: {
      prefix: 'mc',
      list: (id) => mc.backups(id),
      create: (id, label) => mc.backup(id, label),
      dir: (id) => mc.backupDir(id),
      restore: (id, file) => mc.restore(id, file),
      remove: (id, file) => require('fs').rmSync(require('path').join(mc.backupDir(id), require('path').basename(file)), { force: true }),
      probe: require('./contrib').probeBackup(mc, mc.ctx),
    },
    /** Werte für Schwellen (Überwachung → „Melde dich, wenn …“) */
    metrics: ['cpu', 'ram', 'players', 'tps', 'disk', 'net'],
  };
}

module.exports = { minecraftKind, ports };
