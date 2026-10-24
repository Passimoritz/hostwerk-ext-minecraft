import { useEffect, useRef, useState } from 'react';
import { tr, pl } from '@hostwerk/kit';
import { Store, Box, TerminalSquare, Settings2, FileCog, FolderOpen, Puzzle, Users, Archive, ArrowUpCircle, Copy, Skull, Search, Download, Trash2, Upload, RotateCcw, Shield, Ban, UserPlus, Crown, Gauge, Save, Plus, ExternalLink, RefreshCw, LayoutDashboard, Globe2, Map as MapIcon, CalendarClock, Zap, Network, BarChart3, Power, Info, History, Bug, Package, SlidersHorizontal, Wrench } from 'lucide-react';
import { useStore, get, post, put, del, api, apiUrl, useApi, useLogs, fmtBytes, fmtDate, fmtNumber, isElectron, waitJob, mcCount, pickFolder, openExternal } from '@hostwerk/api';
import { Btn, Tabs, Field, Switch, SettingRow, Seg, Empty, Loading, Callout, StatusPill, DropZone, Modal, toast, confirmDialog, promptDialog, InfoTip, PathInput, TileEmpty, SettingsLayout, SaveBar, SideSheet } from '@hostwerk/ui';
import { ServiceButtons, ProcStats, SvcShortcut } from '@hostwerk/kit';
import { FavMark, FavButton, favSort, favMenuItem } from '@hostwerk/kit';
import { Console } from '@hostwerk/kit';
import FileBrowser from '@hostwerk/files';
import Editor from '@hostwerk/editor';
import { VersionPicker } from './Minecraft';
import { OverviewTab, WorldsTab, MapTab, AutomationTab } from './MinecraftExtras';
import { ErrorHelp } from '@hostwerk/kit';
import { CompareButton, NotesButton } from '@hostwerk/kit';
import { SafeUpgradeCard, PluginSourcesCard } from './McUpgrade';
import MarketTab from './McMarket';
import { NetworkTab, ClientPackCard, ModpackCard } from './McNetwork';
import { PlayerButtons, PlayerPick, usePlayerLists, usePlayerContext, StatsTab } from './McPlayers';
import { DatapacksTab, OldLogsTab, CrashTab, ServerToolsTab, PluginFormsTab } from './McTools';
import { SvcImage, LazyImg, PlayerHead } from '@hostwerk/kit';
import { SourceLink } from '@hostwerk/kit';
import { useExtContrib, ExtTabView } from '@hostwerk/kit';
import { contextMenu } from '@hostwerk/kit';
import { ExtSections } from '@hostwerk/kit';
import { useSelection, SelectBox, SelectAll, BulkBar } from '@hostwerk/kit';
import { BedrockOverview, BedrockConsole, BedrockSettings, BedrockPlayers, BedrockWorlds, BedrockVersion, isBedrock } from './McBedrock';

const COMMANDS = ['list', 'say ', 'op ', 'deop ', 'kick ', 'ban ', 'pardon ', 'whitelist add ', 'whitelist remove ', 'whitelist on', 'whitelist off', 'gamemode creative ', 'gamemode survival ', 'time set day', 'time set night', 'weather clear', 'difficulty ', 'save-all', 'tps', 'plugins', 'reload confirm', 'stop', 'tp ', 'give ', 'kill ', 'gamerule '];

