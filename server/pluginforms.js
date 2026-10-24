'use strict';
/*
 * Formulare für die Einstellungen häufiger Plugins: statt YAML von Hand gibt es Felder mit Erklärung.
 * Felder erscheinen nur, wenn es den Schlüssel in der Datei wirklich gibt (Plugins benennen zwischen Versionen um) –
 * so legt Hostwerk nie neue, unbekannte Schlüssel an. Gespeichert wird mit erhaltenen Kommentaren (YAML-Dokument).
 * type: bool | number | text | password | [Optionen]
 */
const fs = require('fs');
const path = require('path');
const YAML = require('./hw').lib('yaml');

const F = (key, label, type, help) => ({ key, label, type, help });
const FORMS = [
  { id: 'essentials', name: 'EssentialsX', folders: ['Essentials'], file: 'config.yml', fields: [
    F('locale', 'Sprache', 'text', 'Sprache der Meldungen, z. B. de oder en. Leer = Sprache des Servers.'),
    F('teleport-delay', 'Teleport-Verzögerung (s)', 'number', 'So lange müssen Spieler stillstehen, bevor /home, /tpa & Co. sie teleportieren.'),
    F('teleport-cooldown', 'Teleport-Abklingzeit (s)', 'number', 'Mindestabstand zwischen zwei Teleports.'),
    F('heal-cooldown', 'Heilen-Abklingzeit (s)', 'number', 'Wie oft /heal genutzt werden darf.'),
    F('nickname-prefix', 'Vorsatz für Spitznamen', 'text', 'Zeichen vor Spitznamen (/nick), damit man sie von echten Namen unterscheidet.'),
    F('max-nick-length', 'Spitzname höchstens (Zeichen)', 'number', 'Längster erlaubter Spitzname.'),
    F('change-displayname', 'Anzeigenamen ändern', 'bool', 'Spitznamen und Farben im Chat anzeigen.'),
    F('auto-afk', 'Automatisch abwesend nach (s)', 'number', 'Nach dieser Zeit ohne Bewegung gilt ein Spieler als AFK. 0 = aus.'),
    F('auto-afk-kick', 'AFK-Spieler entfernen nach (s)', 'number', 'Abwesende Spieler werden nach dieser Zeit gekickt. -1 = nie.'),
    F('spawn-on-join', 'Beim Betreten zum Spawn', 'bool', 'Spieler landen bei jedem Betreten am Spawn (EssentialsSpawn).'),
    F('respawn-at-home', 'Nach dem Tod nach Hause', 'bool', 'Wiedereinstieg am eigenen /home statt am Spawn.'),
    F('currency-symbol', 'Währungszeichen', 'text', 'Zeichen vor Geldbeträgen, z. B. $ oder €.'),
    F('starting-balance', 'Startguthaben', 'number', 'Geld, das neue Spieler bekommen.'),
    F('chat.radius', 'Chat-Reichweite (Blöcke)', 'number', 'Nur Spieler in dieser Entfernung lesen mit (EssentialsChat). 0 = alle.'),
    F('chat.format', 'Chat-Format', 'text', 'Aussehen einer Chatzeile, z. B. <{DISPLAYNAME}> {MESSAGE}.'),
  ] },
  { id: 'luckperms', name: 'LuckPerms', folders: ['LuckPerms'], file: 'config.yml', fields: [
    F('server', 'Servername', 'text', 'Name dieses Servers für serverabhängige Rechte (wichtig im Netzwerk).'),
    F('storage-method', 'Speicher', ['h2', 'sqlite', 'mysql', 'mariadb', 'postgresql', 'mongodb', 'yaml', 'json'], 'Wo Rechte gespeichert werden. Für mehrere Server dieselbe Datenbank (MariaDB) wählen.'),
    F('data.address', 'Datenbank-Adresse', 'text', 'Host:Port der Datenbank (nur bei MySQL/MariaDB/PostgreSQL).'),
    F('data.database', 'Datenbank-Name', 'text', ''),
    F('data.username', 'Datenbank-Benutzer', 'text', ''),
    F('data.password', 'Datenbank-Passwort', 'password', ''),
    F('sync-minutes', 'Abgleich alle (Minuten)', 'number', 'Wie oft Änderungen anderer Server übernommen werden. -1 = aus.'),
    F('enable-ops', 'OP-Rechte erlauben', 'bool', 'Aus = /op wirkt nicht mehr, alles läuft über LuckPerms.'),
    F('auto-op', 'Automatisch OP', 'bool', 'Spieler mit dem Recht luckperms.autoop werden OP.'),
  ] },
  { id: 'worldedit', name: 'WorldEdit', folders: ['WorldEdit'], file: 'config.yml', fields: [
    F('limits.max-blocks-changed.default', 'Blöcke je Befehl (Standard)', 'number', 'Höchstzahl veränderter Blöcke pro Befehl. -1 = unbegrenzt.'),
    F('limits.max-blocks-changed.maximum', 'Blöcke je Befehl (Obergrenze)', 'number', 'Mehr darf niemand einstellen. -1 = unbegrenzt.'),
    F('limits.max-radius', 'Größter Radius', 'number', 'Für Kugeln, Zylinder & Co. -1 = unbegrenzt.'),
    F('history.size', 'Rückgängig-Schritte', 'number', 'Wie viele //undo-Schritte je Spieler gemerkt werden.'),
    F('wand-item', 'Auswahl-Werkzeug', 'text', 'Gegenstand für //wand, z. B. minecraft:wooden_axe.'),
  ] },
  { id: 'worldguard', name: 'WorldGuard', folders: ['WorldGuard'], file: 'config.yml', fields: [
    F('regions.enable', 'Regionen aktiv', 'bool', 'Schutzgebiete ein- oder ausschalten.'),
    F('regions.wand', 'Auswahl-Werkzeug', 'text', 'Gegenstand zum Anzeigen von Regionen.'),
    F('regions.max-region-count-per-player.default', 'Regionen je Spieler', 'number', 'So viele Regionen darf ein Spieler selbst anlegen.'),
  ] },
  { id: 'coreprotect', name: 'CoreProtect', folders: ['CoreProtect'], file: 'config.yml', fields: [
    F('check-updates', 'Nach Updates suchen', 'bool', ''),
    F('default-radius', 'Standard-Radius', 'number', 'Radius für Abfragen und Zurücksetzen, wenn keiner angegeben ist.'),
    F('max-radius', 'Größter Radius', 'number', '0 = unbegrenzt.'),
    F('rollback-items', 'Gegenstände zurücksetzen', 'bool', 'Kisteninhalte beim Zurücksetzen mit wiederherstellen.'),
    F('rollback-entities', 'Kreaturen zurücksetzen', 'bool', 'Getötete Tiere beim Zurücksetzen wiederbeleben.'),
    F('item-transactions', 'Kisten protokollieren', 'bool', 'Wer hat was aus Kisten genommen?'),
    F('player-commands', 'Befehle protokollieren', 'bool', ''),
    F('player-messages', 'Chat protokollieren', 'bool', ''),
    F('use-mysql', 'MySQL/MariaDB nutzen', 'bool', 'Statt der eingebauten SQLite-Datei.'),
  ] },
  { id: 'griefprevention', name: 'GriefPrevention', folders: ['GriefPreventionData'], file: 'config.yml', fields: [
    F('GriefPrevention.Claims.InitialBlocks', 'Start-Schutzblöcke', 'number', 'So viele Blöcke dürfen neue Spieler sofort schützen.'),
    F('GriefPrevention.Claims.BlocksAccruedPerHour', 'Schutzblöcke je Stunde', 'number', 'Kommen pro Stunde Spielzeit dazu.'),
    F('GriefPrevention.Claims.MaxAccruedBlocks', 'Schutzblöcke höchstens', 'number', 'Obergrenze für erspielte Schutzblöcke.'),
    F('GriefPrevention.Claims.ModificationTool', 'Werkzeug zum Abstecken', 'text', 'Gegenstand zum Abstecken von Grundstücken.'),
    F('GriefPrevention.Claims.InvestigationTool', 'Werkzeug zum Nachsehen', 'text', 'Zeigt Grundstücke an.'),
  ] },
  { id: 'geyser', name: 'Geyser', folders: ['Geyser-Spigot', 'Geyser-Velocity', 'Geyser-BungeeCord'], file: 'config.yml', fields: [
    F('bedrock.port', 'Bedrock-Port (UDP)', 'number', 'Port für Handy-, Konsolen- und Windows-Spieler (Standard 19132).'),
    F('bedrock.motd1', 'Beschreibung Zeile 1', 'text', 'Text in der Bedrock-Serverliste.'),
    F('bedrock.motd2', 'Beschreibung Zeile 2', 'text', ''),
    F('remote.auth-type', 'Anmeldung', ['online', 'offline', 'floodgate'], 'floodgate = Bedrock-Spieler brauchen kein Java-Konto (Plugin Floodgate nötig).'),
    F('passthrough-motd', 'Beschreibung vom Java-Server', 'bool', 'MOTD des Java-Servers übernehmen.'),
    F('passthrough-player-counts', 'Spielerzahl vom Java-Server', 'bool', ''),
    F('max-players', 'Angezeigte Höchstzahl', 'number', ''),
  ] },
  { id: 'floodgate', name: 'Floodgate', folders: ['floodgate'], file: 'config.yml', fields: [
    F('username-prefix', 'Vorsatz für Bedrock-Namen', 'text', 'Unterscheidet Bedrock-Spieler von Java-Spielern (Standard: .).'),
    F('replace-spaces', 'Leerzeichen ersetzen', 'bool', 'Leerzeichen in Bedrock-Namen durch _ ersetzen.'),
  ] },
  { id: 'viaversion', name: 'ViaVersion', folders: ['ViaVersion'], file: 'config.yml', fields: [
    F('checkforupdates', 'Nach Updates suchen', 'bool', ''),
    F('suppress-conversion-warnings', 'Umwandlungs-Warnungen ausblenden', 'bool', 'Weniger Meldungen in der Konsole.'),
  ] },
  { id: 'placeholderapi', name: 'PlaceholderAPI', folders: ['PlaceholderAPI'], file: 'config.yml', fields: [
    F('check_updates', 'Nach Updates suchen', 'bool', ''),
    F('cloud_enabled', 'Erweiterungen aus der Cloud', 'bool', 'Erlaubt /papi ecloud download.'),
    F('boolean.true', 'Text für „ja“', 'text', ''),
    F('boolean.false', 'Text für „nein“', 'text', ''),
    F('date_format', 'Datumsformat', 'text', 'z. B. dd.MM.yyyy HH:mm'),
  ] },
  { id: 'chunky', name: 'Chunky', folders: ['Chunky'], file: 'config.yml', fields: [
    F('continue-on-restart', 'Nach Neustart weitermachen', 'bool', 'Angefangene Vorgenerierung nach einem Neustart fortsetzen.'),
    F('silent', 'Leise', 'bool', 'Keine Fortschrittsmeldungen in der Konsole.'),
    F('update-interval', 'Meldung alle (s)', 'number', ''),
  ] },
  { id: 'discordsrv', name: 'DiscordSRV', folders: ['DiscordSRV'], file: 'config.yml', fields: [
    F('BotToken', 'Bot-Token', 'password', 'Token deines Discord-Bots (Discord Developer Portal).'),
    F('DiscordConsoleChannelId', 'Konsolen-Kanal (ID)', 'text', 'Die Serverkonsole erscheint in diesem Kanal. Leer = aus.'),
    F('DiscordChatChannelMinecraftToDiscord', 'Chat nach Discord', 'bool', ''),
    F('DiscordChatChannelDiscordToMinecraft', 'Chat von Discord', 'bool', ''),
    F('ServerWatchdogEnabled', 'Hänger melden', 'bool', 'Meldet in Discord, wenn der Server nicht mehr antwortet.'),
  ] },
  { id: 'authme', name: 'AuthMe', folders: ['AuthMe'], file: 'config.yml', fields: [
    F('settings.security.minPasswordLength', 'Passwort mindestens (Zeichen)', 'number', ''),
    F('settings.security.passwordHash', 'Passwort-Verfahren', ['BCRYPT', 'ARGON2', 'SHA256', 'PBKDF2'], 'BCRYPT oder ARGON2 sind sicher.'),
    F('settings.restrictions.timeout', 'Zeit zum Anmelden (s)', 'number', 'Danach wird der Spieler gekickt.'),
    F('settings.sessions.enabled', 'Sitzungen merken', 'bool', 'Gleiche IP muss sich nach kurzer Pause nicht neu anmelden.'),
    F('settings.sessions.timeout', 'Sitzung gültig (Minuten)', 'number', ''),
    F('settings.registration.force', 'Registrierung erzwingen', 'bool', 'Neue Spieler müssen sich registrieren, bevor sie spielen.'),
  ] },
  { id: 'tab', name: 'TAB', folders: ['TAB'], file: 'config.yml', fields: [
    F('header-footer.enabled', 'Kopf- und Fußzeile', 'bool', 'Text über und unter der Spielerliste.'),
    F('tablist-name-formatting.enabled', 'Namen gestalten', 'bool', 'Präfixe und Farben in der Spielerliste.'),
    F('scoreboard-teams.enabled', 'Namensschilder gestalten', 'bool', 'Präfixe über den Köpfen.'),
    F('belowname-objective.enabled', 'Wert unter dem Namen', 'bool', 'z. B. Lebenspunkte unter dem Namen.'),
    F('permission-refresh-interval', 'Rechte neu lesen alle (ms)', 'number', ''),
  ] },
  { id: 'multiverse', name: 'Multiverse-Core', folders: ['Multiverse-Core'], file: 'config.yml', fields: [
    F('multiverse-configuration.enforceaccess', 'Zugang erzwingen', 'bool', 'Spieler brauchen das Recht für eine Welt, um sie zu betreten.'),
    F('multiverse-configuration.firstspawnoverride', 'Erster Spawn in Spawn-Welt', 'bool', 'Neue Spieler starten in der eingestellten Spawn-Welt.'),
    F('multiverse-configuration.teleportintercept', 'Teleports abfangen', 'bool', ''),
    F('world.enforce-access', 'Zugang erzwingen', 'bool', 'Spieler brauchen das Recht für eine Welt, um sie zu betreten.'),
    F('spawn.first-spawn-override', 'Erster Spawn in Spawn-Welt', 'bool', ''),
  ] },
  { id: 'dynmap', name: 'Dynmap', folders: ['dynmap'], file: 'configuration.txt', fields: [
    F('webserver-port', 'Port der Karte', 'number', 'Die Karte ist unter http://localhost:<Port>/ erreichbar.'),
    F('webserver-bindaddress', 'Adresse', 'text', '0.0.0.0 = aus dem Netzwerk erreichbar, 127.0.0.1 = nur dieser PC.'),
    F('login-enabled', 'Anmeldung auf der Karte', 'bool', ''),
  ] },
  { id: 'protocollib', name: 'ProtocolLib', folders: ['ProtocolLib'], file: 'config.yml', fields: [
    F('global.auto updater.notify', 'Über Updates informieren', 'bool', ''),
    F('global.auto updater.download', 'Updates herunterladen', 'bool', ''),
    F('global.metrics', 'Statistik senden', 'bool', 'Anonyme Nutzungsdaten an bStats.'),
  ] },
  { id: 'mcmmo', name: 'mcMMO', folders: ['mcMMO'], file: 'config.yml', fields: [
    F('General.Locale', 'Sprache', 'text', 'z. B. de_DE oder en_US.'),
    F('General.Save_Interval', 'Speichern alle (Minuten)', 'number', ''),
    F('General.Power_Level_Cap', 'Gesamt-Stufe höchstens', 'number', '0 = unbegrenzt.'),
  ] },
  { id: 'votifier', name: 'NuVotifier', folders: ['Votifier', 'NuVotifier'], file: 'config.yml', fields: [
    F('host', 'Adresse', 'text', 'Meist 0.0.0.0.'),
    F('port', 'Port', 'number', 'Diesen Port bei den Server-Listen angeben (Standard 8192).'),
    F('debug', 'Fehlersuche', 'bool', 'Mehr Meldungen in der Konsole.'),
  ] },
  { id: 'clearlag', name: 'ClearLag', folders: ['ClearLag'], file: 'config.yml', fields: [
    F('auto-removal.enabled', 'Automatisch aufräumen', 'bool', 'Herumliegende Gegenstände regelmäßig entfernen.'),
    F('auto-removal.autoremoval-interval', 'Aufräumen alle (s)', 'number', ''),
  ] },
  { id: 'plan', name: 'Plan', folders: ['Plan'], file: 'config.yml', fields: [
    F('Webserver.Port', 'Port der Webseite', 'number', 'Statistik-Seite unter http://localhost:<Port>/.'),
  ] },
  { id: 'squaremap', name: 'squaremap', folders: ['squaremap'], file: 'config.yml', fields: [
    F('settings.internal-webserver.enabled', 'Eigene Webseite', 'bool', ''),
    F('settings.internal-webserver.bind', 'Adresse', 'text', ''),
    F('settings.internal-webserver.port', 'Port der Karte', 'number', ''),
  ] },
];

