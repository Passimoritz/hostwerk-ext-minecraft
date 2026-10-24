<p align="right"><b>English</b> · <a href="README.de.md">Deutsch</a></p>

# Minecraft servers for Hostwerk

Minecraft servers with Paper, Purpur, Folia, Fabric, NeoForge, Forge, Velocity, Bedrock and modpacks – built into Hostwerk up to
3.0, this official extension since 3.1. Anyone who already had servers gets it automatically with the update; worlds, settings
and backups stay where they always were.

- Create or take over servers, console, players (op, whitelist, bans by right-click), statistics
- Plugins and mods from Modrinth and Hangar, own sources (GitHub, SpigotMC, Jenkins, project folders)
- **Plugin live update** without restart through the helper plugin HostwerkBridge – also for plugins others depend on
- **Health in detail**: CPU and RAM as “server / system”, Java memory, CPU per task, worlds, plugins, disk space
- **Worlds with all dimensions** (also from datapacks and mods), reset one by one; icons from the catalog or built from the
  dimension's real properties
- MOTD and server icon right away, without restart; crop the icon
- Backups, schedule, server check, safe updates with a trial run, map (BlueMap)

## For other extensions

Provides `ctx.minecraft` (server network, MOTD studio, player ticker …). Without this extension Hostwerk puts in a placeholder:
no servers, otherwise a clear “now an extension” message.

## Development

```bash
node path/to/hostwerk/server/extensions/sdk/build-native.js .
```

```bash
node --test tests/
```

The bridge (`server/bridge`) builds with Maven: `mvn -q package`, then copy `target/HostwerkBridge.jar` to `server/bridge/`.
The interface has German source text (taken over from the core); English comes from Hostwerk's `en.json` (SDK 3.4).