function ConsoleTab({ s }) {
  const [lines] = useLogs(`mc:${s.id}`, `/mc/servers/${s.id}/logs`);
  const running = s.proc.state === 'running';
  const cmd = (c) => post(`/mc/servers/${s.id}/command`, { command: c }).catch((e) => toast.error(e.message));
  const players = s.proc.extra.players || [];
  const lists = usePlayerLists(s);
  const ctxFor = usePlayerContext(s, lists, players);
  return (
    <div className="grid mc-fit-grid mc-console-grid">
      <div className="mc-console-wrap"><Console lines={lines} height="100%" onCommand={running ? cmd : null} onClear={() => del(`/logs/mc:${s.id}`)} suggestions={COMMANDS} placeholder="Befehl ohne / eingeben, z. B. „say Hallo“" /></div>
      <div className="stack mc-col">
        {running && (
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <div className="row-tight">{s.proc.extra.tps != null && <span className="badge"><Gauge size={11} /> {s.proc.extra.tps} TPS</span>}<span className="grow" /><Btn className="ghost xs" icon={Skull} title="Nur wenn der Server hängt – ungespeicherte Weltdaten gehen verloren" onClick={async () => { if (await confirmDialog({ title: 'Prozess hart beenden?', text: 'Nur nutzen, wenn der Server hängt – ungespeicherte Weltdaten gehen verloren.', confirm: 'Hart beenden', danger: true })) await post(`/mc/servers/${s.id}/kill`); }}>Hart beenden</Btn></div>
            <ProcStats proc={s.proc} svc={`mc:${s.id}`} compact />
          </div>
        )}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="label">Verbinden</div>
          {[s.address.local, ...s.address.lan].map((a) => (
            <div key={a} className="row-tight"><code className="grow ellipsis">{a}</code><button className="btn ghost xs icon" title="Kopieren" aria-label="Kopieren" onClick={() => { navigator.clipboard.writeText(a); toast.success('Adresse kopiert'); }}><Copy /></button></div>
          ))}
          <div className="tiny muted">Für Freunde außerhalb deines Netzwerks musst du Port {s.port} im Router weiterleiten.</div>
        </div>
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="label">Spieler online ({players.length})</div>
          {players.length === 0 ? <span className="small muted">{running ? 'Niemand online.' : 'Server ist gestoppt.'}</span> : players.map((p) => (
            <div key={p} className="row-tight" onContextMenu={ctxFor(p)}>
              <span className="player grow"><PlayerHead name={p} />{p}{lists.isOp(p) && <Crown size={11} className="mc-op-badge" />}</span>
              <PlayerButtons s={s} name={p} lists={lists} online={players} />
            </div>
          ))}
        </div>
        {running && (
          <div className="card card-pad stack" style={{ gap: 6 }}>
            <div className="label">Schnellbefehle</div>
            <div className="row" style={{ gap: 6 }}>
              {[['Tag', 'time set day'], ['Nacht', 'time set night'], ['Klar', 'weather clear'], ['Speichern', 'save-all'], ['Spielerliste', 'list']].map(([l, c]) => <button key={c} className="btn xs" onClick={() => cmd(c)}>{l}</button>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * server.properties als Katalog: Bereich → Felder mit Erklärung. type: 'text' | 'number' | 'bool' | 'password' | [Optionen].
 * Unbekannte Schlüssel bleiben in der Datei erhalten (Reihenfolge und Kommentare auch) – „Alle Eigenschaften“ zeigt sie.
 */
const PROP_GROUPS = [
  { id: 'allgemein', label: 'Allgemein', icon: Settings2, fields: [
    ['motd', 'Beschreibung (MOTD)', 'text', 'Text in der Serverliste. Farben mit § oder \\u00A7, Zeilenumbruch mit \\n.', 2],
    ['server-port', 'Port', 'number', 'Spieler verbinden sich über diesen Port (Standard 25565).'],
    ['max-players', 'Max. Spieler', 'number', 'Wie viele Spieler gleichzeitig online sein dürfen.'],
    ['online-mode', 'Online-Modus', 'bool', 'Nur gekaufte Accounts dürfen joinen. Aus = Offline-/Cracked-Accounts (Spieler-IDs ändern sich!).'],
    ['white-list', 'Whitelist', 'bool', 'Nur freigeschaltete Spieler dürfen joinen (Liste unter „Spieler“).'],
    ['enforce-whitelist', 'Whitelist streng', 'bool', 'Spieler, die von der Whitelist fliegen, werden sofort gekickt.'],
    ['player-idle-timeout', 'Inaktive kicken (Min.)', 'number', '0 = nie. Spieler ohne Bewegung werden nach dieser Zeit getrennt.'],
    ['enable-status', 'In der Serverliste sichtbar', 'bool', 'Aus = der Server antwortet nicht auf Serverlisten-Anfragen.'],
    ['hide-online-players', 'Spielerliste verbergen', 'bool', 'In der Serverliste werden keine Spielernamen gezeigt.'],
    ['pause-when-empty-seconds', 'Pause ohne Spieler (s)', 'number', 'Ab 1.21.2: Ticks anhalten, wenn so lange niemand online ist (spart CPU). 0 = aus.'],
  ] },
  { id: 'welt', label: 'Welt & Spiel', icon: Globe2, fields: [
    ['level-name', 'Weltordner', 'text', 'Name des Weltordners. Ändern lädt eine andere (oder neue) Welt.'],
    ['level-seed', 'Seed', 'text', 'Nur bei neuer Welt wirksam. Leer = zufällig.'],
    ['level-type', 'Welttyp', ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'], 'Nur bei neuer Welt wirksam.'],
    ['gamemode', 'Spielmodus', ['survival', 'creative', 'adventure', 'spectator'], 'Modus für neue Spieler.'],
    ['force-gamemode', 'Spielmodus erzwingen', 'bool', 'Spieler starten bei jedem Join im Standard-Spielmodus.'],
    ['difficulty', 'Schwierigkeit', ['peaceful', 'easy', 'normal', 'hard'], ''],
    ['hardcore', 'Hardcore', 'bool', 'Bei Tod Zuschauermodus – lässt sich für bestehende Spieler nicht zurücknehmen.'],
    ['pvp', 'PvP', 'bool', 'Spieler können sich gegenseitig Schaden zufügen.'],
    ['allow-nether', 'Nether erlauben', 'bool', 'Aus = Netherportale funktionieren nicht.'],
    ['generate-structures', 'Strukturen erzeugen', 'bool', 'Dörfer, Tempel, Festungen … (nur neue Chunks).'],
    ['spawn-protection', 'Spawn-Schutz (Blöcke)', 'number', 'Radius um den Spawn, in dem nur Operatoren bauen dürfen. 0 = aus.'],
    ['max-world-size', 'Max. Weltgröße (Radius)', 'number', 'Weltgrenze in Blöcken vom Zentrum (Standard 29999984).'],
    ['allow-flight', 'Fliegen erlauben', 'bool', 'Verhindert Kicks durch Flug-Mods/Plugins im Überlebensmodus.'],
    ['spawn-monsters', 'Monster', 'bool', 'Feindliche Kreaturen spawnen (ältere Versionen; neuer: Spielregel).'],
  ] },
  { id: 'leistung', label: 'Leistung', icon: Gauge, fields: [
    ['view-distance', 'Sichtweite (Chunks)', 'number', 'Wie weit Spieler sehen. Größter Einfluss auf RAM und CPU – 8–10 ist ein guter Wert.'],
    ['simulation-distance', 'Simulationsweite (Chunks)', 'number', 'Wie weit Kreaturen/Pflanzen aktiv sind. Kleiner als die Sichtweite spart viel.'],
    ['max-tick-time', 'Max. Tick-Zeit (ms)', 'number', 'Dauert ein Tick länger, hält der Wächter den Server für abgestürzt. -1 = aus (bei großen Welten nützlich).'],
    ['network-compression-threshold', 'Netzwerk-Kompression ab (Byte)', 'number', 'Pakete ab dieser Größe werden komprimiert. -1 = nie, 0 = alles.'],
    ['entity-broadcast-range-percentage', 'Kreaturen-Sichtweite (%)', 'number', 'Wie weit Spieler Kreaturen sehen (10–1000).'],
    ['sync-chunk-writes', 'Chunks synchron schreiben', 'bool', 'Sicherer bei Abstürzen, etwas langsamer. Aus = schneller.'],
    ['max-chained-neighbor-updates', 'Max. Block-Updates in Folge', 'number', 'Schutz vor Lag-Maschinen (Standard 1000000).'],
    ['use-native-transport', 'Native Netzwerkbibliothek', 'bool', 'Linux: schnellere Netzwerkverarbeitung (Epoll).'],
    ['region-file-compression', 'Weltdatei-Kompression', ['deflate', 'lz4', 'none'], 'lz4 = schneller, etwas größer (ab 1.20.5).'],
  ] },
  { id: 'technik', label: 'Technik', icon: TerminalSquare, fields: [
    ['enable-command-block', 'Befehlsblöcke', 'bool', 'Befehlsblöcke aktivieren.'],
    ['function-permission-level', 'Rechte für Funktionen', ['1', '2', '3', '4'], 'Rechtestufe, mit der Datenpaket-Funktionen laufen.'],
    ['op-permission-level', 'Operator-Stufe', ['1', '2', '3', '4'], '4 = alle Befehle inkl. /stop.'],
    ['enable-query', 'Query-Protokoll', 'bool', 'Serverinfos über UDP abrufbar (für Statusseiten).'],
    ['query.port', 'Query-Port', 'number', ''],
    ['enable-rcon', 'RCON', 'bool', 'Fernsteuerung per Konsole über TCP. Nur mit Passwort und nie offen ins Internet!'],
    ['rcon.port', 'RCON-Port', 'number', ''],
    ['rcon.password', 'RCON-Passwort', 'password', ''],
    ['enable-jmx-monitoring', 'JMX-Überwachung', 'bool', 'Für Java-Monitoring-Werkzeuge.'],
    ['log-ips', 'IP-Adressen protokollieren', 'bool', 'Aus = Spieler-IPs erscheinen nicht im Protokoll (Datenschutz).'],
    ['prevent-proxy-connections', 'Proxy-Verbindungen blockieren', 'bool', 'Verbindungen über VPN/Proxy ablehnen (Mojang-Prüfung).'],
    ['accepts-transfers', 'Transfers annehmen', 'bool', 'Spieler dürfen per /transfer von anderen Servern hierher geschickt werden (1.20.5+).'],
    ['bug-report-link', 'Link für Fehlerberichte', 'text', 'Wird Spielern im Pause-Menü gezeigt (1.21+).'],
  ] },
  { id: 'paket', label: 'Ressourcenpaket', icon: Puzzle, fields: [
    ['resource-pack', 'Ressourcenpaket-URL', 'text', 'Direkter Link zur ZIP. Spieler werden beim Join gefragt.', 2],
    ['resource-pack-sha1', 'SHA-1-Prüfsumme', 'text', 'Optional, verhindert veraltete Zwischenspeicher.', 2],
    ['resource-pack-prompt', 'Hinweistext', 'text', 'Text im Dialog beim Join.', 2],
    ['require-resource-pack', 'Paket erzwingen', 'bool', 'Wer ablehnt, wird getrennt.'],
    ['resource-pack-id', 'Paket-ID (UUID)', 'text', 'Optional (1.20.3+).'],
  ] },
  { id: 'chat', label: 'Chat & Sonstiges', icon: Users, fields: [
    ['enforce-secure-profile', 'Signierte Chatnachrichten', 'bool', 'Spieler ohne Mojang-Signatur dürfen nicht joinen. Aus = auch bei Problemen mit Chat-Reports.'],
    ['broadcast-console-to-ops', 'Konsolenbefehle an OPs', 'bool', 'Operatoren sehen Befehle, die über die Konsole laufen.'],
    ['broadcast-rcon-to-ops', 'RCON-Befehle an OPs', 'bool', ''],
    ['text-filtering-config', 'Chat-Filter-Konfiguration', 'text', 'Pfad zu einer Filter-Datei (selten nötig).', 2],
    ['initial-enabled-packs', 'Datenpakete (Start)', 'text', 'Komma-getrennt, nur bei neuer Welt.', 2],
    ['initial-disabled-packs', 'Datenpakete aus (Start)', 'text', '', 2],
  ] },
];
const BOOL = (v) => v === 'true';

function SettingsTab({ s }) {
  const props = useApi(`/mc/servers/${s.id}/properties`, [], { live: false });
  const [p, setP] = useState(null);
  const [orig, setOrig] = useState(null);
  const [group, setGroup] = useState('run'); // links die Gruppen, rechts genau eine – unten EIN Speichern für alles
  const [cfg, setCfg] = useState({ memMin: s.memMin, memMax: s.memMax, javaMajor: s.javaMajor, jvmFlags: s.jvmFlags, extraArgs: s.extraArgs || '', autostart: s.autostart, autoRestart: s.autoRestart, name: s.name, javaPath: s.javaPath || '', autoCheck: s.autoCheck !== false, autoPluginUpdates: s.autoPluginUpdates !== false, autoServerUpdates: s.autoServerUpdates !== false });
  const cfg0 = useRef(null);
  if (!cfg0.current) cfg0.current = cfg;
  const [cfgOrig, setCfgOrig] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const sys = useApi('/mc/system');
  useEffect(() => { if (props.data) { setP(props.data); setOrig(props.data); } }, [props.data]);
  if (!p) return <Loading />;
  const running = s.proc.state === 'running';
  const changed = Object.keys(p).filter((k) => p[k] !== (orig || {})[k]);
  const saveProps = async () => {
    const patch = {}; for (const k of changed) patch[k] = p[k];
    try { const r = await put(`/mc/servers/${s.id}/properties`, patch); setP(r); setOrig(r); toast.success(`${changed.length} Einstellung${changed.length === 1 ? '' : 'en'} gespeichert` + (running ? ' – wirkt nach Neustart' : '')); } catch (e) { toast.error(e.message); }
  };
  const base = cfgOrig || cfg0.current; // Stand beim Öffnen bzw. nach dem letzten Speichern
  const cfgChanged = Object.keys(cfg).filter((k) => cfg[k] !== base[k]);
  const saveCfg = async () => { await put(`/mc/servers/${s.id}`, cfg); setCfgOrig({ ...cfg }); };
  // Ein Speichern für beide Teile (Start/Leistung und server.properties)
  const saveAll = async () => {
    setBusy(true);
    try {
      if (cfgChanged.length) await saveCfg();
      if (changed.length) await saveProps(); else toast.success('Gespeichert' + (running ? ' – wirkt nach Neustart' : ''));
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const reset = () => { setP(orig); setCfg({ ...cfg, ...base }); };
  const g = PROP_GROUPS.find((x) => x.id === group) || PROP_GROUPS[0];
  const needle = q.trim().toLowerCase();
  const fields = needle ? PROP_GROUPS.flatMap((x) => x.fields.filter(([k, l, , h]) => `${k} ${l} ${h || ''}`.toLowerCase().includes(needle))) : g.fields;
  const known = new Set(PROP_GROUPS.flatMap((x) => x.fields.map(([k]) => k)));
  const other = Object.keys(p).filter((k) => !known.has(k)).length;
  const field = ([k, label, type, hint, span]) => {
    const dirty = p[k] !== (orig || {})[k];
    const val = p[k] ?? '';
    if (type === 'bool') return <SettingRow key={k} title={<>{label}{dirty && <span className="badge warn" style={{ marginLeft: 6 }}>geändert</span>}</>} text={hint || k}><Switch checked={BOOL(val)} onChange={(v) => setP({ ...p, [k]: v ? 'true' : 'false' })} /></SettingRow>;
    return (
      <Field key={k} label={<>{label}{dirty && <span className="badge warn" style={{ marginLeft: 6 }}>geändert</span>}</>} hint={hint || k} className={span === 2 ? 'span-2' : ''}>
        {Array.isArray(type)
          ? <select className="select" value={val} onChange={(e) => setP({ ...p, [k]: e.target.value })}>{!type.includes(val) && <option value={val}>{val || '(nicht gesetzt)'}</option>}{type.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : <input className={`input ${type === 'number' ? 'mono' : ''}`} type={type === 'password' ? 'password' : type} value={val} placeholder={type === 'number' ? '' : '(nicht gesetzt)'} onChange={(e) => setP({ ...p, [k]: e.target.value })} />}
      </Field>
    );
  };
  const dirty = changed.length + cfgChanged.length;
  const groups = [
    { id: 'run', label: 'Speicher & Java', icon: Gauge, badge: cfgChanged.filter((k) => !AUTO_KEYS.includes(k)).length || null },
    { id: 'auto', label: 'Automatik', icon: RefreshCw, badge: cfgChanged.filter((k) => AUTO_KEYS.includes(k)).length || null },
    ...PROP_GROUPS.map((x) => ({ id: x.id, label: x.label, icon: x.icon, badge: x.fields.filter(([k]) => changed.includes(k)).length || null })),
    { id: 'raw', label: 'Alle Eigenschaften', icon: FileCog },
  ];
  return (
    <>
    <SettingsLayout label={tr('Server-Einstellungen')} value={needle ? '' : group} onChange={(v) => { setQ(''); setGroup(v); }} groups={groups}
      top={<div className="input-icon"><Search /><input className="input sm" placeholder="Einstellung suchen …" aria-label={tr('Einstellung suchen')} value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
      {group === 'run' && !needle && (
        <div className="card">
          <div className="card-head"><Gauge size={16} /><h3>Speicher &amp; Java</h3></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Name" className="span-2"><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
              <Field label={`Max. RAM: ${(cfg.memMax / 1024).toFixed(1).replace('.', ',')} GB`} className="span-2" hint={sys.data ? `PC: ${fmtBytes(sys.data.totalMem)} gesamt, ${fmtBytes(sys.data.freeMem)} frei. Faustregel: 2–4 GB für kleine Server, 6–10 GB mit vielen Plugins/Mods.` : ''}>
                <input className="range" type="range" min={1024} max={sys.data ? Math.max(2048, Math.floor(sys.data.totalMem / 1048576 / 512) * 512) : 16384} step={512} value={cfg.memMax} onChange={(e) => setCfg({ ...cfg, memMax: Number(e.target.value) })} />
              </Field>
              <Field label="Start-RAM (MB)" hint="Reserviert beim Start. Gleich wie Max. = weniger Ruckler."><input className="input" type="number" value={cfg.memMin} onChange={(e) => setCfg({ ...cfg, memMin: Number(e.target.value) })} /></Field>
              <Field label="Java-Version" hint={`Empfohlen für ${s.version}: Java ${s.javaMajor}`}><select className="select" value={cfg.javaMajor} onChange={(e) => setCfg({ ...cfg, javaMajor: Number(e.target.value) })}>{[25, 21, 17, 16, 11, 8].map((j) => <option key={j} value={j}>Java {j}</option>)}</select></Field>
              <Field label="JVM-Optimierung" hint="Aikar-Flags = bewährte Einstellungen für den Speicher-Müllsammler."><select className="select" value={cfg.jvmFlags} onChange={(e) => setCfg({ ...cfg, jvmFlags: e.target.value })}><option value="aikar">Aikar-Flags (empfohlen)</option><option value="none">Keine</option></select></Field>
              <Field label="Zusätzliche JVM-Argumente"><input className="input mono" placeholder="-Dfile.encoding=UTF-8" value={cfg.extraArgs} onChange={(e) => setCfg({ ...cfg, extraArgs: e.target.value })} /></Field>
              <Field label="Eigener Java-Pfad (optional)" className="span-2" hint="Überschreibt die automatisch verwaltete Java-Version."><PathInput title="java.exe wählen" filters={[{ name: 'Java', extensions: ['exe'] }]} placeholder="C:\Program Files\Java\...\bin\java.exe" value={cfg.javaPath} onChange={(v) => setCfg({ ...cfg, javaPath: v })} /></Field>
            </div>
          </div>
        </div>
      )}
      {group === 'auto' && !needle && (
        <div className="card">
          <div className="card-head"><RefreshCw size={16} /><h3>{tr('Automatik')}</h3></div>
          <div className="card-body">
            <SettingRow title="Mit Hostwerk starten" text="Server startet automatisch, wenn Hostwerk geöffnet wird."><Switch checked={cfg.autostart} onChange={(v) => setCfg({ ...cfg, autostart: v })} /></SettingRow>
            <SettingRow title="Nach Absturz neu starten" text="Höchstens 3 Neustarts in 5 Minuten."><Switch checked={cfg.autoRestart} onChange={(v) => setCfg({ ...cfg, autoRestart: v })} /></SettingRow>
            {!['custom', 'vanilla'].includes(s.type) && !s.modpack && <SettingRow title="Server-Software automatisch aktualisieren" text="Neue Builds derselben Minecraft-Version (z. B. Paper-Fehlerbehebungen) einspielen, sobald der Server gestoppt ist. Die alte Datei bleibt als server.jar.alt. Neue Minecraft-Versionen werden nur angeboten."><Switch checked={cfg.autoServerUpdates} onChange={(v) => setCfg({ ...cfg, autoServerUpdates: v })} /></SettingRow>}
            {s.content !== 'mods' && <SettingRow title="Plugins automatisch aktualisieren" text="Neue Versionen von Plugins mit bekannter Quelle (Modrinth, Hangar, GitHub …) einspielen, sobald sie zur Minecraft-Version passen. Läuft der Server, wirken sie nach dem nächsten Neustart."><Switch checked={cfg.autoPluginUpdates} onChange={(v) => setCfg({ ...cfg, autoPluginUpdates: v })} /></SettingRow>}
            <SettingRow title="Nach jedem Start prüfen" text="Server-Prüfung (Plugins, Fehler, TPS, Erreichbarkeit) läuft automatisch, sobald der Server bereit ist – Ergebnis unter Zeitplan & Prüfung."><Switch checked={cfg.autoCheck} onChange={(v) => setCfg({ ...cfg, autoCheck: v })} /></SettingRow>
          </div>
        </div>
      )}
      {group === 'raw' && !needle && <RawProps s={s} onSaved={props.reload} />}
      {(needle || !['run', 'auto', 'raw'].includes(group)) && (
        <div className="card">
          <div className="card-head"><Settings2 size={16} /><h3>{needle ? tr('Suchergebnis') : g.label}</h3><span className="tiny muted">server.properties</span></div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {fields.length === 0 && <TileEmpty icon={Search} text="Nichts gefunden – „Alle Eigenschaften“ zeigt die ganze Datei." />}
            <div className="form-grid">{fields.filter((x) => x[2] !== 'bool').map(field)}</div>
            <div>{fields.filter((x) => x[2] === 'bool').map(field)}</div>
            {group === 'allgemein' && !needle && <InfoTip inline>Server-Symbol und Vorschau in der Serverliste: Übersicht → „So sehen Spieler deinen Server“.</InfoTip>}
            {other > 0 && !needle && group === 'chat' && <div className="tiny muted">{other} weitere Schlüssel in der Datei – unter „Alle Eigenschaften“.</div>}
          </div>
        </div>
      )}
    </SettingsLayout>
    <SaveBar dirty={dirty > 0} busy={busy} onSave={saveAll} onReset={reset} text={pl(dirty, 'ungespeicherte Änderung', 'ungespeicherte Änderungen') + (running ? ` – ${tr('wirkt nach einem Neustart')}` : '')} />
    </>
  );
}

function RawProps({ s, onSaved }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  return (
    <div className="card">
      <div className="card-head"><Settings2 size={16} /><h3>Alle Eigenschaften</h3><div className="right"><Btn className="sm" onClick={async () => { setFile(await get(`/files/read?root=${encodeURIComponent('mc:' + s.id)}&path=server.properties`)); setOpen(true); }}>server.properties im Editor</Btn></div></div>
      {open && file && (
        <Modal title="server.properties" size="xwide" onClose={() => setOpen(false)} footer={<><Btn onClick={() => setOpen(false)}>Abbrechen</Btn><Btn className="primary" onClick={async () => { await put('/files/write', { root: 'mc:' + s.id, path: 'server.properties', content: file.content, mtime: file.mtime }); toast.success('Gespeichert'); setOpen(false); onSaved(); }}>Speichern</Btn></>}>
          <div style={{ height: '100%', minHeight: 400, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}><Editor value={file.content} lang="properties" onChange={(v) => setFile({ ...file, content: v })} /></div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Plugin-Live-Update */
const LIVE_MODES = [
  { id: 'auto', label: 'Automatisch', hint: 'Ohne Neustart, wenn es sicher geht – sonst Neustart mit Countdown.' },
  { id: 'hot', label: 'Ohne Neustart', hint: 'Immer live austauschen (Hot-Reload). Geht es nicht, gibt es eine Fehlermeldung.' },
  { id: 'restart', label: 'Mit Neustart', hint: 'JAR austauschen und Server neu starten – immer sauber, kurz offline.' },
];

function LiveUpdateCard({ s }) {
  const st = useApi(`/mc/servers/${s.id}/live-update`);
  const [script, setScript] = useState(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { const h = (e) => { if (!e.detail || e.detail.id === s.id) st.reload(); }; window.addEventListener('hw:mc-plugins', h); return () => window.removeEventListener('hw:mc-plugins', h); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = st.data;
  if (!d) return <div className="card"><Loading /></div>;
  if (!d.supported) return null;
  const save = async (patch) => { try { st.setData(await put(`/mc/servers/${s.id}/live-update`, patch)); } catch (e) { toast.error(e.message); } };
  const running = s.proc.state === 'running';
  const deployFiles = async (files) => {
    const f = files[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await api('POST', `/mc/servers/${s.id}/deploy`, fd);
      const j = await waitJob(r.job);
      toast.success(j.result.text);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const addProject = async (install) => {
    const dir = await pickFolder('Plugin-Projektordner wählen');
    if (!dir) return;
    try {
      if (install) setScript({ dir, ...(await post(`/mc/servers/${s.id}/live-update/script`, { dir })) });
      if (!d.watch.includes(dir)) await save({ watch: [...d.watch, dir] });
    } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><Zap size={16} /><h3>Plugin-Live-Update</h3>
        {d.enabled && <span className={`badge ${d.bridge.disabled ? 'err' : d.bridge.active ? 'ok' : ''}`} title="Hostwerk-Bridge im Server">{d.bridge.disabled ? 'Bridge abgeschaltet' : d.bridge.active ? 'Bridge aktiv' : running ? 'Bridge nach Neustart' : 'bereit'}</span>}
        <div className="right row-tight"><Switch checked={d.enabled} label="Plugin-Live-Update" onChange={(v) => save({ enabled: v })} /></div>
      </div>
      {!d.enabled ? (
        <div className="card-body stack" style={{ gap: 8 }}>
          {d.pausedByBridge && <Callout kind="warn" dismissible={false} title={d.bridge.disabled ? 'Ausgeschaltet, weil HostwerkBridge abgeschaltet ist' : 'Ausgeschaltet, weil HostwerkBridge fehlt'}>Sobald die Bridge wieder da und aktiv ist, schaltet sich Live-Update von selbst wieder ein. <Btn className="xs" onClick={async () => { try { await post(`/mc/servers/${s.id}/live-update/bridge`); st.reload(); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); } }}>{d.bridge.disabled ? 'Bridge einschalten' : 'Bridge installieren'}</Btn></Callout>}
          <div className="small muted">Neue Version deines Plugins einspielen, ohne selbst Dateien zu kopieren: die .jar hierher ziehen – Hostwerk tauscht sie im laufenden Server aus oder startet ihn mit Vorwarnung neu. Dafür kommt das kleine Helfer-Plugin „HostwerkBridge“ in den Server.</div>
          <div><Btn className="primary sm" icon={Zap} onClick={() => save({ enabled: true })}>Live-Update einschalten</Btn></div>
        </div>
      ) : (
        <div className="card-body stack" style={{ gap: 10 }}>
          {d.bridge.disabled && <Callout kind="warn" title="HostwerkBridge ist unter „Installiert“ abgeschaltet">Ohne Bridge geht kein Live-Austausch – Updates laufen nur per Neustart. <Btn className="xs" onClick={async () => { try { st.setData(await post(`/mc/servers/${s.id}/live-update/bridge`)); toast.success('Bridge wieder aktiv' + (running ? ' – nach dem nächsten Neustart' : '')); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); } }}>Bridge wieder einschalten</Btn></Callout>}
          {running && !d.bridge.active && !d.bridge.disabled && d.mode !== 'restart' && <div className="tiny muted">Die Bridge wird beim nächsten Neustart aktiv – bis dahin aktualisiert Hostwerk per Neustart.</div>}
          <DropZone onFiles={deployFiles} accept=".jar">
            <div className="small" style={{ textAlign: 'center', padding: 4 }}>{busy ? 'Wird eingespielt …' : <><b>Neue Plugin-.jar hierher ziehen</b> oder klicken zum Auswählen<div className="tiny muted" style={{ marginTop: 2 }}>{(LIVE_MODES.find((m) => m.id === d.mode) || LIVE_MODES[0]).hint}</div></>}</div>
          </DropZone>
          <div className="row-tight small">
            <button className="btn ghost xs" onClick={() => setMore(!more)}>{more ? 'Weniger' : 'Einstellungen & Projekte'}{d.watch.length ? ` (${d.watch.length})` : ''}</button>
            <span className="grow" /><span className="tiny muted">{(LIVE_MODES.find((m) => m.id === d.mode) || LIVE_MODES[0]).label}{d.mode !== 'hot' ? ` · Vorwarnung ${d.countdown ? d.countdown + ' s' : 'keine'}` : ''}</span>
          </div>
          {more && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><b className="small">Wie einspielen?</b><Seg value={d.mode} onChange={(v) => save({ mode: v })} options={LIVE_MODES.map((m) => ({ id: m.id, label: m.label, title: m.hint }))} />
                {d.mode !== 'hot' && <><span className="tiny muted">Vorwarnung bei Neustart</span><select className="select xs" value={d.countdown} onChange={(e) => save({ countdown: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n ? `${n} s` : 'keine'}</option>)}</select></>}
              </div>
              <div className="row" style={{ gap: 6 }}><b className="small grow">Plugin-Projekte (automatisch nach jedem Build)</b>
                <Btn className="xs" icon={FolderOpen} onClick={() => addProject(false)}>Ordner überwachen</Btn>
                <Btn className="xs primary" icon={TerminalSquare} onClick={() => addProject(true)}>Skript installieren</Btn>
              </div>
              {d.watch.length === 0 ? <div className="tiny muted">Hostwerk beobachtet build/libs/ (Gradle) bzw. target/ (Maven) und spielt jede neu gebaute JAR ein.</div> : d.watch.map((w) => (
                <div key={w} className="row-tight" style={{ padding: '2px 0' }}><code className="grow ellipsis small" title={w}>{w}</code><button className="btn ghost xs icon" title="Nicht mehr überwachen" onClick={() => save({ watch: d.watch.filter((x) => x !== w) })}><Trash2 /></button></div>
              ))}
              {script && <InfoTip title="Skript installiert"><div className="small">In <code>{script.dir}</code> angelegt: {script.files.join(', ')}.<br />Update einspielen: <code>{script.howto}</code></div></InfoTip>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/*
 * Abkürzung zum Ordner eines Plugins (plugins/<Name>/ mit config.yml und Daten; bei Mods config/<modid>/).
 * In der App öffnet ein Klick den Ordner im Explorer, sonst den Reiter „Dateien“ an dieser Stelle; Rechtsklick bietet beides.
 * Ohne eigenen Ordner führt der Knopf zum Ordner mit der JAR.
 */
function PluginFolderButton({ s, p, mods }) {
  const rel = p.dataDir || (mods ? 'mods' : 'plugins');
  const inFiles = () => { location.hash = `/mc/${encodeURIComponent(s.id)}/files?path=${encodeURIComponent(rel)}`; };
  const inExplorer = () => post('/app/open-path', { path: `${s.dir}/${rel}`.replace(/[\\/]+/g, '/') }).catch((e) => toast.error(e.message));
  const title = p.dataDir ? tr(`Ordner „${p.dataDir}“ öffnen (Einstellungen und Daten)`) : tr(`Kein eigener Ordner – zeigt ${rel}/ mit der JAR`);
  return (
    <button type="button" className={`btn ghost xs icon ${p.dataDir ? '' : 'faint'}`} title={title} aria-label={title}
      onClick={isElectron ? inExplorer : inFiles}
      onContextMenu={(e) => contextMenu(e, [{ label: tr('In Hostwerk öffnen (Dateien)'), icon: FileCog, onClick: inFiles }, isElectron && { label: tr('Im Explorer öffnen'), icon: ExternalLink, onClick: inExplorer }, { label: tr('Pfad kopieren'), icon: Copy, onClick: () => navigator.clipboard.writeText(`${s.dir}/${rel}`).then(() => toast.success(tr('Kopiert'))) }])}>
      <FolderOpen />
    </button>
  );
}

function PluginsTab({ s }) {
  const [find, setFind] = useState(false); // Seitenblatt „Plugin hinzufügen …“ – auf der Seite bleibt die Liste
  const list = useApi(`/mc/servers/${s.id}/plugins`);
  const hwPlugins = useApi(`/mc/servers/${s.id}/hostwerk-plugins`, [list.data], { live: false, poll: true });
  const missingHw = (hwPlugins.data || []).filter((p) => !p.installed);
  // Bridge gelöscht/abgeschaltet/zurück → Live-Update-Karte gleich neu lesen (schaltet sich dort selbst aus bzw. wieder ein)
  useEffect(() => { if (list.data) window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [updates, setUpdates] = useState(null);
  const [checking, setChecking] = useState(false);
  // Vorschläge laden im Hintergrund: ein langsamer/nicht erreichbarer Marktplatz ist kein Fehler-Pop-up, sondern ein leiser Hinweis
  const [searchError, setSearchError] = useState(null);
  const search = async (query = q, { quiet = false } = {}) => { setSearching(true); setSearchError(null); try { setResults(await get(`/mc/servers/${s.id}/modrinth?q=${encodeURIComponent(query)}`)); } catch (e) { if (quiet) setSearchError(e.message); else { setSearchError(e.message); toast.error(e.message); } } setSearching(false); };
  useEffect(() => { search('', { quiet: true }); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState(() => { try { return { sort: 'name', src: 'all', state: 'all', ...JSON.parse(localStorage.getItem('hw-mc-plugin-view') || '{}') }; } catch { return { sort: 'name', src: 'all', state: 'all' }; } });
  const [sel, setSel] = useState(() => new Set());
  const running = s.proc.state === 'running';
  // Mod-Server (Fabric, NeoForge, Forge): gleiche Seite, aber „Mods“ statt „Plugins“
  const mods = s.content === 'mods';
  const W = mods ? 'Mod' : 'Plugin';
  if (!s.pluginsSupported) return <Empty icon={Puzzle} title="Vanilla unterstützt keine Plugins" text="Wechsle unter „Version“ auf Paper oder Purpur, um Plugins zu nutzen – deine Welt bleibt erhalten." />;
  const upload = async (files) => {
    const fd = new FormData(); for (const f of files) fd.append('files', f);
    let r;
    try { r = await api('POST', `/mc/servers/${s.id}/plugins/upload?v=2`, fd); } catch (e) { toast.error(e.message); return; }
    list.setData(r.plugins);
    window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } }));
    // Je Datei sagen, was passiert ist: live geladen, wartet auf den nächsten Neustart oder Fehler
    const hot = r.placed.filter((x) => x.mode === 'hot').length;
    const queued = r.placed.filter((x) => x.mode === 'queued').length;
    for (const x of r.placed.filter((y) => y.mode === 'error')) toast.error(`${x.file}: ${x.text}`);
    if (hot) toast.success(tr(`${hot} ${W}(s) live geladen – ohne Neustart`));
    if (queued) toast(tr(`${queued} ${W}(s) warten auf den nächsten Neustart`));
    if (!hot && !queued && r.placed.some((x) => x.mode === 'copy')) toast.success(tr(`${W}(s) hochgeladen`));
  };
  const all = list.data || [];
  // Sortieren und filtern (gemerkt je Gerät): Name, Größe, zuletzt geändert; Quelle; nur abgeschaltete/pausierte
  const setV = (p) => setView((v) => { const n = { ...v, ...p }; try { localStorage.setItem('hw-mc-plugin-view', JSON.stringify(n)); } catch { /* egal */ } return n; });
  const srcOf = (p) => (p.origin ? p.origin.source : 'manual');
  const sources = [...new Set(all.map(srcOf))];
  const installed = all
    .filter((p) => view.src === 'all' || srcOf(p) === view.src)
    .filter((p) => view.state === 'all' || (view.state === 'off' ? !p.enabled : view.state === 'paused' ? !!(p.origin && p.origin.paused) : p.enabled))
    .sort((a, b) => (view.sort === 'size' ? (b.size || 0) - (a.size || 0) : view.sort === 'changed' ? (b.changedAt || 0) - (a.changedAt || 0) : String(a.name).localeCompare(String(b.name))));
  const SRC_LABEL = { modrinth: 'Modrinth', hangar: 'Hangar', github: 'GitHub', spigot: 'SpigotMC', jenkins: 'Jenkins', url: 'Link', project: 'Eigenes Projekt', hostwerk: 'Von Hostwerk', manual: 'Von Hand' };
  const checkUpdates = async () => {
    setChecking(true);
    try {
      const u = await get(`/mc/servers/${s.id}/plugins/updates`);
      setUpdates(Object.fromEntries(u.map((x) => [x.file, x])));
      const n = u.filter((x) => x.update).length;
      n ? toast(`${n} ${W}-Update${n > 1 ? 's' : ''} verfügbar`) : toast.success(mods ? 'Alle bekannten Mods sind aktuell.' : 'Alle bekannten Plugins sind aktuell.');
    } catch (e) { toast.error(e.message); }
    setChecking(false);
  };
  const runUpdate = async (file) => {
    const r = await post(`/mc/servers/${s.id}/plugins/update`, file ? { file } : {});
    try { const j = await waitJob(r.job); toast.success(`${j.result.updated} ${W}(s) aktualisiert${j.result.queued ? ` – ${j.result.queued} wartet auf den nächsten Stopp oder Neustart` : ''}`); list.reload(); setUpdates(null); } catch (e) { toast.error(e.message); }
  };
  const updCount = updates ? Object.values(updates).filter((x) => x.update).length : 0;
  // Mehrfachauswahl: mehrere Plugins auf einmal ab-/einschalten, aktualisieren oder entfernen
  const chosen = installed.filter((p) => sel.has(p.file));
  const pick = (file, on) => setSel((x) => { const n = new Set(x); if (on) n.add(file); else n.delete(file); return n; });
  const allPicked = installed.length > 0 && installed.every((p) => sel.has(p.file));
  const bulkToggle = async (enable) => {
    const todo = chosen.filter((p) => p.enabled !== enable && !(!enable && /^HostwerkBridge\.jar$/i.test(p.file)));
    let last = null;
    for (const p of todo) { try { last = await post(`/mc/servers/${s.id}/plugins/toggle`, { file: p.file }); } catch (e) { toast.error(`${p.name}: ${e.message}`); } }
    if (last) list.setData(last);
    if (enable) toast.success(running ? `${todo.length} eingeschaltet – wirkt nach einem Neustart` : `${todo.length} eingeschaltet`);
    else toast.success(running ? `${todo.length} abgeschaltet – wirkt nach einem Neustart` : `${todo.length} abgeschaltet`);
    window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } }));
  };
  const bulkRemove = async () => {
    const r = await confirmDialog({ title: `${chosen.length} ${W}s entfernen?`, text: chosen.map((p) => p.name).join(', '), confirm: 'Entfernen', danger: true, checkbox: mods ? null : { label: 'Auch die Konfigurationsordner unter plugins/ löschen (Einstellungen und Daten)', checked: false } });
    if (!(r && (r === true || r.ok))) return;
    let last = null;
    for (const p of chosen) { try { last = await del(`/mc/servers/${s.id}/plugins/${encodeURIComponent(p.file)}${r.checked ? `?config=${encodeURIComponent(p.name)}` : ''}`); } catch (e) { toast.error(`${p.name}: ${e.message}`); } }
    if (last) list.setData(last);
    setSel(new Set());
  };
  const bulkUpdate = async () => {
    const files = chosen.filter((p) => updates && updates[p.file] && updates[p.file].update).map((p) => p.file);
    if (!files.length) { toast('Für die Auswahl gibt es keine Updates – erst „Updates prüfen“.'); return; }
    const r = await post(`/mc/servers/${s.id}/plugins/update`, { files });
    try { const j = await waitJob(r.job); toast.success(`${j.result.updated} ${W}(s) aktualisiert${j.result.queued ? ` – ${j.result.queued} wartet auf den nächsten Stopp oder Neustart` : ''}`); list.reload(); setUpdates(null); } catch (e) { toast.error(e.message); }
  };
  // Links die installierten Plugins (Liste scrollt in der Box), rechts Live-Update, Hochladen und Quellen
  return (
    <div className="grid grid-2 mc-fit-grid mc-plugins-grid">
        <div className="card mc-scroll">
          <div className="card-head"><Puzzle size={16} /><h3>Installiert</h3><span className="badge">{installed.length === all.length ? all.length : `${installed.length} / ${all.length}`}</span>
            <div className="right row-tight"><Btn className="sm primary" icon={Plus} onClick={() => setFind(true)}>{mods ? 'Mod hinzufügen …' : 'Plugin hinzufügen …'}</Btn>
              {updCount > 0 && <Btn className="sm primary" icon={ArrowUpCircle} onClick={() => runUpdate(null)}>Alle {updCount} aktualisieren</Btn>}
              {installed.length > 0 && <Btn className="sm ghost" icon={RefreshCw} busy={checking} onClick={checkUpdates}>Updates prüfen</Btn>}
            </div>
          </div>
          {all.length > 3 && (
            <div className="plugin-tools">
              <Seg value={view.sort} onChange={(v) => setV({ sort: v })} options={[{ id: 'name', label: 'Name' }, { id: 'changed', label: 'Zuletzt geändert' }, { id: 'size', label: 'Größe' }]} />
              <select className="select sm" style={{ width: 'auto' }} value={view.src} onChange={(e) => setV({ src: e.target.value })} aria-label="Quelle">
                <option value="all">Alle Quellen</option>
                {sources.map((x) => <option key={x} value={x}>{SRC_LABEL[x] || x}</option>)}
              </select>
              <select className="select sm" style={{ width: 'auto' }} value={view.state} onChange={(e) => setV({ state: e.target.value })} aria-label="Zustand">
                <option value="all">Alle</option><option value="on">Eingeschaltet</option><option value="off">Abgeschaltet</option><option value="paused">Quelle pausiert</option>
              </select>
              {(view.src !== 'all' || view.state !== 'all') && <button type="button" className="btn ghost xs" onClick={() => setV({ src: 'all', state: 'all' })}>Filter zurücksetzen</button>}
            </div>
          )}
          {installed.length > 1 && (
            <div className="plugin-bulk">
              <label className="check small"><input type="checkbox" checked={allPicked} onChange={(e) => setSel(e.target.checked ? new Set(installed.map((p) => p.file)) : new Set())} />{chosen.length ? `${chosen.length} ausgewählt` : 'Alle auswählen'}</label>
              {chosen.length > 0 && <div className="row-tight right" style={{ flexWrap: 'wrap' }}>
                <Btn className="xs" onClick={() => bulkToggle(false)}>Abschalten</Btn>
                <Btn className="xs" onClick={() => bulkToggle(true)}>Einschalten</Btn>
                {updates && <Btn className="xs" icon={ArrowUpCircle} onClick={bulkUpdate}>Aktualisieren</Btn>}
                <Btn className="xs danger" icon={Trash2} onClick={bulkRemove}>Entfernen</Btn>
                <button type="button" className="link-btn tiny" onClick={() => setSel(new Set())}>Auswahl aufheben</button>
              </div>}
            </div>
          )}
          <div className="mc-scroll-body">
          {all.length > 0 && installed.length === 0 && <TileEmpty text="Kein Plugin passt zum Filter." />}
          {!list.data ? <Loading /> : all.length === 0 ? <div className="card-body muted small">{mods ? 'Noch keine Mods. Suche rechts auf Modrinth oder lade eine JAR hoch.' : 'Noch keine Plugins. Suche rechts auf Modrinth oder lade eine JAR hoch.'}</div> : installed.map((p) => (
            <div key={p.file} className={`list-item ${sel.has(p.file) ? 'selected' : ''}`} style={{ opacity: p.enabled ? 1 : 0.55 }}>
              {installed.length > 1 && <input type="checkbox" className="plugin-check" checked={sel.has(p.file)} onChange={(e) => pick(p.file, e.target.checked)} aria-label={`${p.name} auswählen`} />}
              {/* Eigenes Symbol aus der JAR (hostwerk-icon.png/.svg oder Mod-Logo), sonst Puzzleteil */}
              <div className="ico">{p.jarIcon ? <LazyImg src={apiUrl(p.jarIcon)} className="plugin-ico" title={`Symbol aus ${p.file}`} fallback={<Puzzle />} /> : <Puzzle />}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold">{p.name} <span className="muted small">{p.version}</span>{p.size != null && <span className="muted tiny" style={{ marginLeft: 6 }} title="Größe der JAR-Datei">{fmtBytes(p.size)}</span>}{p.changedAt && <span className="muted tiny" style={{ marginLeft: 6 }} title={p.prevVersion ? `Vorher: ${p.prevVersion}` : 'Wann diese Version bzw. JAR eingespielt wurde'}>{`· geändert ${fmtDate(p.changedAt)}`}</span>}
                  {p.origin && (p.origin.page
                    ? <button type="button" className={`src-chip src-${p.origin.source}`} title={`Quelle: ${p.origin.label} – Seite öffnen`} onClick={() => openExternal(p.origin.page)}>{p.origin.label}</button>
                    : <span className={`src-chip src-${p.origin.source}`} title={{ project: 'Aus deinem Projektordner – neue Builds erscheinen als Update', hostwerk: 'Gehört zu Hostwerk und wird mit Hostwerk aktualisiert' }[p.origin.source] || 'Ohne verknüpfte Quelle – unter „Weitere Quellen“ verknüpfen'}>{p.origin.label}</span>)}
                  {updates && updates[p.file] && updates[p.file].update && <span className="badge ok" style={{ marginLeft: 6 }}>Update: {updates[p.file].latest}</span>}
                  {updates && updates[p.file] && updates[p.file].pending && <span className="badge" style={{ marginLeft: 6 }} title={tr("Wartet – Hostwerk spielt die neue Version beim nächsten Stopp oder Neustart automatisch ein")}>{`${updates[p.file].pending} ${tr("wartet")}`}</span>}
                  {updates && updates[p.file] && !updates[p.file].known && <span className="badge" style={{ marginLeft: 6 }} title="Nicht auf Modrinth/Hangar – unten mit GitHub, SpigotMC, Jenkins oder Link verknüpfen">unbekannt</span>}
                {updates && updates[p.file] && updates[p.file].external && <span className="badge warn" style={{ marginLeft: 6 }} title="Download nur auf der Herstellerseite">extern</span>}
                </div>
                <div className="small muted ellipsis">{p.description || p.file}</div>
              </div>
              {updates && updates[p.file] && updates[p.file].update && <Btn className="xs" icon={ArrowUpCircle} onClick={() => runUpdate(p.file)}>Aktualisieren</Btn>}
              <PluginFolderButton s={s} p={p} mods={mods} />
              <Switch checked={p.enabled} onChange={async () => {
                if (p.enabled && /^HostwerkBridge\.jar$/i.test(p.file) && !(await confirmDialog({ title: 'HostwerkBridge abschalten?', text: 'Die Bridge ist Hostwerks Helfer-Plugin in diesem Server. Ohne sie funktionieren nicht mehr:\n\n• Plugin-Live-Update ohne Neustart (Hot-Reload) – Updates laufen dann nur noch per Neustart\n• Live-Status aus dem Server für Hostwerk\n\nDu kannst sie jederzeit wieder einschalten.', confirm: 'Trotzdem abschalten', danger: true }))) return;
                list.setData(await post(`/mc/servers/${s.id}/plugins/toggle`, { file: p.file }));
                if (running) toast('Wirkt nach einem Neustart.');
                window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } }));
              }} />
              <Btn className="ghost xs icon" icon={Trash2} title="Löschen" onClick={async () => { const r = await confirmDialog({ title: `${p.name} entfernen?`, text: mods ? 'Die Mod-JAR wird gelöscht. Einstellungen unter config/ bleiben erhalten.' : 'Die Plugin-JAR wird gelöscht.', confirm: 'Entfernen', danger: true, checkbox: mods ? null : { label: `Auch den Konfigurationsordner „plugins/${p.name}/“ löschen (Einstellungen und Daten des Plugins)`, checked: false } }); const ok = r && (r === true || r.ok); if (ok) list.setData(await del(`/mc/servers/${s.id}/plugins/${encodeURIComponent(p.file)}${r.checked ? `?config=${encodeURIComponent(p.name)}` : ''}`)); }} />
            </div>
          ))}
          </div>
        </div>
        <div className="stack mc-col">
        {!mods && !s.proxy && <LiveUpdateCard s={s} />}
        <DropZone accept=".jar" multiple onFiles={upload}><Upload size={22} /><div className="bold" style={{ marginTop: 6 }}>{W}-JAR hochladen</div><div className="small">Dateien hier ablegen oder klicken</div></DropZone>
        {running && <InfoTip>{mods ? 'Neue oder geänderte Mods werden erst nach einem Neustart des Servers geladen.' : 'Neue oder geänderte Plugins werden erst nach einem Neustart des Servers geladen – mit eingeschaltetem Plugin-Live-Update ohne Neustart.'}</InfoTip>}
        <PluginSourcesCard s={s} onChanged={() => { list.reload(); setUpdates(null); }} />
        {mods && <ClientPackCard s={s} />}
        </div>
      {find && <SideSheet size="wide" title={mods ? 'Mod hinzufügen' : 'Plugin hinzufügen'} subtitle={`Modrinth · passend zu ${s.typeLabel} ${s.version}`} onClose={() => setFind(false)}>
        <div className="row-tight"><a className="btn sm primary" href={`#/mc/${s.id}/market`}><Store size={14} />Zum Marktplatz</a></div>
        <div className="stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <div className="input-icon grow"><Search /><input className="input" placeholder={mods ? 'z. B. Lithium, Create, Terralith …' : 'z. B. LuckPerms, EssentialsX, WorldEdit …'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Btn className="primary" busy={searching} onClick={() => search()}>Suchen</Btn>
          </form>
          <div className="stack" style={{ gap: 10 }}>
            {missingHw.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="tiny bold muted">Hostwerk-Plugins</div>
                {missingHw.map((p) => (
                  <div key={p.id} className="plugin-card hw-own">
                    <LazyImg src={apiUrl(p.icon)} className="ph" fallback={<div className="ph" />} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row-tight"><b className="ellipsis">{p.name}</b>{p.version && <span className="tiny muted">{p.version}</span>}<span className="src-chip src-hostwerk">Von Hostwerk</span></div>
                      <div className="small muted">{p.disabled ? 'Ist installiert, aber abgeschaltet. ' : ''}{p.description}</div>
                    </div>
                    <Btn className="sm primary" icon={p.disabled ? Power : Plus} onClick={async () => { try { await post(`/mc/servers/${s.id}/live-update/bridge`); toast.success(`${p.name} ${p.disabled ? 'eingeschaltet' : 'installiert'}${running ? ' – wirkt nach dem nächsten Neustart' : ''}`); list.reload(); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); } }}>{p.disabled ? 'Einschalten' : 'Installieren'}</Btn>
                  </div>
                ))}
                <div className="tiny bold muted" style={{ marginTop: 4 }}>Modrinth</div>
              </div>
            )}
            {searchError && !results && <div className="row-tight small muted"><span className="grow">Der Marktplatz (Modrinth) ist gerade nicht erreichbar – installierte Plugins funktionieren weiter.</span><Btn className="xs" icon={RefreshCw} busy={searching} onClick={() => search(q, { quiet: true })}>Erneut versuchen</Btn></div>}
            {results && results.length === 0 && <div className="muted small">{mods ? 'Keine passenden Mods gefunden.' : 'Keine passenden Plugins gefunden.'}</div>}
            {(results || []).map((r) => (
              <div key={r.id} className="plugin-card">
                <LazyImg src={r.icon} className="ph" fallback={<div className="ph" />} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-tight"><b className="ellipsis">{r.title}</b><span className="tiny muted">von {r.author}</span></div>
                  <div className="small muted" title={r.description} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.description}</div>
                  <div className="tiny muted mt" style={{ marginTop: 4 }}><Download size={11} /> {fmtNumber(r.downloads)}</div>
                </div>
                <Btn className="sm" icon={Plus} onClick={async () => { await post(`/mc/servers/${s.id}/modrinth`, { projectId: r.id }); toast(`${r.title} wird installiert …`); setTimeout(list.reload, 2500); setTimeout(list.reload, 6000); }}>Installieren</Btn>
              </div>
            ))}
          </div>
        </div>
      </SideSheet>}
    </div>
  );
}

/*
 * Eine Spielerliste (Online, OPs, Whitelist, Gebannt) als eigene Komponente – vorher war sie innerhalb von PlayersTab
 * definiert und wurde bei jedem Neuzeichnen (CPU-Werte alle 2 s) komplett neu aufgebaut: Köpfe luden neu, die Liste
 * flackerte, und ein Rechtsklick traf oft eine gerade ersetzte Zeile. Rechtsklick geht jetzt auf jeder Zeile.
 */
function PlayerSection({ s, icon: I, title, items, empty, action, remove, onlineList, lists, online, ctxFor, cmd, running }) {
  return (
    <div className="card mc-scroll">
      <div className="card-head"><I size={16} /><h3>{title}</h3><span className="badge">{items.length}</span>{action && <div className="right">{action}</div>}</div>
      <div className="mc-scroll-body">
        {items.length === 0 ? <div className="card-body muted small">{empty}</div> : items.map((p) => (
          <div key={p.uuid || p.name || p.ip} className="list-item" onContextMenu={ctxFor(p.name, p.ip)} title={tr('Rechtsklick: weitere Aktionen')}>
            {p.name ? <PlayerHead name={p.name} size={32} /> : <div className="ico"><Shield /></div>}
            <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{p.name || p.ip}</div>{p.reason && <div className="small muted ellipsis">{p.reason}</div>}{p.level && <div className="small muted">Level {p.level}</div>}</div>
            {onlineList && p.name && <PlayerButtons s={s} name={p.name} lists={lists} online={online} />}
            {remove && running && <button className="btn ghost xs" onClick={() => cmd(remove(p))}>Entfernen</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayersTab({ s }) {
  const lists = usePlayerLists(s);
  const running = s.proc.state === 'running';
  const online = s.proc.extra.players || [];
  const ctxFor = usePlayerContext(s, lists, online);
  const [pickFor, setPickFor] = useState(null);
  const cmd = async (c) => { try { await post(`/mc/servers/${s.id}/command`, { command: c }); } catch (e) { toast.error(e.message); return; } setTimeout(() => lists.reload({ silent: true }), 800); };
  // Hinzufügen: Online-Spieler zum Anklicken oder Namen eintippen
  const ask = (title, prefix, opts = {}) => setPickFor({ title, prefix, ...opts });
  const d = lists.data;
  if (!d) return <Loading />;
  const common = { s, lists, online, ctxFor, cmd, running };
  return (
    <div className="mc-fit-stack">
      {!running && <InfoTip>Spieler hinzufügen/entfernen geht über die Konsole und ist daher nur bei laufendem Server möglich.</InfoTip>}
      <div className="grid grid-2 mc-fit-grid rows-2">
        <PlayerSection {...common} icon={Users} title="Online" items={(online.length ? online : d.online).map((n) => ({ name: n }))} empty={running ? 'Niemand online.' : 'Server ist gestoppt.'} onlineList />
        <PlayerSection {...common} icon={Crown} title="Operatoren" items={d.ops} empty="Keine OPs." action={running && <Btn className="sm" icon={UserPlus} onClick={() => ask('OP hinzufügen', 'op ', { exclude: lists.isOp })}>Hinzufügen</Btn>} remove={(p) => `deop ${p.name}`} />
        <PlayerSection {...common} icon={Shield} title="Whitelist" items={d.whitelist} empty="Whitelist ist leer." action={running && <Btn className="sm" icon={UserPlus} onClick={() => ask('Zur Whitelist hinzufügen', 'whitelist add ', { exclude: lists.onWhitelist })}>Hinzufügen</Btn>} remove={(p) => `whitelist remove ${p.name}`} />
        <PlayerSection {...common} icon={Ban} title="Gebannt" items={[...d.banned, ...d.bannedIps]} empty="Niemand gebannt." action={running && <Btn className="sm" icon={Ban} onClick={() => ask('Spieler bannen', 'ban ', { exclude: lists.isBanned, reason: true, confirm: 'Bannen', danger: true })}>Bannen</Btn>} remove={(p) => (p.name ? `pardon ${p.name}` : `pardon-ip ${p.ip}`)} />
      </div>
      <ExtSections place="mc.players" ctx={{ kind: 'minecraft', id: s.id }} native={{ server: s }} />
      {pickFor && <PlayerPick title={pickFor.title} online={online} exclude={pickFor.exclude} reason={pickFor.reason} confirm={pickFor.confirm} danger={pickFor.danger} onClose={() => setPickFor(null)} onPick={(n, why) => cmd(pickFor.prefix + n + (why ? ' ' + why : ''))} />}
    </div>
  );
}

const downloadAll = async (urls) => { for (const u of urls) { const a = document.createElement('a'); a.href = u; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); await new Promise((r) => setTimeout(r, 400)); } };
function BackupsTab({ s }) {
  const list = useApi(`/mc/servers/${s.id}/backups`);
  const nightly = useApi(`/mc/servers/${s.id}/nightly-backup`, [s.id], { live: false });
  const nc = (nightly.data && nightly.data.config) || null;
  const saveNightly = async (patch) => { try { nightly.setData(await put(`/mc/servers/${s.id}/nightly-backup`, patch)); } catch (e) { toast.error(e.message); } };
  const sel = useSelection((list.data || []).map((b) => b.file));
  const removeSel = async () => {
    if (!(await confirmDialog({ title: `${sel.size} Sicherungen löschen?`, text: sel.list.join('\n'), confirm: 'Löschen', danger: true }))) return;
    let last = null; for (const f of sel.list) { try { last = await del(`/mc/servers/${s.id}/backups/${encodeURIComponent(f)}`); } catch (e) { toast.error(e.message); } }
    if (last) list.setData(last); else list.reload(); sel.clear(); toast.success('Gelöscht');
  };
  return (
    <div className="card mc-scroll">
      <div className="card-head"><Archive size={16} /><h3>Sicherungen</h3><span className="small muted">als ZIP – auch bei laufendem Server möglich</span>
        <div className="right"><Btn className="primary sm" icon={Plus} onClick={async () => { const label = await promptDialog({ title: 'Sicherung erstellen', label: 'Bezeichnung (optional)', placeholder: 'vor-update' }); if (label === null) return; await post(`/mc/servers/${s.id}/backups`, { label }); toast('Sicherung läuft …'); setTimeout(list.reload, 3000); }}>Sicherung erstellen</Btn></div>
      </div>
      {nc && <div className="card-body"><SettingRow title={<>Jede Nacht sichern <InfoTip>{tr(`Um ${nc.hour ?? 3} Uhr eine Sicherung, die letzten ${nc.keep || 7} automatischen bleiben. War der PC nachts aus, holt Hostwerk es nach – bei gestopptem Server nur, wenn sich etwas geändert hat.`)}{nc.lastError ? ` ${tr(`Zuletzt fehlgeschlagen: ${nc.lastError}`)}` : ''}</InfoTip></>} text={nc.lastRun ? `Zuletzt: ${fmtDate(nc.lastRun)}` : undefined}><Switch checked={!!nc.enabled} onChange={(v) => saveNightly({ enabled: v })} /></SettingRow></div>}
      {s.proc.state === 'running' && list.data && list.data.length > 0 && <div className="info-line"><Info size={13} /><span className="grow">Zurückspielen geht nur bei gestopptem Server.</span><SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" /></div>}
      {!list.data ? <Loading /> : list.data.length === 0 ? <Empty icon={Archive} title="Noch keine Sicherungen" text="Erstelle vor größeren Änderungen (Updates, neue Plugins) eine Sicherung." /> : (
        <>
        <BulkBar sel={sel}><Btn className="xs" icon={Download} onClick={() => downloadAll(sel.list.map((f) => `/api/mc/servers/${s.id}/backups/${encodeURIComponent(f)}/download`))}>Herunterladen</Btn><Btn className="xs danger" icon={Trash2} onClick={removeSel}>Löschen</Btn></BulkBar>
        <div className="mc-scroll-body">
        <table className="table sticky-head">
          <thead><tr><th style={{ width: 28 }}><SelectAll sel={sel} /></th><th>Datei</th><th>Erstellt</th><th className="num">Größe</th><th /></tr></thead>
          <tbody>
            {list.data.map((b) => (
              <tr key={b.file} className={sel.has(b.file) ? 'picked' : ''}>
                <td><SelectBox sel={sel} id={b.file} label={b.file} /></td>
                <td className="mono small">{b.file}</td><td>{fmtDate(b.time)}</td><td className="num">{b.sizeText}</td>
                <td className="actions">
                  <a className="btn ghost xs" href={`/api/mc/servers/${s.id}/backups/${encodeURIComponent(b.file)}/download`}><Download />Laden</a>
                  <Btn className="ghost xs" icon={RotateCcw} disabled={s.proc.state !== 'stopped' && s.proc.state !== 'error'} title={s.proc.state === 'running' ? 'Server zuerst stoppen' : ''} onClick={async () => { if (await confirmDialog({ title: 'Sicherung wiederherstellen?', text: `Der aktuelle Stand wird durch „${b.file}“ ersetzt. Vorher wird automatisch eine Vorab-Sicherung angelegt.`, confirm: 'Wiederherstellen', danger: true })) { await post(`/mc/servers/${s.id}/backups/restore`, { file: b.file }); toast('Wiederherstellung läuft …'); setTimeout(list.reload, 4000); } }}>Wiederherstellen</Btn>
                  <Btn className="ghost xs icon" icon={Trash2} title="Löschen" onClick={async () => { if (await confirmDialog({ title: 'Sicherung löschen?', text: b.file, confirm: 'Löschen', danger: true })) list.setData(await del(`/mc/servers/${s.id}/backups/${encodeURIComponent(b.file)}`)); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </>
      )}
    </div>
  );
}

function VersionTab({ s }) {
  const [type, setType] = useState(s.type);
  const [version, setVersion] = useState(s.version);
  const [types, setTypes] = useState([]);
  const [upload, setUpload] = useState(null);
  useEffect(() => { get('/mc/types').then(setTypes); }, []);
  const running = s.proc.state === 'running';
  return (
    <div className="grid grid-2">
      {s.modpack && <ModpackCard s={s} />}
      <div className="card">
        <div className="card-head"><ArrowUpCircle size={16} /><h3>Version wechseln</h3></div>
        <div className="card-body stack">
          <div className="row"><span className="muted">Aktuell:</span><b>{s.typeLabel} {s.version}</b>{s.build && <span className="badge">Build {s.build}</span>}</div>
          <div className="row-tight info-row"><NotesButton product="minecraft" version={s.version} label={`Minecraft ${s.version}: Neuerungen`} />{['paper', 'purpur'].includes(s.type) && <NotesButton product={s.type} version={s.version} label="Letzte Builds" />}<CompareButton kind="mc" current={s.type} label="Server-Software vergleichen" /></div>
          {version && version !== s.version && type !== 'custom' && <div className="row-tight info-row"><NotesButton product="minecraft" version={version} label={`Was bringt ${version}?`} /></div>}
          <Field label="Software"><div className="seg" style={{ flexWrap: 'wrap' }}>{types.filter((t) => t.id !== 'modpack' && t.edition !== 'bedrock' && (s.proxy ? t.id === 'velocity' : t.id !== 'velocity')).map((t) => <button key={t.id} className={type === t.id ? 'active' : ''} onClick={() => { setType(t.id); setVersion(''); }}>{t.label}</button>)}</div></Field>
          {(() => { const t = types.find((x) => x.id === type); return t && type !== 'custom' && t.content !== s.content ? <Callout kind="warn">{t.content === 'mods' ? `Nach dem Wechsel nutzt der Server Mods (Ordner mods/) – vorhandene Plugins laufen auf ${t.label} nicht.` : `Nach dem Wechsel nutzt der Server Plugins (Ordner plugins/) – vorhandene Mods laufen auf ${t.label} nicht.`} Die Welt bleibt erhalten.</Callout> : null; })()}
          {type === 'custom'
            ? <DropZone accept=".jar" onFiles={async (f) => { const fd = new FormData(); fd.append('file', f[0]); setUpload(await api('POST', '/mc/upload-jar', fd)); }}><Upload size={22} /><div className="bold">{upload ? upload.name : 'JAR auswählen'}</div></DropZone>
            : <Field label="Version"><VersionPicker type={type} value={version} onChange={setVersion} /></Field>}
          <Callout kind="warn">Erstelle vorher eine Sicherung. Ein Wechsel auf eine <b style={{ display: 'inline' }}>ältere</b> Version kann Welten beschädigen. Die alte JAR wird als <code>server.jar.alt</code> aufbewahrt.</Callout>
          <SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" size="sm" /><Btn className="primary" disabled={running || (type === 'custom' ? !upload : !version)} title={running ? 'Server zuerst stoppen' : ''} onClick={async () => { await post(`/mc/servers/${s.id}/version`, { type, version, uploadId: upload && upload.uploadId }); toast('Neue Version wird geladen …'); }}>
            {type === s.type && version === s.version ? 'Neuesten Build derselben Version laden' : 'Version wechseln'}
          </Btn>
          {running && <span className="small muted">Stoppe den Server, um die Version zu wechseln.</span>}
        </div>
      </div>
      {type !== 'custom' && <SafeUpgradeCard s={s} type={type} version={version} />}
      <div className="card">
        <div className="card-head"><Skull size={16} /><h3>Gefahrenzone</h3></div>
        <div className="card-body stack">
          <p className="muted" style={{ margin: 0 }}>Löscht den Server inklusive Welt, Plugins und Einstellungen. Sicherungen bleiben im Sicherungsordner erhalten.</p>
          <Btn className="danger" icon={Trash2} disabled={running} onClick={async () => {
            if (await confirmDialog({ title: `„${s.name}“ endgültig löschen?`, text: `Ordner: ${s.dir}`, confirm: 'Endgültig löschen', danger: true, typeToConfirm: s.name })) { await del(`/mc/servers/${s.id}`); location.hash = '/mc'; toast.success('Server gelöscht'); }
          }}>Server löschen</Btn>
        </div>
      </div>
    </div>
  );
}

const AUTO_KEYS = ['autostart', 'autoRestart', 'autoCheck', 'autoPluginUpdates', 'autoServerUpdates']; // Gruppe „Automatik“ der Server-Einstellungen
const OLD_TABS = { einstellungen: 'settings', spieler: 'players', welten: 'worlds', welt: 'worlds', konsole: 'console', sicherungen: 'backups', dateien: 'files', uebersicht: 'overview' };

/*
 * Reiter, deren Boxen die Höhe des Fensters teilen und selbst scrollen (die Seite steht, Kopf und Reiter bleiben sichtbar).
 * Alle anderen scrollen als Ganzes unter dem stehenden Kopf. Kleine Fenster: normales Scrollen (styles.css, .mc-page).
 */
const FIT_TABS = new Set(['overview', 'console', 'players', 'plugins', 'worlds', 'files', 'backups']);

export default function MinecraftServer({ id, tab = 'overview', query = '' }) {
  const all = useStore((st) => st.overview.minecraft);
  const s = all.find((x) => x.id === id);
  const contrib = useExtContrib('minecraft'); // Reiter von Erweiterungen (vor dem frühen return – Hook-Regel)
  // Alte deutsche Reiter-Adressen (Lesezeichen, ältere Links) auf die heutigen umleiten – sonst bliebe nur der Kopf stehen
  if (OLD_TABS[tab]) { location.replace(`#/mc/${encodeURIComponent(id)}/${OLD_TABS[tab]}`); return null; }
  if (!s) return <div className="page"><Empty icon={Box} title="Server nicht gefunden"><a className="btn" href="#/mc">Zur Übersicht</a></Empty></div>;
  // 7 Bereiche statt 12 Reiter – Zusammengehöriges liegt als Unterreiter beisammen (Adressen bleiben gleich)
  const bedrock = isBedrock(s);
  const groups = bedrock ? [
    // Bedrock Dedicated Server: keine Plugins, keine Datapacks, keine Karte – Spieler über Erlaubnisliste und Rechte
    { id: 'overview', label: 'Übersicht', icon: LayoutDashboard, subs: [['overview']] },
    { id: 'console', label: 'Konsole', icon: TerminalSquare, subs: [['console', 'Live', TerminalSquare], ['logs', 'Ältere Protokolle', History]] },
    { id: 'players', label: 'Spieler', icon: Users, badge: mcCount(s), subs: [['players', 'Verwaltung', Users], ['stats', 'Statistik', BarChart3]] },
    { id: 'worlds', label: 'Welt', icon: Globe2, subs: [['worlds']] },
    { id: 'settings', label: 'Einstellungen', icon: Settings2, subs: [['settings', 'Server', Settings2], ['automation', 'Zeitplan & Prüfung', CalendarClock], ['version', 'Version', ArrowUpCircle]] },
    { id: 'files', label: 'Dateien', icon: FolderOpen, subs: [['files', 'Dateien', FolderOpen], ['backups', 'Sicherungen', Archive]] },
  ] : s.proxy ? [
    // Velocity-Proxy: keine Welt, keine server.properties – dafür das Netzwerk
    { id: 'overview', label: 'Übersicht', icon: LayoutDashboard, subs: [['overview']] },
    { id: 'network', label: 'Netzwerk', icon: Network, subs: [['network']] },
    { id: 'console', label: 'Konsole', icon: TerminalSquare, subs: [['console', 'Live', TerminalSquare], ['logs', 'Ältere Protokolle', History]] },
    { id: 'plugins', label: 'Plugins', icon: Puzzle, subs: [['plugins', 'Installiert', Puzzle], ['market', 'Marktplatz', Store]] },
    { id: 'settings', label: 'Einstellungen', icon: Settings2, subs: [['automation', 'Zeitplan & Prüfung', CalendarClock], ['tools', 'Kopie & Listen', Wrench], ['version', 'Version', ArrowUpCircle], ['tools', 'Kopie & Listen', Wrench]] },
    { id: 'files', label: 'Dateien', icon: FolderOpen, subs: [['files', 'Dateien', FolderOpen], ['backups', 'Sicherungen', Archive]] },
  ] : [
    { id: 'overview', label: 'Übersicht', icon: LayoutDashboard, subs: [['overview']] },
    { id: 'console', label: 'Konsole', icon: TerminalSquare, subs: [['console', 'Live', TerminalSquare], ['logs', 'Ältere Protokolle', History], ['crashes', 'Absturzberichte', Bug]] },
    { id: 'players', label: 'Spieler', icon: Users, badge: mcCount(s), subs: [['players', 'Verwaltung', Users], ['stats', 'Statistik', BarChart3]] },
    { id: 'plugins', label: s.content === 'mods' ? 'Mods' : 'Plugins', icon: Puzzle, subs: [['plugins', 'Installiert', Puzzle], ...(s.pluginsSupported ? [['market', 'Marktplatz', Store]] : []), ...(s.content !== 'mods' && s.pluginsSupported ? [['configs', 'Einstellungen', SlidersHorizontal]] : [])] },
    { id: 'worlds', label: 'Welt', icon: Globe2, subs: [['worlds', 'Welten & Regeln', Globe2], ['datapacks', 'Datapacks', Package], ['map', 'Karte', MapIcon]] },
    { id: 'settings', label: 'Einstellungen', icon: Settings2, subs: [['settings', 'Server', Settings2], ['automation', 'Zeitplan & Prüfung', CalendarClock], ['version', 'Version', ArrowUpCircle]] },
    { id: 'files', label: 'Dateien', icon: FolderOpen, subs: [['files', 'Dateien', FolderOpen], ['backups', 'Sicherungen', Archive]] },
  ];
  for (const x of contrib.tabs) groups.push({ id: x.key, label: x.label, icon: x.icon, subs: [[x.key]] });
  const group = groups.find((g) => g.subs.some(([sid]) => sid === tab)) || groups[0];
  const tabs = groups.map(({ subs, ...g }) => g);
  const go = (t) => { location.hash = `/mc/${s.id}/${t}`; };
  return (
    <div className="page fade-in mc-page">
      <div className="page-head">
        <div>
          <h1><SvcImage kind="mc" id={s.id} name={s.name} className="ico" size={30} fallback={<Box size={22} style={{ color: '#23964a' }} />} /> {s.name} <FavButton kind="mc" id={s.id} /> <StatusPill state={s.proc.state} label={s.proc.state === 'running' && !s.proc.extra.ready ? 'Lädt Welt …' : undefined} /></h1>
          <p>{bedrock ? tr(`${s.typeLabel} ${s.version || ''} · UDP-Port ${s.port}`) : <>{s.modpack ? `Modpack ${s.modpack.name} · ` : ''}{s.typeLabel} {s.version}{s.build ? ` (${s.content === 'mods' ? 'Loader' : 'Build'} ${s.build})` : ''} · Java {s.javaMajor} · {(s.memMax / 1024).toFixed(1).replace('.', ',')} GB RAM · Port {s.port}</>} <SourceLink url={s.modpack && s.modpack.projectId ? `https://modrinth.com/project/${s.modpack.projectId}` : s.homepage} /></p>
        </div>
        <div className="actions">
          {isElectron && <Btn className="ghost" icon={ExternalLink} onClick={() => post('/app/open-path', { path: s.dir })}>Ordner</Btn>}
          <ServiceButtons base={`/mc/servers/${s.id}`} state={s.proc.state} />
        </div>
      </div>
      {s.proc.state === 'error' && <div className="mb"><ErrorHelp proc={s.proc} svc={'mc:' + s.id} /></div>}
      {!bedrock && s.updates && (s.updates.modpack || s.updates.addons > 0 || s.updates.server || s.updates.mcVersion) && tab !== 'version' && tab !== 'plugins' && (
        <div className="mb"><Callout kind="info" title="Updates verfügbar">
          {s.updates.server && <div>{s.autoServerUpdates !== false ? `${s.typeLabel} ${s.version} Build #${s.updates.server.build} – wird beim nächsten Stopp automatisch eingespielt.` : `${s.typeLabel} ${s.version} Build #${s.updates.server.build} verfügbar.`} <a href={`#/mc/${s.id}/version`}>Version →</a></div>}
          {s.updates.mcVersion && <div>{`Minecraft ${s.updates.mcVersion} ist erschienen.`} <a href={`#/mc/${s.id}/version`}>Sicher aktualisieren (mit Probelauf) →</a></div>}
          {s.updates.modpack && <>Modpack <b>{s.updates.modpack.number}</b>{s.updates.modpack.mcChange ? ` (Minecraft ${s.updates.modpack.mc})` : ''} – <a href={`#/mc/${s.id}/version`}>ansehen und einspielen →</a> </>}
          {s.updates.addons > 0 && <>{s.updates.addons} {s.content === 'mods' ? 'Mod' : 'Plugin'}-Update{s.updates.addons > 1 ? 's' : ''} – <a href={`#/mc/${s.id}/plugins`}>aktualisieren →</a></>}
        </Callout></div>
      )}
      <Tabs tabs={tabs} value={group.id} onChange={(g) => go((groups.find((x) => x.id === g) || groups[0]).subs[0][0])} />
      {group.subs.length > 1 && <div className="sub-tabs"><Seg value={tab} onChange={go} options={group.subs.map(([sid, label, icon]) => ({ id: sid, label, icon }))} /></div>}
      <div className={`mc-tab-body ${FIT_TABS.has(tab) && !bedrock ? 'fit' : ''}`}>
      {bedrock ? <>
        {tab === 'overview' && <BedrockOverview s={s} />}
        {tab === 'console' && <BedrockConsole s={s} />}
        {tab === 'players' && <BedrockPlayers s={s} />}
        {tab === 'worlds' && <BedrockWorlds s={s} />}
        {tab === 'settings' && <BedrockSettings key={s.id} s={s} />}
        {tab === 'version' && <BedrockVersion s={s} />}
      </> : <>
      {tab === 'overview' && <OverviewTab s={s} />}
      {tab === 'network' && s.proxy && <NetworkTab s={s} />}
      {tab === 'console' && <ConsoleTab s={s} />}
      {tab === 'worlds' && <WorldsTab s={s} />}
      {tab === 'map' && <MapTab s={s} />}
      {tab === 'settings' && <SettingsTab key={s.id} s={s} />}
      {tab === 'files' && <div className="card mc-files"><FileBrowser root={`mc:${s.id}`} initialPath={new URLSearchParams(query).get('path') || ''} /></div>}
      {tab === 'plugins' && <PluginsTab s={s} />}
      {tab === 'market' && <MarketTab s={s} />}
      {tab === 'players' && <PlayersTab s={s} />}
      {tab === 'version' && <VersionTab s={s} />}
      {tab === 'crashes' && <CrashTab s={s} />}
      {tab === 'datapacks' && <DatapacksTab s={s} />}
      {tab === 'tools' && <ServerToolsTab s={s} servers={all} />}
      {tab === 'configs' && <PluginFormsTab s={s} />}
      </>}
      {tab === 'stats' && <StatsTab s={s} />}
      {tab === 'automation' && <AutomationTab s={s} />}
      {tab === 'backups' && <BackupsTab s={s} />}
      {tab === 'logs' && <OldLogsTab s={s} />}
      {contrib.tabs.filter((x) => x.key === tab).map((x) => <ExtTabView key={x.key} item={x} kind="minecraft" id={s.id} />)}
      </div>
    </div>
  );
}
