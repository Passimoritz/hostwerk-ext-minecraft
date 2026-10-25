'use strict';
/*
 * Minecraft-Server (Java und Bedrock, Proxys, Plugins, Mods, Modpacks) – bis Hostwerk 3.0 fest eingebaut.
 * Stellt ctx.minecraft bereit: Hostwerks Übersicht, Zeitplan, Sicherungen, Umzug, KI-Werkzeuge, Firewall und andere
 * Erweiterungen (Servernetzwerk, MOTD-Studio, Spieler-Ticker …) greifen darüber zu. Die Daten bleiben, wo sie immer lagen
 * (Einstellungen „minecraft“, Ordner minecraft/ und backups/minecraft/).
 *
 * Ein Update der Erweiterung startet laufende Server nicht neu: die neue Fassung übernimmt deren Prozesse (manager.proc).
 */
const path = require('path');

let mc = null;
let nightly = null;
const T = (text, vars) => require('./hw').t(text, vars);

exports.activate = (host) => {
  require('./hw').init(host);
  const { MinecraftManager } = require('./manager');
  const multer = host.lib('multer');
  const upload = multer({ dest: path.join(host.ctx.paths.cache, 'mc-upload'), limits: { fileSize: 4 * 1024 * 1024 * 1024 }, defParamCharset: 'utf8' });
  mc = host.provide('minecraft', new MinecraftManager(host.ctx));
  mc.routes(host.router, upload);
  require('./nbtview').routes(host.router, host.ctx); // NBT-Baum für die Dateivorschau
  // Nächtliche Sicherung (Sicherheitsnetz ab Werk): Zeitplan, Aufbewahrung, Routen /mc/servers/:id/nightly-backup
  nightly = new (require('./nightly').NightlyBackups)(host.ctx, mc);
  nightly.routes(host.router);
  if (typeof host.contribute === 'function') host.contribute('keeper', { checks: [{ label: T('Minecraft backups (due and missed)'), run: () => nightly.tick() }] });
  // Dienst-Art (SDK 3.5): Hostwerk behandelt Minecraft-Server darüber wie eingebaute Dienste (ältere Hostwerks: ctx.minecraft)
  if (typeof host.serviceKind === 'function') host.serviceKind(require('./kind').minecraftKind(mc));
  // KI: Werkzeuge, Rolle „Minecraft-Admin“, Helfer-Texte, Fachwörter (SDK 3.5)
  if (typeof host.aiExtend === 'function') host.aiExtend(require('./ai').minecraftAi(mc));
  // Selbstwartung, Gesundheits-Check, Inhaltssuche, Livegang-Ziel „Minecraft für Freunde“ (SDK 3.5)
  if (typeof host.contribute === 'function') {
    for (const [type, def] of Object.entries(require('./contrib').contributions(mc))) host.contribute(type, def);
    host.contribute('terminal', { detect: require('./terminal').detect }); // Schnellbefehle im Terminal für Server-Ordner
    { const adv = require('./advisor'); host.contribute('advisor', adv.advisor); host.contribute('advisor', adv.project); } // Berater
    host.contribute('releaseNotes', { sources: require('./releasenotes').sources }); // „Was ist neu?“ für Minecraft, Paper, Purpur, Spigot
    host.contribute('audit', require('./audit').audit); // Änderungsprotokoll: Texte und Schwärzen von Passwort-Befehlen
    host.contribute('clickguard', { block: [/^\/mc\/servers\/[^/]+\/(market\/install|plugins\/(update|sources\/update|source\/open)|modpack\/update|bedrock\/update|live-update)/] }); // Klick-Test: große Downloads
  }
  // „Mit Hostwerk starten“ – nach Datenbanken, Webservern und Apps (Reihenfolge wie früher im Kern); want = Profil/letzter Stand
  host.on('autostart', (want) => mc.list().filter((s) => (want ? want(s.autostart, 'mc:' + s.id) : s.autostart)).map((s) => () => mc.start(s.id)));
  host.on('shutdown', () => { if (mc) mc.dispose(); });
};

exports.deactivate = () => { if (nightly) { nightly.dispose(); nightly = null; } if (mc) { mc.dispose(); mc = null; } };

/** Nur beim ENTFERNEN (nicht bei Update/Ausschalten): laufende Server sauber stoppen – Welten und Einstellungen bleiben. */
exports.uninstall = async () => {
  if (!mc) return;
  await Promise.all(mc.list().filter((s) => mc.proc(s.id).isRunning()).map((s) => mc.stop(s.id).catch(() => {})));
};
