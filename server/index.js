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

exports.activate = (host) => {
  require('./hw').init(host);
  const { MinecraftManager } = require('./manager');
  const multer = host.lib('multer');
  const upload = multer({ dest: path.join(host.ctx.paths.cache, 'mc-upload'), limits: { fileSize: 4 * 1024 * 1024 * 1024 }, defParamCharset: 'utf8' });
  mc = host.provide('minecraft', new MinecraftManager(host.ctx));
  mc.routes(host.router, upload);
  // „Mit Hostwerk starten“ – nach Datenbanken, Webservern und Apps (Reihenfolge wie früher im Kern); want = Profil/letzter Stand
  host.on('autostart', (want) => mc.list().filter((s) => (want ? want(s.autostart, 'mc:' + s.id) : s.autostart)).map((s) => () => mc.start(s.id)));
  host.on('shutdown', () => { if (mc) mc.dispose(); });
};

exports.deactivate = () => { if (mc) { mc.dispose(); mc = null; } };

/** Nur beim ENTFERNEN (nicht bei Update/Ausschalten): laufende Server sauber stoppen – Welten und Einstellungen bleiben. */
exports.uninstall = async () => {
  if (!mc) return;
  await Promise.all(mc.list().filter((s) => mc.proc(s.id).isRunning()).map((s) => mc.stop(s.id).catch(() => {})));
};
