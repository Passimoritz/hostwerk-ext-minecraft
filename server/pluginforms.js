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
const T = (text, vars) => require('./hw').t(text, vars); // Text in der Sprache der Oberfläche (Deutsch aus locales/de.json)

const F = (key, label, type, help) => ({ key, label, type, help });
const FORMS = [
  { id: 'essentials', name: 'EssentialsX', folders: ['Essentials'], file: 'config.yml', fields: [
    F('locale', 'Language', 'text', 'Language of the messages, e.g. de or en. Empty = language of the server.'),
    F('teleport-delay', 'Teleport delay (s)', 'number', 'How long players have to stand still before /home, /tpa & co. teleport them.'),
    F('teleport-cooldown', 'Teleport cooldown (s)', 'number', 'Minimum time between two teleports.'),
    F('heal-cooldown', 'Heal cooldown (s)', 'number', 'How often /heal may be used.'),
    F('nickname-prefix', 'Nickname prefix', 'text', 'Character in front of nicknames (/nick) to tell them apart from real names.'),
    F('max-nick-length', 'Nickname at most (characters)', 'number', 'Longest allowed nickname.'),
    F('change-displayname', 'Change display names', 'bool', 'Show nicknames and colours in the chat.'),
    F('auto-afk', 'Away automatically after (s)', 'number', 'After this time without moving a player counts as AFK. 0 = off.'),
    F('auto-afk-kick', 'Remove AFK players after (s)', 'number', 'Away players are kicked after this time. -1 = never.'),
    F('spawn-on-join', 'To spawn on join', 'bool', 'Players land at the spawn every time they join (EssentialsSpawn).'),
    F('respawn-at-home', 'Home after death', 'bool', 'Respawn at their own /home instead of the spawn.'),
    F('currency-symbol', 'Currency symbol', 'text', 'Character in front of amounts of money, e.g. $ or €.'),
    F('starting-balance', 'Starting balance', 'number', 'Money new players get.'),
    F('chat.radius', 'Chat range (blocks)', 'number', 'Only players within this distance can read along (EssentialsChat). 0 = everyone.'),
    F('chat.format', 'Chat format', 'text', 'Look of a chat line, e.g. <{DISPLAYNAME}> {MESSAGE}.'),
  ] },
  { id: 'luckperms', name: 'LuckPerms', folders: ['LuckPerms'], file: 'config.yml', fields: [
    F('server', 'Server name', 'text', 'Name of this server for server-specific permissions (important in a network).'),
    F('storage-method', 'Storage method', ['h2', 'sqlite', 'mysql', 'mariadb', 'postgresql', 'mongodb', 'yaml', 'json'], 'Where permissions are stored. For several servers choose the same database (MariaDB).'),
    F('data.address', 'Database address', 'text', 'Host:port of the database (only with MySQL/MariaDB/PostgreSQL).'),
    F('data.database', 'Database name', 'text', ''),
    F('data.username', 'Database user', 'text', ''),
    F('data.password', 'Database password', 'password', ''),
    F('sync-minutes', 'Sync every (minutes)', 'number', 'How often changes from other servers are picked up. -1 = off.'),
    F('enable-ops', 'Allow OP permissions', 'bool', 'Off = /op no longer works, everything goes through LuckPerms.'),
    F('auto-op', 'OP automatically', 'bool', 'Players with the permission luckperms.autoop become OP.'),
  ] },
  { id: 'worldedit', name: 'WorldEdit', folders: ['WorldEdit'], file: 'config.yml', fields: [
    F('limits.max-blocks-changed.default', 'Blocks per command (default)', 'number', 'Maximum number of changed blocks per command. -1 = unlimited.'),
    F('limits.max-blocks-changed.maximum', 'Blocks per command (upper limit)', 'number', 'Nobody may set more. -1 = unlimited.'),
    F('limits.max-radius', 'Largest radius', 'number', 'For spheres, cylinders & co. -1 = unlimited.'),
    F('history.size', 'Undo steps', 'number', 'How many //undo steps are remembered per player.'),
    F('wand-item', 'Selection tool', 'text', 'Item for //wand, e.g. minecraft:wooden_axe.'),
  ] },
  { id: 'worldguard', name: 'WorldGuard', folders: ['WorldGuard'], file: 'config.yml', fields: [
    F('regions.enable', 'Regions active', 'bool', 'Turn protected areas on or off.'),
    F('regions.wand', 'Selection tool', 'text', 'Item for showing regions.'),
    F('regions.max-region-count-per-player.default', 'Regions per player', 'number', 'This many regions a player may create themselves.'),
  ] },
  { id: 'coreprotect', name: 'CoreProtect', folders: ['CoreProtect'], file: 'config.yml', fields: [
    F('check-updates', 'Check for updates', 'bool', ''),
    F('default-radius', 'Default radius', 'number', 'Radius for lookups and rollbacks when none is given.'),
    F('max-radius', 'Largest radius', 'number', '0 = unlimited.'),
    F('rollback-items', 'Roll back items', 'bool', 'Also restore chest contents when rolling back.'),
    F('rollback-entities', 'Roll back creatures', 'bool', 'Bring killed animals back when rolling back.'),
    F('item-transactions', 'Log chests', 'bool', 'Who took what out of chests?'),
    F('player-commands', 'Log commands', 'bool', ''),
    F('player-messages', 'Log chat', 'bool', ''),
    F('use-mysql', 'Use MySQL/MariaDB', 'bool', 'Instead of the built-in SQLite file.'),
  ] },
  { id: 'griefprevention', name: 'GriefPrevention', folders: ['GriefPreventionData'], file: 'config.yml', fields: [
    F('GriefPrevention.Claims.InitialBlocks', 'Starting claim blocks', 'number', 'This many blocks new players may claim right away.'),
    F('GriefPrevention.Claims.BlocksAccruedPerHour', 'Claim blocks per hour', 'number', 'Added per hour of play time.'),
    F('GriefPrevention.Claims.MaxAccruedBlocks', 'Claim blocks at most', 'number', 'Upper limit for earned claim blocks.'),
    F('GriefPrevention.Claims.ModificationTool', 'Claiming tool', 'text', 'Item for claiming land.'),
    F('GriefPrevention.Claims.InvestigationTool', 'Inspection tool', 'text', 'Shows claims.'),
  ] },
  { id: 'geyser', name: 'Geyser', folders: ['Geyser-Spigot', 'Geyser-Velocity', 'Geyser-BungeeCord'], file: 'config.yml', fields: [
    F('bedrock.port', 'Bedrock-Port (UDP)', 'number', 'Port for phone, console and Windows players (default 19132).'),
    F('bedrock.motd1', 'Description line 1', 'text', 'Text in the Bedrock server list.'),
    F('bedrock.motd2', 'Description line 2', 'text', ''),
    F('remote.auth-type', 'Sign-in', ['online', 'offline', 'floodgate'], 'floodgate = Bedrock players don\'t need a Java account (needs the Floodgate plugin).'),
    F('passthrough-motd', 'Description from the Java server', 'bool', 'Use the MOTD of the Java server.'),
    F('passthrough-player-counts', 'Player count from the Java server', 'bool', ''),
    F('max-players', 'Maximum shown', 'number', ''),
  ] },
  { id: 'floodgate', name: 'Floodgate', folders: ['floodgate'], file: 'config.yml', fields: [
    F('username-prefix', 'Prefix for Bedrock names', 'text', 'Tells Bedrock players apart from Java players (default: .).'),
    F('replace-spaces', 'Replace spaces', 'bool', 'Replace spaces in Bedrock names with _.'),
  ] },
  { id: 'viaversion', name: 'ViaVersion', folders: ['ViaVersion'], file: 'config.yml', fields: [
    F('checkforupdates', 'Check for updates', 'bool', ''),
    F('suppress-conversion-warnings', 'Hide conversion warnings', 'bool', 'Fewer messages in the console.'),
  ] },
  { id: 'placeholderapi', name: 'PlaceholderAPI', folders: ['PlaceholderAPI'], file: 'config.yml', fields: [
    F('check_updates', 'Check for updates', 'bool', ''),
    F('cloud_enabled', 'Expansions from the cloud', 'bool', 'Allows /papi ecloud download.'),
    F('boolean.true', 'Text for “yes”', 'text', ''),
    F('boolean.false', 'Text for “no”', 'text', ''),
    F('date_format', 'Datumsformat', 'text', 'z. B. dd.MM.yyyy HH:mm'),
  ] },
  { id: 'chunky', name: 'Chunky', folders: ['Chunky'], file: 'config.yml', fields: [
    F('continue-on-restart', 'Continue after a restart', 'bool', 'Continue a started pre-generation after a restart.'),
    F('silent', 'Leise', 'bool', 'No progress messages in the console.'),
    F('update-interval', 'Message every (s)', 'number', ''),
  ] },
  { id: 'discordsrv', name: 'DiscordSRV', folders: ['DiscordSRV'], file: 'config.yml', fields: [
    F('BotToken', 'Bot-Token', 'password', 'Token of your Discord bot (Discord Developer Portal).'),
    F('DiscordConsoleChannelId', 'Console channel (ID)', 'text', 'The server console appears in this channel. Empty = off.'),
    F('DiscordChatChannelMinecraftToDiscord', 'Chat to Discord', 'bool', ''),
    F('DiscordChatChannelDiscordToMinecraft', 'Chat from Discord', 'bool', ''),
    F('ServerWatchdogEnabled', 'Report hangs', 'bool', 'Reports in Discord when the server stops answering.'),
  ] },
  { id: 'authme', name: 'AuthMe', folders: ['AuthMe'], file: 'config.yml', fields: [
    F('settings.security.minPasswordLength', 'Password at least (characters)', 'number', ''),
    F('settings.security.passwordHash', 'Password hashing', ['BCRYPT', 'ARGON2', 'SHA256', 'PBKDF2'], 'BCRYPT or ARGON2 are secure.'),
    F('settings.restrictions.timeout', 'Time to sign in (s)', 'number', 'After that the player is kicked.'),
    F('settings.sessions.enabled', 'Remember sessions', 'bool', 'The same IP doesn\'t have to sign in again after a short break.'),
    F('settings.sessions.timeout', 'Session valid (minutes)', 'number', ''),
    F('settings.registration.force', 'Force registration', 'bool', 'New players have to register before they play.'),
  ] },
  { id: 'tab', name: 'TAB', folders: ['TAB'], file: 'config.yml', fields: [
    F('header-footer.enabled', 'Header and footer', 'bool', 'Text above and below the player list.'),
    F('tablist-name-formatting.enabled', 'Style names', 'bool', 'Prefixes and colours in the player list.'),
    F('scoreboard-teams.enabled', 'Style name tags', 'bool', 'Prefixes above the heads.'),
    F('belowname-objective.enabled', 'Value below the name', 'bool', 'e.g. health below the name.'),
    F('permission-refresh-interval', 'Reread permissions every (ms)', 'number', ''),
  ] },
  { id: 'multiverse', name: 'Multiverse-Core', folders: ['Multiverse-Core'], file: 'config.yml', fields: [
    F('multiverse-configuration.enforceaccess', 'Enforce access', 'bool', 'Players need the permission for a world to enter it.'),
    F('multiverse-configuration.firstspawnoverride', 'First spawn in the spawn world', 'bool', 'New players start in the configured spawn world.'),
    F('multiverse-configuration.teleportintercept', 'Teleports abfangen', 'bool', ''),
    F('world.enforce-access', 'Enforce access', 'bool', 'Players need the permission for a world to enter it.'),
    F('spawn.first-spawn-override', 'First spawn in the spawn world', 'bool', ''),
  ] },
  { id: 'dynmap', name: 'Dynmap', folders: ['dynmap'], file: 'configuration.txt', fields: [
    F('webserver-port', 'Port of the map', 'number', 'The map is reachable at http://localhost:<port>/.'),
    F('webserver-bindaddress', 'Address', 'text', '0.0.0.0 = reachable from the network, 127.0.0.1 = only this PC.'),
    F('login-enabled', 'Sign-in on the map', 'bool', ''),
  ] },
  { id: 'protocollib', name: 'ProtocolLib', folders: ['ProtocolLib'], file: 'config.yml', fields: [
    F('global.auto updater.notify', 'Notify about updates', 'bool', ''),
    F('global.auto updater.download', 'Download updates', 'bool', ''),
    F('global.metrics', 'Send statistics', 'bool', 'Anonymous usage data to bStats.'),
  ] },
  { id: 'mcmmo', name: 'mcMMO', folders: ['mcMMO'], file: 'config.yml', fields: [
    F('General.Locale', 'Language', 'text', 'e.g. de_DE or en_US.'),
    F('General.Save_Interval', 'Save every (minutes)', 'number', ''),
    F('General.Power_Level_Cap', 'Total level at most', 'number', '0 = unlimited.'),
  ] },
  { id: 'votifier', name: 'NuVotifier', folders: ['Votifier', 'NuVotifier'], file: 'config.yml', fields: [
    F('host', 'Address', 'text', 'Usually 0.0.0.0.'),
    F('port', 'Port', 'number', 'Give this port to the server lists (default 8192).'),
    F('debug', 'Debugging', 'bool', 'More messages in the console.'),
  ] },
  { id: 'clearlag', name: 'ClearLag', folders: ['ClearLag'], file: 'config.yml', fields: [
    F('auto-removal.enabled', 'Clean up automatically', 'bool', 'Regularly remove items lying around.'),
    F('auto-removal.autoremoval-interval', 'Clean up every (s)', 'number', ''),
  ] },
  { id: 'plan', name: 'Plan', folders: ['Plan'], file: 'config.yml', fields: [
    F('Webserver.Port', 'Port of the website', 'number', 'Statistics page at http://localhost:<port>/.'),
  ] },
  { id: 'squaremap', name: 'squaremap', folders: ['squaremap'], file: 'config.yml', fields: [
    F('settings.internal-webserver.enabled', 'Own website', 'bool', ''),
    F('settings.internal-webserver.bind', 'Address', 'text', ''),
    F('settings.internal-webserver.port', 'Port of the map', 'number', ''),
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
    try { doc = YAML.parseDocument(fs.readFileSync(file, 'utf8')); } catch (e) { out.push({ id: form.id, name: form.name, file: path.relative(pluginsDir, file), error: T('File not readable: {message}', { message: e.message }), fields: [] }); continue; }
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
  if (!form) throw Object.assign(new Error(T('Unknown form')), { status: 404 });
  const file = locate(pluginsDir, form);
  if (!file) throw Object.assign(new Error(T('The settings file does not exist (anymore).')), { status: 404 });
  const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  for (const f of form.fields) {
    if (!(f.key in (values || {})) || !doc.hasIn(pathOf(f.key))) continue;
    let v = values[f.key];
    if (f.type === 'password' && (v === '' || v == null)) continue; // leer = unverändert
    if (f.type === 'bool') v = v === true || v === 'true';
    else if (f.type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw new Error(T('“{label}” must be a number.', { label: f.label })); }
    else if (Array.isArray(f.type)) { if (!f.type.includes(String(v))) throw new Error(T('Invalid value for “{label}”.', { label: f.label })); v = String(v); }
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