const pathOf = (key) => key.split('.');
function locate(pluginsDir, form) {
  for (const f of form.folders) { const file = path.join(pluginsDir, f, form.file); if (fs.existsSync(file)) return file; }
  return null;
}

/** Formulare der installierten Plugins mit aktuellen Werten (nur vorhandene Felder). */
function listForms(pluginsDir) {
  const out = [];
  for (const form of FORMS) {
    const file = locate(pluginsDir, form);
    if (!file) continue;
    let doc;
    try { doc = YAML.parseDocument(fs.readFileSync(file, 'utf8')); } catch (e) { out.push({ id: form.id, name: form.name, file: path.relative(pluginsDir, file), error: `Datei nicht lesbar: ${e.message}`, fields: [] }); continue; }
    const fields = form.fields.filter((x) => doc.hasIn(pathOf(x.key))).map((x) => {
      const v = doc.getIn(pathOf(x.key));
      return { ...x, value: x.type === 'password' ? '' : v, hasValue: x.type === 'password' ? !!v : undefined };
    });
    if (fields.length) out.push({ id: form.id, name: form.name, file: path.relative(pluginsDir, file).replace(/\\/g, '/'), fields });
  }
  return out;
}

/** Werte speichern – nur Felder des Formulars, die es in der Datei schon gibt; Kommentare bleiben erhalten. */
function saveForm(pluginsDir, id, values) {
  const form = FORMS.find((x) => x.id === id);
  if (!form) throw Object.assign(new Error('Unbekanntes Formular'), { status: 404 });
  const file = locate(pluginsDir, form);
  if (!file) throw Object.assign(new Error('Die Einstellungsdatei gibt es nicht (mehr).'), { status: 404 });
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  for (const f of form.fields) {
    if (!(f.key in (values || {})) || !doc.hasIn(pathOf(f.key))) continue;
    let v = values[f.key];
    if (f.type === 'password' && (v === '' || v == null)) continue; // leer = unverändert
    if (f.type === 'bool') v = v === true || v === 'true';
    else if (f.type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw new Error(`„${f.label}“ muss eine Zahl sein.`); }
    else if (Array.isArray(f.type)) { if (!f.type.includes(String(v))) throw new Error(`Ungültiger Wert für „${f.label}“.`); v = String(v); }
    else v = String(v);
    if (doc.getIn(pathOf(f.key)) === v) continue;
    doc.setIn(pathOf(f.key), v);
    changed++;
  }
  if (changed) {
    fs.copyFileSync(file, file + '.hostwerk-alt'); // vorige Fassung neben der Datei
    fs.writeFileSync(file, doc.toString());
  }
  return { changed };
}

module.exports = { FORMS, listForms, saveForm };
