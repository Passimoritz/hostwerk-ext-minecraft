'use strict';
/*
 * Berater (SDK 3.5, contribute('advisor')): erkennt „Minecraft“ im allgemeinen Einstieg, empfiehlt die Server-Software im
 * Anlegen-Dialog und schätzt den Arbeitsspeicher aus der Spielerzahl. Dazu die Projekt-Vorlage „Paper-Plugin“.
 * Bis Hostwerk 3.1 im Kern. Begründungen auf Deutsch wie Hostwerks eigene (die Oberfläche übersetzt sie).
 */
const ram = (n) => (n > 40 ? 8192 : n > 15 ? 6144 : n > 6 ? 4096 : 3072);

const advisor = {
  kind: 'mc', label: 'Minecraft-Server', what: 'Minecraft-Server-Software',
  start: /minecraft|spieler|survival|mods?\b|modpack|paper|fabric|forge|lobby/i,
  rules: [
    [/modpack|curseforge|modrinth.*pack|atm|all the mods|fertig/i, 'modpack', 'Ein fertiges Modpack mit einem Klick – Loader und alle Server-Mods kommen automatisch mit.'],
    [/netzwerk|lobby|mehrere server|bungee|velocity|wechseln|minigames hub/i, 'velocity', 'Velocity verbindet mehrere Server (Lobby, Survival, Minigames) – Spieler wechseln mit /server.'],
    [/create|mekanism|thermal|forge|neoforge|große mods|technik|magie/i, 'neoforge', 'NeoForge ist der moderne Loader für große Mods wie Create oder Mekanism.'],
    [/fabric|sodium|lithium|leichte mods|performance-mods|carpet/i, 'fabric', 'Fabric ist leicht und schnell – ideal für Leistungs- und Technik-Mods.'],
    [/sehr viele spieler|hunderte|100\+|folia|riesig/i, 'folia', 'Folia verteilt die Welt auf alle Prozessorkerne – für sehr viele gleichzeitige Spieler.'],
    [/vanilla|ohne plugins|original|redstone|technik ohne|pures/i, 'vanilla', 'Der offizielle Server von Mojang – exakt wie im Einzelspieler, auch Redstone- und Farm-Tricks.'],
    [/viele einstellungen|gameplay|purpur/i, 'purpur', 'Purpur ist Paper mit vielen zusätzlichen Gameplay-Einstellungen.'],
    [/.*/i, 'paper', 'Paper ist die beliebteste Wahl: schnell, stabil und mit riesiger Plugin-Auswahl (Freunde, Survival, Minigames).'],
  ],
  values(text) {
    const m = String(text).match(/(\d{1,4})\s*(spieler|leute|freunde|personen)/i);
    if (!m) return {};
    const n = Number(m[1]);
    return { maxPlayers: n, ramMB: ram(n) };
  },
};
const project = { kind: 'project', rules: [[/minecraft|plugin|paper/i, 'paper-plugin', 'Ein Paper-Plugin-Projekt mit Live-Update auf deinen Testserver.']] };

module.exports = { advisor, project };
