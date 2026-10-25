'use strict';
/*
 * KI-Beiträge (SDK 3.5, host.aiExtend): Werkzeuge für Minecraft-Server, die Rolle „Minecraft-Admin“, Helfer-Texte für
 * Modpack-Updates und Versionssprünge, Fachwörter für Spracherkennung und Aussprache. Bis Hostwerk 3.1 lag das im Kern.
 * Werkzeug-Beschreibungen sind – wie die eingebauten – Deutsch: die KI liest sie, der Nutzer sieht nur describe().
 */
function minecraftAi(mc) {
  return {
    about: { de: 'Minecraft-Server', en: 'Minecraft servers' },
    groups: { mc: { de: 'Minecraft', en: 'Minecraft', modes: ['allgemein', 'sicherheit', 'livegang', 'leistung', 'backup', 'minecraft', 'custom'] } },
    vocab: ['Minecraft', 'Paper', 'Purpur', 'Spigot', 'Fabric', 'Forge', 'NeoForge', 'Bedrock', 'Geyser', 'Velocity'],
    speak: { minecraft: 'Mainkraft', paper: 'Päiper', purpur: 'Purpur', spigot: 'Spiggott', vanilla: 'Wanilla' },
    modes: [{
      id: 'minecraft', name: 'Minecraft-Admin', icon: 'box', color: '#23964a',
      description: 'Verwaltet Minecraft-Server: Spieler, Befehle, Plugins, Einstellungen, Leistung.',
      prompt: 'Du bist ein erfahrener Minecraft-Server-Admin (Paper, Purpur, Spigot, Vanilla). Sieh dir Server, Spieler, Plugins und Konsole an (mc_servers, mc_server). Befehle gibst du ohne Schrägstrich über mc_command ein. Bei Leistungsproblemen schau auf TPS, RAM und Plugins.',
      groups: ['mc', 'status', 'control', 'files', 'create'],
      suggestions: ['Wer ist gerade online?', 'Wie läuft mein Server (TPS, RAM, Plugins)?', 'Empfiehl mir gute Plugins gegen Lags'],
    }],
    assists: [
      { id: 'modpack', label: 'Modpack- und Mod-Updates', text: 'Fasst die Änderungsliste neuer Modpack-Versionen auf Deutsch zusammen und nennt Risiken (z. B. Minecraft-Wechsel).', prompt: 'Fasse diese Änderungsliste eines Minecraft-Modpacks auf Deutsch in 3–6 Stichpunkten zusammen. Nenne zuerst Risiken (Minecraft-Versionswechsel, entfernte Mods, Welt-Inkompatibilität), dann Neuerungen.' },
      { id: 'upgrade', label: 'Versionssprung bewerten', text: 'Vor einem Minecraft-Versionssprung bewertet der Helfer die Plugin-Verträglichkeit und das Ergebnis des Probelaufs.', prompt: 'Das ist die Prüfung vor einem Minecraft-Versionssprung: Plugin-/Mod-Verträglichkeit und das Ergebnis eines Probelaufs auf einer Kopie. Sag klar, ob der Sprung ratsam ist, welche Plugins ein Risiko sind und was vorher zu tun ist. Höchstens 8 Zeilen.' },
    ],
    /** Chat-Anhang „Minecraft-Server“ → Details als Kontext */
    async context(c, run) {
      if (c.kind !== 'mc') return undefined;
      return `### Minecraft-Server ${c.label || c.id}\n${await run('mc_server', { id: c.id })}`;
    },
    tools({ add, S, L, find, clip }) {
    add('mc_servers', 'mc', 'Minecraft-Server mit Version, Zustand, Spielern (Namen), TPS und Port.', {}, [], async () => mc.list().map((s) => {
      const p = mc.proc(s.id);
      return { id: s.id, name: s.name, typ: s.type, version: s.version, port: s.port, zustand: p.state, bereit: !!p.extra.ready, spieler: p.extra.players || [], anzahl: p.extra.playerCount || 0, tps: p.extra.tps ?? null, ram: `${s.memMin}-${s.memMax} MB` };
    }), { risk: 'read' });
    add('mc_server', 'mc', 'Details eines Minecraft-Servers: server.properties, Plugins und letzte Konsolenzeilen.', { id: S('Server-ID oder Name') }, ['id'], async ({ id }) => {
      const s = find(mc.list(), id, 'Minecraft-Server');
      const plugins = (await mc.plugins(s.id).catch(() => [])).map((p) => `${p.name} ${p.version || ''}${p.enabled ? '' : ' (aus)'}`);
      return clip({ properties: mc.properties(s.id), plugins, konsole: mc.proc(s.id).logs.slice(-40).map((e) => e.l) }, 8000);
    }, { risk: 'read' });
    add('mc_command', 'mc', 'Befehl in der Konsole eines laufenden Minecraft-Servers ausführen (ohne Schrägstrich). Für Wünsche wie „mach Tag“ (time set day), „mach Nacht“ (time set night), „Wetter klar“ (weather clear), „gib X OP“ (op X), „X in Kreativ“ (gamemode creative X), „sag allen …“ (say …), „kick X“ (kick X).', { id: S('Server-ID oder Name'), command: S('z. B. „say Hallo“, „op Name“, „time set day“') }, ['id', 'command'], async ({ id, command }) => {
      const s = find(mc.list(), id, 'Minecraft-Server');
      const p = mc.proc(s.id);
      const before = p.logs.length;
      mc.command(s.id, String(command).replace(/^\//, ''));
      await new Promise((r) => setTimeout(r, 1200));
      return clip(p.logs.slice(before).map((e) => e.l).join('\n') || 'Befehl gesendet (keine Ausgabe).');
    }, { risk: 'change', describe: ({ id, command }) => `${L('Minecraft-Befehl auf', 'Minecraft command on')} ${id}: /${String(command).replace(/^\//, '')}` });
    add('mc_plugin_search', 'mc', 'Plugins im Marktplatz suchen (Modrinth + Hangar, passend zu Servertyp und Version). Leerer Suchbegriff + Kategorie = beliebteste der Kategorie. Kategorien: admin, protection, chat, economy, gameplay, minigames, world, rpg, performance, utility, library.', { id: S('Server-ID oder Name'), query: S('Suchbegriff (optional)'), category: S('Kategorie (optional)') }, ['id'], async ({ id, query, category }) => {
      const s = find(mc.list(), id, 'Minecraft-Server');
      const r = await mc.market.search(s.id, { q: query || '', category: category || '', sort: query ? 'relevance' : 'downloads' });
      return clip(r.hits.slice(0, 10).map((p) => ({ source: p.source, projectId: p.id, name: p.title, beschreibung: p.description, downloads: p.downloads, aktualisiert: String(p.updated || '').slice(0, 10), installiert: p.installed ? p.installed.version || true : false })));
    }, { risk: 'read' });
    add('mc_plugin_info', 'mc', 'Details zu einem Plugin aus dem Marktplatz: Beschreibung, passende Versionen, Links.', { id: S('Server-ID oder Name'), source: S('modrinth oder hangar'), projectId: S('ID aus mc_plugin_search') }, ['id', 'source', 'projectId'], async ({ id, source, projectId }) => {
      const s = find(mc.list(), id, 'Minecraft-Server');
      const d = await mc.market.detail(s.id, source, projectId);
      return clip({ name: d.title, autor: d.author, downloads: d.downloads, lizenz: d.license, beschreibung: d.body.slice(0, 2500), empfohlen: d.recommended, versionen: d.versions.slice(0, 8).map((v) => ({ id: v.id, nummer: v.number, passt: v.fits, typ: v.type, datum: String(v.date || '').slice(0, 10) })), links: d.links });
    }, { risk: 'read' });
    add('mc_plugin_install', 'mc', 'Plugin aus dem Marktplatz installieren (source + projectId aus mc_plugin_search; ohne version = empfohlene passende Version).', { id: S('Server-ID oder Name'), source: S('modrinth oder hangar'), projectId: S('Projekt-ID'), version: S('Versions-ID (optional)'), name: S('Plugin-Name für die Anzeige') }, ['id', 'projectId'], async ({ id, source, projectId, version }) => {
      const s = find(mc.list(), id, 'Minecraft-Server');
      const r = await mc.market.install(s.id, { source: source === 'hangar' ? 'hangar' : 'modrinth', id: projectId, version }).promise;
      return `Installiert: ${r.title} ${r.version} (${r.file}).${r.needsRestart ? ' Wirkt nach einem Neustart des Servers (oder per Live-Update).' : ''}`;
    }, { risk: 'change', timeout: 240000, describe: ({ id, name, projectId, source }) => L(`Plugin „${name || projectId}“ (${source === 'hangar' ? 'Hangar' : 'Modrinth'}) auf ${id} installieren`, `Install plugin “${name || projectId}” (${source === 'hangar' ? 'Hangar' : 'Modrinth'}) on ${id}`) });

    // Modpacks
    add('mc_modpack_updates', 'mc', 'Neuere Versionen des Modpacks eines Servers (mit Minecraft-Version und Änderungen).', { id: S('Server-ID oder Name') }, ['id'], async ({ id }) => {
      const s = find(mc.list(), id, 'Minecraft-Server');
      if (!s.modpack) return L(`${s.name} wurde nicht aus einem Modpack erstellt.`, `${s.name} was not created from a modpack.`);
      const u = await mc.modpackUpdates(s.id);
      return clip({ installiert: u.current, neuer: u.versions.slice(0, 5).map((v) => ({ id: v.id, version: v.number, minecraft: v.mc, mcWechsel: v.mcChange, datum: v.date.slice(0, 10), aenderungen: v.changelog.slice(0, 400) })) });
    }, { risk: 'read' });
    add('mc_modpack_update', 'mc', 'Modpack eines Servers auf eine neuere Version bringen (stoppt, sichert, aktualisiert, startet wieder).', { id: S('Server-ID oder Name'), versionId: S('Versions-ID aus mc_modpack_updates') }, ['id', 'versionId'], async ({ id, versionId }) => { const s = find(mc.list(), id, 'Minecraft-Server'); const r = await mc.updateModpack(s.id, { versionId }).promise; return L(`Modpack auf ${r.version} aktualisiert.`, `Modpack updated to ${r.version}.`); },
      { risk: 'change', describe: ({ id, versionId }) => `${L('Modpack aktualisieren (mit Sicherung)', 'Update modpack (with backup)')}: ${id} → ${versionId}` });

    },
  };
}

module.exports = { minecraftAi };
