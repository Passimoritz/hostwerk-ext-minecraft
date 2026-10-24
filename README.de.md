<p align="right"><a href="README.md">English</a> · <b>Deutsch</b></p>

# Minecraft-Server für Hostwerk

Minecraft-Server mit Paper, Purpur, Folia, Fabric, NeoForge, Forge, Velocity, Bedrock und Modpacks – bis Hostwerk 3.0 fest
eingebaut, seit 3.1 diese offizielle Erweiterung. Wer schon Server hatte, bekommt sie beim Update automatisch; Welten,
Einstellungen und Sicherungen bleiben, wo sie immer lagen.

- Server anlegen oder übernehmen, Konsole, Spieler (OP, Whitelist, Banns per Rechtsklick), Statistik
- Plugins und Mods aus Modrinth und Hangar, eigene Quellen (GitHub, SpigotMC, Jenkins, Projektordner)
- **Plugin-Live-Update** ohne Neustart über das Helfer-Plugin HostwerkBridge – auch für Plugins, von denen andere abhängen
- **Zustand im Detail**: CPU und RAM als „Server / System“, Java-Speicher, CPU je Aufgabe, Welten, Plugins, Speicherplatz
- **Welten mit allen Dimensionen** (auch aus Datenpaketen und Mods), einzeln zurücksetzen; Symbole aus dem Katalog oder aus
  den echten Eigenschaften der Dimension
- MOTD und Server-Symbol sofort, ohne Neustart; Symbol zuschneiden
- Sicherungen, Zeitplan, Server-Prüfung, sichere Updates mit Probelauf, Karte (BlueMap)

## Für andere Erweiterungen

Stellt `ctx.minecraft` bereit (Servernetzwerk, MOTD-Studio, Spieler-Ticker …). Ohne diese Erweiterung setzt Hostwerk einen
Platzhalter ein: keine Server, sonst ein verständlicher Hinweis „jetzt eine Erweiterung“.

## Entwicklung

```bash
node path/to/hostwerk/server/extensions/sdk/build-native.js .
```

```bash
node --test tests/
```

Die Bridge (`server/bridge`) baut Maven: `mvn -q package` und `target/HostwerkBridge.jar` nach `server/bridge/` kopieren.
Die Oberfläche hat deutschen Quelltext (übernommen aus dem Kern); Englisch kommt aus Hostwerks `en.json` (SDK 3.4).
