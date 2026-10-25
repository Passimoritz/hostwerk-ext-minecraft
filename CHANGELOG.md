# Changelog

## 1.1.0

- The former extension "MOTD studio" lives here now (SDK 3.8 `replaces`): the MOTD section in the overview of every Minecraft server, the big editor as the tab "MOTD studio" in the server list (with the colour codes) and "Design MOTD …" in the right-click menu and the quick search. Saved variants are taken over once; Hostwerk installs this version for everyone who had the MOTD studio and removes it. / Die frühere Erweiterung „MOTD-Studio“ steckt jetzt hier (SDK 3.8 `replaces`): der MOTD-Abschnitt in der Übersicht jedes Minecraft-Servers, der große Editor als Reiter „MOTD-Studio“ in der Serverliste (mit den Farbcodes) und „MOTD gestalten …“ im Rechtsklick-Menü und in der Schnellsuche. Gespeicherte Varianten werden einmal übernommen; Hostwerk installiert diese Fassung für alle mit dem MOTD-Studio und entfernt es.

## 1.0.3

- HostwerkBridge 1.3: own icon in the Hostwerk style for the Plugins tab, up-to-date description in English and German, runs on servers from 1.18 (Java 17), reproducible build in one step (`node tools/bridge.js`). / HostwerkBridge 1.3: eigenes Symbol im Hostwerk-Stil für den Plugins-Tab, aktuelle Beschreibung auf Englisch und Deutsch, läuft auf Servern ab 1.18 (Java 17), reproduzierbarer Build in einem Schritt (`node tools/bridge.js`).

## 1.0.2

- New animated icon and banner in the common Hostwerk style (isometric block). / Neues animiertes Symbol und Banner im gemeinsamen Hostwerk-Stil (isometrischer Block).

## 1.0.1 – 2026-10-24

First published release (1.0.0 was tagged but never released).

Minecraft servers as their own extension (moved out of Hostwerk 3.1).

- Everything that was built in: create/take over, console, players, plugins and mods, marketplace, worlds, backups, schedule,
  server check, safe updates, map, Bedrock, Velocity, modpacks.
- Health in detail (CPU/RAM as server / system, Java memory, CPU per task, worlds, plugins, disk), HostwerkBridge 1.2.
- Plugin live update also for plugins other plugins depend on (they are reloaded with it).
- MOTD and server icon without restart, icon cropping, grouped quick actions, worlds with all dimensions and their icons.
- An update of the extension keeps running servers running (the new version takes over their processes).
- Built like every other extension: English texts with German in `locales/de.json` (also messages of jobs, console and
  server check that Hostwerk never translated before), own styles (`ui/index.css`), banner and screenshots.

Kurz: Minecraft-Server als eigene Erweiterung (aus Hostwerk 3.1 ausgelagert), mit allen bisherigen Funktionen und den
Neuerungen vom 24.10.2026; ein Update der Erweiterung lässt laufende Server weiterlaufen.
