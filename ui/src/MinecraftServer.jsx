import { useEffect, useRef, useState } from 'react';
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
import { SourceLink, Keep } from '@hostwerk/kit';
import { useExtContrib, ExtTabView } from '@hostwerk/kit';
import { contextMenu } from '@hostwerk/kit';
import { ExtSections } from '@hostwerk/kit';
import { useSelection, SelectBox, SelectAll, BulkBar } from '@hostwerk/kit';
import { BedrockOverview, BedrockConsole, BedrockSettings, BedrockPlayers, BedrockWorlds, BedrockVersion, isBedrock } from './McBedrock';
import { t as T, pl } from '@hostwerk/i18n';

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
      <div className="mc-console-wrap"><Console lines={lines} height="100%" onCommand={running ? cmd : null} onClear={() => del(`/logs/mc:${s.id}`)} suggestions={COMMANDS} placeholder="Enter a command without /, e.g. “say Hello”" /></div>
      <div className="stack mc-col">
        {running && (
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <div className="row-tight">{s.proc.extra.tps != null && <span className="badge"><Gauge size={11} /> {s.proc.extra.tps} TPS</span>}<span className="grow" /><Btn className="ghost xs" icon={Skull} title="Only if the server hangs – unsaved world data is lost" onClick={async () => { if (await confirmDialog({ title: 'Kill the process?', text: 'Only use this if the server hangs – unsaved world data will be lost.', confirm: 'Kill', danger: true })) await post(`/mc/servers/${s.id}/kill`); }}>Kill</Btn></div>
            <ProcStats proc={s.proc} svc={`mc:${s.id}`} compact />
          </div>
        )}
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="label">Connect</div>
          {[s.address.local, ...s.address.lan].map((a) => (
            <div key={a} className="row-tight"><code className="grow ellipsis">{a}</code><button className="btn ghost xs icon" title="Copy" aria-label="Copy" onClick={() => { navigator.clipboard.writeText(a); toast.success('Address copied'); }}><Copy /></button></div>
          ))}
          <div className="tiny muted">For friends outside your network you need to forward port {s.port} in your router.</div>
        </div>
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="label">Players online ({players.length})</div>
          {players.length === 0 ? <span className="small muted">{running ? 'Nobody online.' : 'Server is stopped.'}</span> : players.map((p) => (
            <div key={p} className="row-tight" onContextMenu={ctxFor(p)}>
              <span className="player grow"><PlayerHead name={p} />{p}{lists.isOp(p) && <Crown size={11} className="mc-op-badge" />}</span>
              <PlayerButtons s={s} name={p} lists={lists} online={players} />
            </div>
          ))}
        </div>
        {running && (
          <div className="card card-pad stack" style={{ gap: 6 }}>
            <div className="label">Quick commands</div>
            <div className="row" style={{ gap: 6 }}>
              {[[T('Day'), 'time set day'], [T('Night'), 'time set night'], [T('Clear'), 'weather clear'], [T('Save'), 'save-all'], [T('Player list'), 'list']].map(([l, c]) => <button key={c} className="btn xs" onClick={() => cmd(c)}>{l}</button>)}
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
  { id: 'allgemein', label: 'General', icon: Settings2, fields: [
    ['motd', 'Description (MOTD)', 'text', 'Text in the server list. Colors with § or \\u00A7, line break with \\n.', 2],
    ['server-port', 'Port', 'number', 'Players connect via this port (default 25565).'],
    ['max-players', 'Max. players', 'number', 'How many players may be online at once.'],
    ['online-mode', 'Online mode', 'bool', 'Only bought accounts can join. Off = offline/cracked accounts (player IDs change!).'],
    ['white-list', 'Whitelist', 'bool', 'Only whitelisted players may join (list under “Players”).'],
    ['enforce-whitelist', 'Strict whitelist', 'bool', 'Players removed from the whitelist are kicked immediately.'],
    ['player-idle-timeout', 'Kick idle players (min.)', 'number', '0 = never. Players without movement are disconnected after this time.'],
    ['enable-status', 'Visible in the server list', 'bool', 'Off = the server doesn\'t answer server-list queries.'],
    ['hide-online-players', 'Hide player list', 'bool', 'No player names are shown in the server list.'],
    ['pause-when-empty-seconds', 'Pause without players (s)', 'number', 'From 1.21.2: pause ticking when nobody is online this long (saves CPU). 0 = off.'],
  ] },
  { id: 'welt', label: 'World & game', icon: Globe2, fields: [
    ['level-name', 'World folder', 'text', 'Name of the world folder. Changing it loads another (or new) world.'],
    ['level-seed', 'Seed', 'text', 'Only takes effect for a new world. Empty = random.'],
    ['level-type', 'World type', ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'], 'Only applies to a new world.'],
    ['gamemode', 'Game mode', ['survival', 'creative', 'adventure', 'spectator'], 'Mode for new players.'],
    ['force-gamemode', 'Force game mode', 'bool', 'Players start in the default game mode on every join.'],
    ['difficulty', 'Difficulty', ['peaceful', 'easy', 'normal', 'hard'], ''],
    ['hardcore', 'Hardcore', 'bool', 'Spectator mode on death – cannot be undone for existing players.'],
    ['pvp', 'PvP', 'bool', 'Players can damage each other.'],
    ['allow-nether', 'Allow Nether', 'bool', 'Off = Nether portals don\'t work.'],
    ['generate-structures', 'Generate structures', 'bool', 'Villages, temples, strongholds … (new chunks only).'],
    ['spawn-protection', 'Spawn protection (blocks)', 'number', 'Radius around spawn where only operators may build. 0 = off.'],
    ['max-world-size', 'Max. world size (radius)', 'number', 'World border in blocks from the center (default 29999984).'],
    ['allow-flight', 'Allow flight', 'bool', 'Prevents kicks by flight mods/plugins in survival.'],
    ['spawn-monsters', 'Monsters', 'bool', 'Hostile mobs spawn (older versions; newer: game rule).'],
  ] },
  { id: 'leistung', label: 'Performance', icon: Gauge, fields: [
    ['view-distance', 'View distance (chunks)', 'number', 'How far players see. Biggest impact on RAM and CPU – 8–10 is a good value.'],
    ['simulation-distance', 'Simulation distance (chunks)', 'number', 'How far mobs/plants are active. Smaller than view distance saves a lot.'],
    ['max-tick-time', 'Max. tick time (ms)', 'number', 'If a tick takes longer, the watchdog considers the server crashed. -1 = off (useful for large worlds).'],
    ['network-compression-threshold', 'Network compression from (bytes)', 'number', 'Packets of this size or larger are compressed. -1 = never, 0 = everything.'],
    ['entity-broadcast-range-percentage', 'Entity view distance (%)', 'number', 'How far players see mobs (10–1000).'],
    ['sync-chunk-writes', 'Write chunks synchronously', 'bool', 'Safer on crashes, a bit slower. Off = faster.'],
    ['max-chained-neighbor-updates', 'Max. chained block updates', 'number', 'Protection against lag machines (default 1000000).'],
    ['use-native-transport', 'Native network library', 'bool', 'Linux: faster network processing (epoll).'],
    ['region-file-compression', 'World file compression', ['deflate', 'lz4', 'none'], 'lz4 = faster, a bit larger (from 1.20.5).'],
  ] },
  { id: 'technik', label: 'Tech', icon: TerminalSquare, fields: [
    ['enable-command-block', 'Command blocks', 'bool', 'Enable command blocks.'],
    ['function-permission-level', 'Function permission level', ['1', '2', '3', '4'], 'Permission level data pack functions run with.'],
    ['op-permission-level', 'Operator level', ['1', '2', '3', '4'], '4 = all commands incl. /stop.'],
    ['enable-query', 'Query protocol', 'bool', 'Server info retrievable via UDP (for status pages).'],
    ['query.port', 'Query port', 'number', ''],
    ['enable-rcon', 'RCON', 'bool', 'Remote control via console over TCP. Only with password and never open to the internet!'],
    ['rcon.port', 'RCON port', 'number', ''],
    ['rcon.password', 'RCON password', 'password', ''],
    ['enable-jmx-monitoring', 'JMX monitoring', 'bool', 'For Java monitoring tools.'],
    ['log-ips', 'Log IP addresses', 'bool', 'Off = player IPs don\'t appear in the log (privacy).'],
    ['prevent-proxy-connections', 'Block proxy connections', 'bool', 'Reject connections via VPN/proxy (Mojang check).'],
    ['accepts-transfers', 'Accept transfers', 'bool', 'Players may be sent here from other servers via /transfer (1.20.5+).'],
    ['bug-report-link', 'Bug report link', 'text', 'Shown to players in the pause menu (1.21+).'],
  ] },
  { id: 'paket', label: 'Resource pack', icon: Puzzle, fields: [
    ['resource-pack', 'Resource pack URL', 'text', 'Direct link to the ZIP. Players are asked on join.', 2],
    ['resource-pack-sha1', 'SHA-1 checksum', 'text', 'Optional, prevents stale caches.', 2],
    ['resource-pack-prompt', 'Prompt text', 'text', 'Text in the dialog on join.', 2],
    ['require-resource-pack', 'Require pack', 'bool', 'Whoever declines is disconnected.'],
    ['resource-pack-id', 'Pack ID (UUID)', 'text', 'Optional (1.20.3+).'],
  ] },
  { id: 'chat', label: 'Chat & more', icon: Users, fields: [
    ['enforce-secure-profile', 'Signed chat messages', 'bool', 'Players without a Mojang signature can\'t join. Off = also helps with chat-report problems.'],
    ['broadcast-console-to-ops', 'Console commands to OPs', 'bool', 'Operators see commands run via the console.'],
    ['broadcast-rcon-to-ops', 'RCON commands to OPs', 'bool', ''],
    ['text-filtering-config', 'Chat filter configuration', 'text', 'Path to a filter file (rarely needed).', 2],
    ['initial-enabled-packs', 'Data packs (start)', 'text', 'Comma-separated, new worlds only.', 2],
    ['initial-disabled-packs', 'Data packs disabled (start)', 'text', '', 2],
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
    try { const r = await put(`/mc/servers/${s.id}/properties`, patch); setP(r); setOrig(r); toast.success(T('{settings} saved', { settings: pl(changed.length, '{n} setting', '{n} settings') }) + (running ? T(' – takes effect after restart') : '')); } catch (e) { toast.error(e.message); }
  };
  const base = cfgOrig || cfg0.current; // Stand beim Öffnen bzw. nach dem letzten Speichern
  const cfgChanged = Object.keys(cfg).filter((k) => cfg[k] !== base[k]);
  const saveCfg = async () => { await put(`/mc/servers/${s.id}`, cfg); setCfgOrig({ ...cfg }); };
  // Ein Speichern für beide Teile (Start/Leistung und server.properties)
  const saveAll = async () => {
    setBusy(true);
    try {
      if (cfgChanged.length) await saveCfg();
      if (changed.length) await saveProps(); else toast.success(T('Saved') + (running ? T(' – takes effect after restart') : ''));
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const reset = () => { setP(orig); setCfg({ ...cfg, ...base }); };
  const g = PROP_GROUPS.find((x) => x.id === group) || PROP_GROUPS[0];
  const needle = q.trim().toLowerCase();
  const fields = needle ? PROP_GROUPS.flatMap((x) => x.fields.filter(([k, l, , h]) => `${k} ${l} ${T(l)} ${h || ''} ${h ? T(h) : ''}`.toLowerCase().includes(needle))) : g.fields;
  const known = new Set(PROP_GROUPS.flatMap((x) => x.fields.map(([k]) => k)));
  const other = Object.keys(p).filter((k) => !known.has(k)).length;
  const field = ([k, label, type, hint, span]) => {
    const dirty = p[k] !== (orig || {})[k];
    const val = p[k] ?? '';
    if (type === 'bool') return <SettingRow key={k} title={<>{label}{dirty && <span className="badge warn" style={{ marginLeft: 6 }}>changed</span>}</>} text={hint || k}><Switch checked={BOOL(val)} onChange={(v) => setP({ ...p, [k]: v ? 'true' : 'false' })} /></SettingRow>;
    return (
      <Field key={k} label={<>{label}{dirty && <span className="badge warn" style={{ marginLeft: 6 }}>changed</span>}</>} hint={hint || k} className={span === 2 ? 'span-2' : ''}>
        {Array.isArray(type)
          ? <select className="select" value={val} onChange={(e) => setP({ ...p, [k]: e.target.value })}>{!type.includes(val) && <option value={val}>{val || '(not set)'}</option>}{type.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          : <input className={`input ${type === 'number' ? 'mono' : ''}`} type={type === 'password' ? 'password' : type} value={val} placeholder={type === 'number' ? '' : '(not set)'} onChange={(e) => setP({ ...p, [k]: e.target.value })} />}
      </Field>
    );
  };
  const dirty = changed.length + cfgChanged.length;
  const groups = [
    { id: 'run', label: T('Memory & Java'), icon: Gauge, badge: cfgChanged.filter((k) => !AUTO_KEYS.includes(k)).length || null },
    { id: 'auto', label: T('Automation'), icon: RefreshCw, badge: cfgChanged.filter((k) => AUTO_KEYS.includes(k)).length || null },
    ...PROP_GROUPS.map((x) => ({ id: x.id, label: T(x.label), icon: x.icon, badge: x.fields.filter(([k]) => changed.includes(k)).length || null })),
    { id: 'raw', label: T('All properties'), icon: FileCog },
  ];
  return (
    <>
    <SettingsLayout label={T('Server settings')} value={needle ? '' : group} onChange={(v) => { setQ(''); setGroup(v); }} groups={groups}
      top={<div className="input-icon"><Search /><input className="input sm" placeholder="Search setting …" aria-label={T('Search settings')} value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
      {group === 'run' && !needle && (
        <div className="card">
          <div className="card-head"><Gauge size={16} /><h3>Memory & Java</h3></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Name" className="span-2"><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
              <Field label={`Max. RAM: ${(cfg.memMax / 1024).toFixed(1).replace('.', ',')} GB`} className="span-2" hint={sys.data ? `PC: ${fmtBytes(sys.data.totalMem)} total, ${fmtBytes(sys.data.freeMem)} free. Rule of thumb: 2–4 GB for small servers, 6–10 GB with many plugins/mods.` : ''}>
                <input className="range" type="range" min={1024} max={sys.data ? Math.max(2048, Math.floor(sys.data.totalMem / 1048576 / 512) * 512) : 16384} step={512} value={cfg.memMax} onChange={(e) => setCfg({ ...cfg, memMax: Number(e.target.value) })} />
              </Field>
              <Field label="Start RAM (MB)" hint="Reserved at start. Same as max. = fewer stutters."><input className="input" type="number" value={cfg.memMin} onChange={(e) => setCfg({ ...cfg, memMin: Number(e.target.value) })} /></Field>
              <Field label="Java version" hint={`Recommended for ${s.version}: Java ${s.javaMajor}`}><select className="select" value={cfg.javaMajor} onChange={(e) => setCfg({ ...cfg, javaMajor: Number(e.target.value) })}>{[25, 21, 17, 16, 11, 8].map((j) => <option key={j} value={j}>Java {j}</option>)}</select></Field>
              <Field label="JVM optimization" hint="Aikar flags = proven settings for the memory garbage collector."><select className="select" value={cfg.jvmFlags} onChange={(e) => setCfg({ ...cfg, jvmFlags: e.target.value })}><option value="aikar">Aikar flags (recommended)</option><option value="none">None</option></select></Field>
              <Field label="Additional JVM arguments"><input className="input mono" placeholder="-Dfile.encoding=UTF-8" value={cfg.extraArgs} onChange={(e) => setCfg({ ...cfg, extraArgs: e.target.value })} /></Field>
              <Field label="Custom Java path (optional)" className="span-2" hint="Overrides the automatically managed Java version."><PathInput title="Choose java.exe" filters={[{ name: 'Java', extensions: ['exe'] }]} placeholder="C:\Program Files\Java\...\bin\java.exe" value={cfg.javaPath} onChange={(v) => setCfg({ ...cfg, javaPath: v })} /></Field>
            </div>
          </div>
        </div>
      )}
      {group === 'auto' && !needle && (
        <div className="card">
          <div className="card-head"><RefreshCw size={16} /><h3>{T('Automation')}</h3></div>
          <div className="card-body">
            <SettingRow title="Start with Hostwerk" text="Server starts automatically when Hostwerk opens."><Switch checked={cfg.autostart} onChange={(v) => setCfg({ ...cfg, autostart: v })} /></SettingRow>
            <SettingRow title="Restart after crash" text="At most 3 restarts in 5 minutes."><Switch checked={cfg.autoRestart} onChange={(v) => setCfg({ ...cfg, autoRestart: v })} /></SettingRow>
            {!['custom', 'vanilla'].includes(s.type) && !s.modpack && <SettingRow title="Update server software automatically" text="Apply new builds of the same Minecraft version (e.g. Paper bug fixes) as soon as the server is stopped. The old file stays as server.jar.alt. New Minecraft versions are only offered."><Switch checked={cfg.autoServerUpdates} onChange={(v) => setCfg({ ...cfg, autoServerUpdates: v })} /></SettingRow>}
            {s.content !== 'mods' && <SettingRow title="Update plugins automatically" text="Apply new versions of plugins with a known source (Modrinth, Hangar, GitHub …) as soon as they fit the Minecraft version. If the server is running, they take effect after the next restart."><Switch checked={cfg.autoPluginUpdates} onChange={(v) => setCfg({ ...cfg, autoPluginUpdates: v })} /></SettingRow>}
            <SettingRow title="Check after every start" text="Server check (plugins, errors, TPS, reachability) runs automatically once the server is ready – result under Schedule & check."><Switch checked={cfg.autoCheck} onChange={(v) => setCfg({ ...cfg, autoCheck: v })} /></SettingRow>
          </div>
        </div>
      )}
      {group === 'raw' && !needle && <RawProps s={s} onSaved={props.reload} />}
      {(needle || !['run', 'auto', 'raw'].includes(group)) && (
        <div className="card">
          <div className="card-head"><Settings2 size={16} /><h3>{needle ? T('Search result') : g.label}</h3><span className="tiny muted">server.properties</span></div>
          <div className="card-body stack" style={{ gap: 10 }}>
            {fields.length === 0 && <TileEmpty icon={Search} text="Nothing found – “All properties” shows the whole file." />}
            <div className="form-grid">{fields.filter((x) => x[2] !== 'bool').map(field)}</div>
            <div>{fields.filter((x) => x[2] === 'bool').map(field)}</div>
            {group === 'allgemein' && !needle && <InfoTip inline>Server icon and server-list preview: Overview → “How players see your server”.</InfoTip>}
            {other > 0 && !needle && group === 'chat' && <div className="tiny muted">{other} more keys in the file – under “All properties”.</div>}
          </div>
        </div>
      )}
    </SettingsLayout>
    <SaveBar dirty={dirty > 0} busy={busy} onSave={saveAll} onReset={reset} text={pl(dirty, '{n} unsaved change', '{n} unsaved changes') + (running ? ` – ${T('takes effect after a restart')}` : '')} />
    </>
  );
}

function RawProps({ s, onSaved }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  return (
    <div className="card">
      <div className="card-head"><Settings2 size={16} /><h3>All properties</h3><div className="right"><Btn className="sm" onClick={async () => { setFile(await get(`/files/read?root=${encodeURIComponent('mc:' + s.id)}&path=server.properties`)); setOpen(true); }}>server.properties in the editor</Btn></div></div>
      {open && file && (
        <Modal title="server.properties" size="xwide" onClose={() => setOpen(false)} footer={<><Btn onClick={() => setOpen(false)}>Cancel</Btn><Btn className="primary" onClick={async () => { await put('/files/write', { root: 'mc:' + s.id, path: 'server.properties', content: file.content, mtime: file.mtime }); toast.success('Saved'); setOpen(false); onSaved(); }}>Save</Btn></>}>
          <div style={{ height: '100%', minHeight: 400, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}><Editor value={file.content} lang="properties" onChange={(v) => setFile({ ...file, content: v })} /></div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Plugin-Live-Update */
const LIVE_MODES = [
  { id: 'auto', label: 'Automatic', hint: 'Without restart when it\'s safe – otherwise restart with countdown.' },
  { id: 'hot', label: 'Without restart', hint: 'Always swap live (hot reload). If that\'s not possible, you get an error.' },
  { id: 'restart', label: 'With restart', hint: 'Swap the JAR and restart the server – always clean, briefly offline.' },
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
    const dir = await pickFolder(T('Choose plugin project folder'));
    if (!dir) return;
    try {
      if (install) setScript({ dir, ...(await post(`/mc/servers/${s.id}/live-update/script`, { dir })) });
      if (!d.watch.includes(dir)) await save({ watch: [...d.watch, dir] });
    } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><Zap size={16} /><h3>Plugin live update</h3>
        {d.enabled && <span className={`badge ${d.bridge.disabled ? 'err' : d.bridge.active ? 'ok' : ''}`} title="Hostwerk bridge in the server">{d.bridge.disabled ? 'Bridge disabled' : d.bridge.active ? 'Bridge active' : running ? 'Bridge after restart' : 'ready'}</span>}
        <div className="right row-tight"><Switch checked={d.enabled} label="Plugin live update" onChange={(v) => save({ enabled: v })} /></div>
      </div>
      {!d.enabled ? (
        <div className="card-body stack" style={{ gap: 8 }}>
          {d.pausedByBridge && <Callout kind="warn" dismissible={false} title={d.bridge.disabled ? 'Turned off because HostwerkBridge is disabled' : 'Turned off because HostwerkBridge is missing'}>As soon as the bridge is back and active, live update turns itself back on. <Btn className="xs" onClick={async () => { try { await post(`/mc/servers/${s.id}/live-update/bridge`); st.reload(); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); } }}>{d.bridge.disabled ? 'Turn on bridge' : 'Install bridge'}</Btn></Callout>}
          <div className="small muted">Deploy a new version of your plugin without copying files yourself: drag the .jar here – Hostwerk swaps it in the running server or restarts it with a warning. For this the small helper plugin “HostwerkBridge” is added to the server.</div>
          <div><Btn className="primary sm" icon={Zap} onClick={() => save({ enabled: true })}>Turn on live update</Btn></div>
        </div>
      ) : (
        <div className="card-body stack" style={{ gap: 10 }}>
          {d.bridge.disabled && <Callout kind="warn" title="HostwerkBridge is disabled under “Installed”">Without the bridge there is no live swap – updates only run via restart. <Btn className="xs" onClick={async () => { try { st.setData(await post(`/mc/servers/${s.id}/live-update/bridge`)); toast.success(T('Bridge active again') + (running ? T(' – after the next restart') : '')); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); } }}>Enable bridge again</Btn></Callout>}
          {running && !d.bridge.active && !d.bridge.disabled && d.mode !== 'restart' && <div className="tiny muted">The bridge becomes active on the next restart – until then Hostwerk updates via restart.</div>}
          <DropZone onFiles={deployFiles} accept=".jar">
            <div className="small" style={{ textAlign: 'center', padding: 4 }}>{busy ? 'Deploying …' : <><b>Drag the new plugin .jar here</b> or click to choose<div className="tiny muted" style={{ marginTop: 2 }}>{(LIVE_MODES.find((m) => m.id === d.mode) || LIVE_MODES[0]).hint}</div></>}</div>
          </DropZone>
          <div className="row-tight small">
            <button className="btn ghost xs" onClick={() => setMore(!more)}>{more ? 'Less' : 'Settings & projects'}{d.watch.length ? ` (${d.watch.length})` : ''}</button>
            <span className="grow" /><span className="tiny muted">{(LIVE_MODES.find((m) => m.id === d.mode) || LIVE_MODES[0]).label}{d.mode !== 'hot' ? ` · advance warning ${d.countdown ? d.countdown + ' s' : 'none'}` : ''}</span>
          </div>
          {more && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><b className="small">How to deploy?</b><Seg value={d.mode} onChange={(v) => save({ mode: v })} options={LIVE_MODES.map((m) => ({ id: m.id, label: m.label, title: m.hint }))} />
                {d.mode !== 'hot' && <><span className="tiny muted">Warning before restart</span><select className="select xs" value={d.countdown} onChange={(e) => save({ countdown: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n ? `${n} s` : 'none'}</option>)}</select></>}
              </div>
              <div className="row" style={{ gap: 6 }}><b className="small grow">Plugin projects (automatically after every build)</b>
                <Btn className="xs" icon={FolderOpen} onClick={() => addProject(false)}>Watch folder</Btn>
                <Btn className="xs primary" icon={TerminalSquare} onClick={() => addProject(true)}>Install script</Btn>
              </div>
              {d.watch.length === 0 ? <div className="tiny muted">Hostwerk watches build/libs/ (Gradle) or target/ (Maven) and deploys every newly built JAR.</div> : d.watch.map((w) => (
                <div key={w} className="row-tight" style={{ padding: '2px 0' }}><code className="grow ellipsis small" title={w}>{w}</code><button className="btn ghost xs icon" title="Stop watching" onClick={() => save({ watch: d.watch.filter((x) => x !== w) })}><Trash2 /></button></div>
              ))}
              {script && <InfoTip title="Script installed"><div className="small">In <code>{script.dir}</code> created: {script.files.join(', ')}.<br />Deploy update: <code>{script.howto}</code></div></InfoTip>}
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
  const title = p.dataDir ? T(`Open folder “${p.dataDir}” (settings and data)`) : T(`No folder of its own – shows ${rel}/ with the JAR`);
  return (
    <button type="button" className={`btn ghost xs icon ${p.dataDir ? '' : 'faint'}`} title={title} aria-label={title}
      onClick={isElectron ? inExplorer : inFiles}
      onContextMenu={(e) => contextMenu(e, [{ label: T('Open in Hostwerk (Files)'), icon: FileCog, onClick: inFiles }, isElectron && { label: T('Open in Explorer'), icon: ExternalLink, onClick: inExplorer }, { label: T('Copy path'), icon: Copy, onClick: () => navigator.clipboard.writeText(`${s.dir}/${rel}`).then(() => toast.success(T('Copied'))) }])}>
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
  if (!s.pluginsSupported) return <Empty icon={Puzzle} title="Vanilla doesn't support plugins" text="Switch to Paper or Purpur under “Version” to use plugins – your world is kept." />;
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
    if (hot) toast.success(T(`${hot} ${W}(s) loaded live – no restart`));
    if (queued) toast(T(`${queued} ${W}(s) waiting for the next restart`));
    if (!hot && !queued && r.placed.some((x) => x.mode === 'copy')) toast.success(T(`${W}(s) uploaded`));
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
  const SRC_LABEL = { modrinth: 'Modrinth', hangar: 'Hangar', github: 'GitHub', spigot: 'SpigotMC', jenkins: 'Jenkins', url: 'Link', project: T('Own project'), hostwerk: T('From Hostwerk'), manual: T('Manually') };
  const checkUpdates = async () => {
    setChecking(true);
    try {
      const u = await get(`/mc/servers/${s.id}/plugins/updates`);
      setUpdates(Object.fromEntries(u.map((x) => [x.file, x])));
      const n = u.filter((x) => x.update).length;
      n ? toast(n > 1 ? T('{n} {what} updates available', { n, what: W }) : T('1 {what} update available', { what: W })) : toast.success(mods ? 'All known mods are up to date.' : 'All known plugins are up to date.');
    } catch (e) { toast.error(e.message); }
    setChecking(false);
  };
  const runUpdate = async (file) => {
    const r = await post(`/mc/servers/${s.id}/plugins/update`, file ? { file } : {});
    try { const j = await waitJob(r.job); toast.success(T('{n} {what}(s) updated', { n: j.result.updated, what: W }) + (j.result.queued ? T(' – {n} waiting for the next stop or restart', { n: j.result.queued }) : '')); list.reload(); setUpdates(null); } catch (e) { toast.error(e.message); }
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
    if (enable) toast.success(running ? `${todo.length} turned on – takes effect after a restart` : `${todo.length} switched on`);
    else toast.success(running ? `${todo.length} turned off – takes effect after a restart` : `${todo.length} switched off`);
    window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } }));
  };
  const bulkRemove = async () => {
    const r = await confirmDialog({ title: `Remove ${chosen.length} ${W}s?`, text: chosen.map((p) => p.name).join(', '), confirm: 'Remove', danger: true, checkbox: mods ? null : { label: T('Also delete the configuration folders under plugins/ (settings and data)'), checked: false } });
    if (!(r && (r === true || r.ok))) return;
    let last = null;
    for (const p of chosen) { try { last = await del(`/mc/servers/${s.id}/plugins/${encodeURIComponent(p.file)}${r.checked ? `?config=${encodeURIComponent(p.name)}` : ''}`); } catch (e) { toast.error(`${p.name}: ${e.message}`); } }
    if (last) list.setData(last);
    setSel(new Set());
  };
  const bulkUpdate = async () => {
    const files = chosen.filter((p) => updates && updates[p.file] && updates[p.file].update).map((p) => p.file);
    if (!files.length) { toast('There are no updates for the selection – “Check for updates” first.'); return; }
    const r = await post(`/mc/servers/${s.id}/plugins/update`, { files });
    try { const j = await waitJob(r.job); toast.success(T('{n} {what}(s) updated', { n: j.result.updated, what: W }) + (j.result.queued ? T(' – {n} waiting for the next stop or restart', { n: j.result.queued }) : '')); list.reload(); setUpdates(null); } catch (e) { toast.error(e.message); }
  };
  // Links die installierten Plugins (Liste scrollt in der Box), rechts Live-Update, Hochladen und Quellen
  return (
    <div className="grid grid-2 mc-fit-grid mc-plugins-grid">
        <div className="card mc-scroll">
          <div className="card-head"><Puzzle size={16} /><h3>Installed</h3><span className="badge">{installed.length === all.length ? all.length : `${installed.length} / ${all.length}`}</span>
            <div className="right row-tight"><Btn className="sm primary" icon={Plus} onClick={() => setFind(true)}>{mods ? 'Add mod …' : 'Add plugin …'}</Btn>
              {updCount > 0 && <Btn className="sm primary" icon={ArrowUpCircle} onClick={() => runUpdate(null)}>All {updCount} update</Btn>}
              {installed.length > 0 && <Btn className="sm ghost" icon={RefreshCw} busy={checking} onClick={checkUpdates}>Check for updates</Btn>}
            </div>
          </div>
          {all.length > 3 && (
            <div className="plugin-tools">
              <Seg value={view.sort} onChange={(v) => setV({ sort: v })} options={[{ id: 'name', label: 'Name' }, { id: 'changed', label: 'Last changed' }, { id: 'size', label: 'Size' }]} />
              <select className="select sm" style={{ width: 'auto' }} value={view.src} onChange={(e) => setV({ src: e.target.value })} aria-label="Source">
                <option value="all">All sources</option>
                {sources.map((x) => <option key={x} value={x}>{SRC_LABEL[x] || x}</option>)}
              </select>
              <select className="select sm" style={{ width: 'auto' }} value={view.state} onChange={(e) => setV({ state: e.target.value })} aria-label="Health">
                <option value="all">All</option><option value="on">Enabled</option><option value="off">Disabled</option><option value="paused">Source paused</option>
              </select>
              {(view.src !== 'all' || view.state !== 'all') && <button type="button" className="btn ghost xs" onClick={() => setV({ src: 'all', state: 'all' })}>Reset filter</button>}
            </div>
          )}
          {installed.length > 1 && (
            <div className="plugin-bulk">
              <label className="check small"><input type="checkbox" checked={allPicked} onChange={(e) => setSel(e.target.checked ? new Set(installed.map((p) => p.file)) : new Set())} />{chosen.length ? `${chosen.length} selected` : 'Select all'}</label>
              {chosen.length > 0 && <div className="row-tight right" style={{ flexWrap: 'wrap' }}>
                <Btn className="xs" onClick={() => bulkToggle(false)}>Turn off</Btn>
                <Btn className="xs" onClick={() => bulkToggle(true)}>Turn on</Btn>
                {updates && <Btn className="xs" icon={ArrowUpCircle} onClick={bulkUpdate}>Update</Btn>}
                <Btn className="xs danger" icon={Trash2} onClick={bulkRemove}>Remove</Btn>
                <button type="button" className="link-btn tiny" onClick={() => setSel(new Set())}>Clear selection</button>
              </div>}
            </div>
          )}
          <div className="mc-scroll-body">
          {all.length > 0 && installed.length === 0 && <TileEmpty text="No plugin matches the filter." />}
          {!list.data ? <Loading /> : all.length === 0 ? <div className="card-body muted small">{mods ? 'No mods yet. Search Modrinth on the right or upload a JAR.' : 'No plugins yet. Search Modrinth on the right or upload a JAR.'}</div> : installed.map((p) => (
            <div key={p.file} className={`list-item ${sel.has(p.file) ? 'selected' : ''}`} style={{ opacity: p.enabled ? 1 : 0.55 }}>
              {installed.length > 1 && <input type="checkbox" className="plugin-check" checked={sel.has(p.file)} onChange={(e) => pick(p.file, e.target.checked)} aria-label={`Select ${p.name}`} />}
              {/* Eigenes Symbol aus der JAR (hostwerk-icon.png/.svg oder Mod-Logo), sonst Puzzleteil */}
              <div className="ico">{p.jarIcon ? <LazyImg src={apiUrl(p.jarIcon)} className="plugin-ico" title={`Icon from ${p.file}`} fallback={<Puzzle />} /> : <Puzzle />}</div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold">{p.name} <span className="muted small">{p.version}</span>{p.size != null && <span className="muted tiny" style={{ marginLeft: 6 }} title="Size of the JAR file">{fmtBytes(p.size)}</span>}{p.changedAt && <span className="muted tiny" style={{ marginLeft: 6 }} title={p.prevVersion ? `Before: ${p.prevVersion}` : 'When this version or JAR was added'}>{`· changed ${fmtDate(p.changedAt)}`}</span>}
                  {p.origin && (p.origin.page
                    ? <button type="button" className={`src-chip src-${p.origin.source}`} title={T('Source: {name} – open page', { name: p.origin.label })} onClick={() => openExternal(p.origin.page)}>{p.origin.label}</button>
                    : <span className={`src-chip src-${p.origin.source}`} title={{ project: T('From your project folder – new builds show up as an update'), hostwerk: T('Part of Hostwerk and updated with Hostwerk') }[p.origin.source] || 'No linked source – link it under “Other sources”'}>{p.origin.label}</span>)}
                  {updates && updates[p.file] && updates[p.file].update && <span className="badge ok" style={{ marginLeft: 6 }}>Update: {updates[p.file].latest}</span>}
                  {updates && updates[p.file] && updates[p.file].pending && <span className="badge" style={{ marginLeft: 6 }} title={T('Waiting – Hostwerk applies the new version automatically at the next stop or restart')}>{`${updates[p.file].pending} ${T(T('waiting'))}`}</span>}
                  {updates && updates[p.file] && !updates[p.file].known && <span className="badge" style={{ marginLeft: 6 }} title="Not on Modrinth/Hangar – link it below with GitHub, SpigotMC, Jenkins or a link">unknown</span>}
                {updates && updates[p.file] && updates[p.file].external && <span className="badge warn" style={{ marginLeft: 6 }} title="Download only on the vendor page">external</span>}
                </div>
                <div className="small muted ellipsis">{p.description || p.file}</div>
              </div>
              {updates && updates[p.file] && updates[p.file].update && <Btn className="xs" icon={ArrowUpCircle} onClick={() => runUpdate(p.file)}>Update</Btn>}
              <PluginFolderButton s={s} p={p} mods={mods} />
              <Switch checked={p.enabled} onChange={async () => {
                if (p.enabled && /^HostwerkBridge\.jar$/i.test(p.file) && !(await confirmDialog({ title: 'Disable HostwerkBridge?', text: 'The bridge is Hostwerk’s helper plugin in this server. Without it these stop working:\n\n• Plugin live update without restart (hot reload) – updates then only work with a restart\n• Live status from the server for Hostwerk\n\nYou can turn it back on at any time.', confirm: 'Disable anyway', danger: true }))) return;
                list.setData(await post(`/mc/servers/${s.id}/plugins/toggle`, { file: p.file }));
                if (running) toast('Takes effect after a restart.');
                window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } }));
              }} />
              <Btn className="ghost xs icon" icon={Trash2} title="Delete" onClick={async () => { const r = await confirmDialog({ title: `Remove ${p.name}?`, text: mods ? 'The mod JAR is deleted. Settings under config/ are kept.' : 'The plugin JAR will be deleted.', confirm: 'Remove', danger: true, checkbox: mods ? null : { label: T(`Also delete the configuration folder “plugins/${p.name}/” (the plugin's settings and data)`), checked: false } }); const ok = r && (r === true || r.ok); if (ok) list.setData(await del(`/mc/servers/${s.id}/plugins/${encodeURIComponent(p.file)}${r.checked ? `?config=${encodeURIComponent(p.name)}` : ''}`)); }} />
            </div>
          ))}
          </div>
        </div>
        <div className="stack mc-col">
        {!mods && !s.proxy && <LiveUpdateCard s={s} />}
        <DropZone accept=".jar" multiple onFiles={upload}><Upload size={22} /><div className="bold" style={{ marginTop: 6 }}>{W} JAR upload</div><div className="small">Drop files here or click</div></DropZone>
        {running && <InfoTip>{mods ? 'New or changed mods are only loaded after a server restart.' : 'New or changed plugins are only loaded after a server restart – with plugin live update switched on, without one.'}</InfoTip>}
        <PluginSourcesCard s={s} onChanged={() => { list.reload(); setUpdates(null); }} />
        {mods && <ClientPackCard s={s} />}
        </div>
      {find && <SideSheet size="wide" title={mods ? 'Add mod' : 'Add plugin'} subtitle={`Modrinth · matching ${s.typeLabel} ${s.version}`} onClose={() => setFind(false)}>
        <div className="row-tight"><a className="btn sm primary" href={`#/mc/${s.id}/market`}><Store size={14} />Go to marketplace</a></div>
        <div className="stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <div className="input-icon grow"><Search /><input className="input" placeholder={mods ? 'e.g. Lithium, Create, Terralith …' : 'e.g. LuckPerms, EssentialsX, WorldEdit …'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Btn className="primary" busy={searching} onClick={() => search()}>Search</Btn>
          </form>
          <div className="stack" style={{ gap: 10 }}>
            {missingHw.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="tiny bold muted">Hostwerk plugins</div>
                {missingHw.map((p) => (
                  <div key={p.id} className="plugin-card hw-own">
                    <LazyImg src={apiUrl(p.icon)} className="ph" fallback={<div className="ph" />} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row-tight"><b className="ellipsis">{p.name}</b>{p.version && <span className="tiny muted">{p.version}</span>}<span className="src-chip src-hostwerk">From Hostwerk</span></div>
                      <div className="small muted">{p.disabled ? 'Installed, but turned off. ' : ''}{p.description}</div>
                    </div>
                    <Btn className="sm primary" icon={p.disabled ? Power : Plus} onClick={async () => { try { await post(`/mc/servers/${s.id}/live-update/bridge`); toast.success(T(p.disabled ? '{name} turned on' : '{name} installed', { name: p.name }) + (running ? T(' – takes effect after the next restart') : '')); list.reload(); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); } }}>{p.disabled ? 'Turn on' : 'Install'}</Btn>
                  </div>
                ))}
                <div className="tiny bold muted" style={{ marginTop: 4 }}>Modrinth</div>
              </div>
            )}
            {searchError && !results && <div className="row-tight small muted"><span className="grow">The marketplace (Modrinth) isn't reachable right now – installed plugins keep working.</span><Btn className="xs" icon={RefreshCw} busy={searching} onClick={() => search(q, { quiet: true })}>Try again</Btn></div>}
            {results && results.length === 0 && <div className="muted small">{mods ? 'No matching mods found.' : 'No matching plugins found.'}</div>}
            {(results || []).map((r) => (
              <div key={r.id} className="plugin-card">
                <LazyImg src={r.icon} className="ph" fallback={<div className="ph" />} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-tight"><b className="ellipsis">{r.title}</b><span className="tiny muted">of {r.author}</span></div>
                  <div className="small muted" title={r.description} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.description}</div>
                  <div className="tiny muted mt" style={{ marginTop: 4 }}><Download size={11} /> {fmtNumber(r.downloads)}</div>
                </div>
                <Btn className="sm" icon={Plus} onClick={async () => { await post(`/mc/servers/${s.id}/modrinth`, { projectId: r.id }); toast(`Installing ${r.title} …`); setTimeout(list.reload, 2500); setTimeout(list.reload, 6000); }}>Install</Btn>
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
          <div key={p.uuid || p.name || p.ip} className="list-item" onContextMenu={ctxFor(p.name, p.ip)} title={T('Right-click: more actions')}>
            {p.name ? <PlayerHead name={p.name} size={32} /> : <div className="ico"><Shield /></div>}
            <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{p.name || p.ip}</div>{p.reason && <div className="small muted ellipsis">{p.reason}</div>}{p.level && <div className="small muted">Level {p.level}</div>}</div>
            {onlineList && p.name && <PlayerButtons s={s} name={p.name} lists={lists} online={online} />}
            {remove && running && <button className="btn ghost xs" onClick={() => cmd(remove(p))}>Remove</button>}
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
      {!running && <InfoTip>Adding/removing players goes through the console and is therefore only possible while the server is running.</InfoTip>}
      <div className="grid grid-2 mc-fit-grid rows-2">
        <PlayerSection {...common} icon={Users} title="Online" items={(online.length ? online : d.online).map((n) => ({ name: n }))} empty={running ? T('Nobody online.') : T('Server is stopped.')} onlineList />
        <PlayerSection {...common} icon={Crown} title="Operators" items={d.ops} empty={T('No operators.')} action={running && <Btn className="sm" icon={UserPlus} onClick={() => ask(T('Add operator'), 'op ', { exclude: lists.isOp })}>Add</Btn>} remove={(p) => `deop ${p.name}`} />
        <PlayerSection {...common} icon={Shield} title="Whitelist" items={d.whitelist} empty={T('Whitelist is empty.')} action={running && <Btn className="sm" icon={UserPlus} onClick={() => ask(T('Add to whitelist'), 'whitelist add ', { exclude: lists.onWhitelist })}>Add</Btn>} remove={(p) => `whitelist remove ${p.name}`} />
        <PlayerSection {...common} icon={Ban} title="Banned" items={[...d.banned, ...d.bannedIps]} empty={T('Nobody banned.')} action={running && <Btn className="sm" icon={Ban} onClick={() => ask(T('Ban player'), 'ban ', { exclude: lists.isBanned, reason: true, confirm: T('Ban'), danger: true })}>Ban</Btn>} remove={(p) => (p.name ? `pardon ${p.name}` : `pardon-ip ${p.ip}`)} />
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
    if (!(await confirmDialog({ title: `Delete ${sel.size} backups?`, text: sel.list.join('\n'), confirm: 'Delete', danger: true }))) return;
    let last = null; for (const f of sel.list) { try { last = await del(`/mc/servers/${s.id}/backups/${encodeURIComponent(f)}`); } catch (e) { toast.error(e.message); } }
    if (last) list.setData(last); else list.reload(); sel.clear(); toast.success('Deleted');
  };
  return (
    <div className="card mc-scroll">
      <div className="card-head"><Archive size={16} /><h3>Backups</h3><span className="small muted">as ZIP – also possible while the server runs</span>
        <div className="right"><Btn className="primary sm" icon={Plus} onClick={async () => { const label = await promptDialog({ title: 'Create backup', label: 'Label (optional)', placeholder: 'vor-update' }); if (label === null) return; await post(`/mc/servers/${s.id}/backups`, { label }); toast('Backup running …'); setTimeout(list.reload, 3000); }}>Create backup</Btn></div>
      </div>
      {nc && <div className="card-body"><SettingRow title={<>Back up every night <InfoTip>{T(`A backup at ${nc.hour ?? 3}:00, the last ${nc.keep || 7} automatic ones stay. If the PC was off at night, Hostwerk catches up – for a stopped server only if something changed.`)}{nc.lastError ? ` ${T(`Last failed: ${nc.lastError}`)}` : ''}</InfoTip></>} text={nc.lastRun ? `Last: ${fmtDate(nc.lastRun)}` : undefined}><Switch checked={!!nc.enabled} onChange={(v) => saveNightly({ enabled: v })} /></SettingRow></div>}
      {s.proc.state === 'running' && list.data && list.data.length > 0 && <div className="info-line"><Info size={13} /><span className="grow">Restoring only works while the server is stopped.</span><SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" /></div>}
      {!list.data ? <Loading /> : list.data.length === 0 ? <Empty icon={Archive} title="No backups yet" text="Create a backup before bigger changes (updates, new plugins)." /> : (
        <>
        <BulkBar sel={sel}><Btn className="xs" icon={Download} onClick={() => downloadAll(sel.list.map((f) => `/api/mc/servers/${s.id}/backups/${encodeURIComponent(f)}/download`))}>Download</Btn><Btn className="xs danger" icon={Trash2} onClick={removeSel}>Delete</Btn></BulkBar>
        <div className="mc-scroll-body">
        <table className="table sticky-head">
          <thead><tr><th style={{ width: 28 }}><SelectAll sel={sel} /></th><th>File</th><th>Created</th><th className="num">Size</th><th /></tr></thead>
          <tbody>
            {list.data.map((b) => (
              <tr key={b.file} className={sel.has(b.file) ? 'picked' : ''}>
                <td><SelectBox sel={sel} id={b.file} label={b.file} /></td>
                <td className="mono small">{b.file}</td><td>{fmtDate(b.time)}</td><td className="num">{b.sizeText}</td>
                <td className="actions">
                  <a className="btn ghost xs" href={`/api/mc/servers/${s.id}/backups/${encodeURIComponent(b.file)}/download`}><Download />Download</a>
                  <Btn className="ghost xs" icon={RotateCcw} disabled={s.proc.state !== 'stopped' && s.proc.state !== 'error'} title={s.proc.state === 'running' ? 'Stop the server first' : ''} onClick={async () => { if (await confirmDialog({ title: 'Restore backup?', text: `The current state will be replaced by “${b.file}”. A safety backup is created automatically first.`, confirm: 'Restore', danger: true })) { await post(`/mc/servers/${s.id}/backups/restore`, { file: b.file }); toast('Restore running …'); setTimeout(list.reload, 4000); } }}>Restore</Btn>
                  <Btn className="ghost xs icon" icon={Trash2} title="Delete" onClick={async () => { if (await confirmDialog({ title: 'Delete backup?', text: b.file, confirm: 'Delete', danger: true })) list.setData(await del(`/mc/servers/${s.id}/backups/${encodeURIComponent(b.file)}`)); }} />
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
        <div className="card-head"><ArrowUpCircle size={16} /><h3>Change version</h3></div>
        <div className="card-body stack">
          <div className="row"><span className="muted">Current:</span><b>{s.typeLabel} {s.version}</b>{s.build && <span className="badge">Build {s.build}</span>}</div>
          <div className="row-tight info-row"><NotesButton product="minecraft" version={s.version} label={`Minecraft ${s.version}: what's new`} />{['paper', 'purpur'].includes(s.type) && <NotesButton product={s.type} version={s.version} label="Latest builds" />}<CompareButton kind="mc" current={s.type} label="Compare server software" /></div>
          {version && version !== s.version && type !== 'custom' && <div className="row-tight info-row"><NotesButton product="minecraft" version={version} label={`What does ${version} bring?`} /></div>}
          <Field label="Software"><div className="seg" style={{ flexWrap: 'wrap' }}>{types.filter((t) => t.id !== 'modpack' && t.edition !== 'bedrock' && (s.proxy ? t.id === 'velocity' : t.id !== 'velocity')).map((t) => <button key={t.id} className={type === t.id ? 'active' : ''} onClick={() => { setType(t.id); setVersion(''); }}>{t.label}</button>)}</div></Field>
          {(() => { const t = types.find((x) => x.id === type); return t && type !== 'custom' && t.content !== s.content ? <Callout kind="warn">{t.content === 'mods' ? `After switching, the server uses mods (folder mods/) – existing plugins won’t run on ${t.label}.` : `After switching, the server uses plugins (folder plugins/) – existing mods won’t run on ${t.label}.`} The world is kept.</Callout> : null; })()}
          {type === 'custom'
            ? <DropZone accept=".jar" onFiles={async (f) => { const fd = new FormData(); fd.append('file', f[0]); setUpload(await api('POST', '/mc/upload-jar', fd)); }}><Upload size={22} /><div className="bold">{upload ? upload.name : 'Choose JAR'}</div></DropZone>
            : <Field label="Version"><VersionPicker type={type} value={version} onChange={setVersion} /></Field>}
          <Callout kind="warn">Create a backup first. Switching to an <b style={{ display: 'inline' }}>older</b> version can damage worlds. The old JAR is kept as <code>server.jar.alt</code>.</Callout>
          <SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" size="sm" /><Btn className="primary" disabled={running || (type === 'custom' ? !upload : !version)} title={running ? 'Stop the server first' : ''} onClick={async () => { await post(`/mc/servers/${s.id}/version`, { type, version, uploadId: upload && upload.uploadId }); toast('Downloading new version …'); }}>
            {type === s.type && version === s.version ? 'Download latest build of the same version' : 'Change version'}
          </Btn>
          {running && <span className="small muted">Stop the server to change the version.</span>}
        </div>
      </div>
      {type !== 'custom' && <SafeUpgradeCard s={s} type={type} version={version} />}
      <div className="card">
        <div className="card-head"><Skull size={16} /><h3>Danger zone</h3></div>
        <div className="card-body stack">
          <p className="muted" style={{ margin: 0 }}>Deletes the server including world, plugins and settings. Backups stay in the backup folder.</p>
          <Btn className="danger" icon={Trash2} disabled={running} onClick={async () => {
            if (await confirmDialog({ title: `Delete “${s.name}” permanently?`, text: `Folder: ${s.dir}`, confirm: 'Delete permanently', danger: true, typeToConfirm: s.name })) { await del(`/mc/servers/${s.id}`); location.hash = '/mc'; toast.success('Server deleted'); }
          }}>Delete server</Btn>
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
  if (!s) return <div className="page"><Empty icon={Box} title="Server not found"><a className="btn" href="#/mc">Back to overview</a></Empty></div>;
  // 7 Bereiche statt 12 Reiter – Zusammengehöriges liegt als Unterreiter beisammen (Adressen bleiben gleich)
  const bedrock = isBedrock(s);
  const groups = bedrock ? [
    // Bedrock Dedicated Server: keine Plugins, keine Datapacks, keine Karte – Spieler über Erlaubnisliste und Rechte
    { id: 'overview', label: T('Overview'), icon: LayoutDashboard, subs: [['overview']] },
    { id: 'console', label: T('Console'), icon: TerminalSquare, subs: [['console', 'Live', TerminalSquare], ['logs', T('Older logs'), History]] },
    { id: 'players', label: T('Players'), icon: Users, badge: mcCount(s), subs: [['players', T('Administration'), Users], ['stats', T('Statistics'), BarChart3]] },
    { id: 'worlds', label: T('World'), icon: Globe2, subs: [['worlds']] },
    { id: 'settings', label: T('Settings'), icon: Settings2, subs: [['settings', 'Server', Settings2], ['automation', T('Schedule & check'), CalendarClock], ['version', 'Version', ArrowUpCircle]] },
    { id: 'files', label: T('Files'), icon: FolderOpen, subs: [['files', T('Files'), FolderOpen], ['backups', T('Backups'), Archive]] },
  ] : s.proxy ? [
    // Velocity-Proxy: keine Welt, keine server.properties – dafür das Netzwerk
    { id: 'overview', label: T('Overview'), icon: LayoutDashboard, subs: [['overview']] },
    { id: 'network', label: T('Network'), icon: Network, subs: [['network']] },
    { id: 'console', label: T('Console'), icon: TerminalSquare, subs: [['console', 'Live', TerminalSquare], ['logs', T('Older logs'), History]] },
    { id: 'plugins', label: 'Plugins', icon: Puzzle, subs: [['plugins', T('Installed'), Puzzle], ['market', T('Marketplace'), Store]] },
    { id: 'settings', label: T('Settings'), icon: Settings2, subs: [['automation', T('Schedule & check'), CalendarClock], ['tools', T('Copy & lists'), Wrench], ['version', 'Version', ArrowUpCircle], ['tools', T('Copy & lists'), Wrench]] },
    { id: 'files', label: T('Files'), icon: FolderOpen, subs: [['files', T('Files'), FolderOpen], ['backups', T('Backups'), Archive]] },
  ] : [
    { id: 'overview', label: T('Overview'), icon: LayoutDashboard, subs: [['overview']] },
    { id: 'console', label: T('Console'), icon: TerminalSquare, subs: [['console', 'Live', TerminalSquare], ['logs', T('Older logs'), History], ['crashes', T('Crash reports'), Bug]] },
    { id: 'players', label: T('Players'), icon: Users, badge: mcCount(s), subs: [['players', T('Administration'), Users], ['stats', T('Statistics'), BarChart3]] },
    { id: 'plugins', label: s.content === 'mods' ? 'Mods' : 'Plugins', icon: Puzzle, subs: [['plugins', T('Installed'), Puzzle], ...(s.pluginsSupported ? [['market', T('Marketplace'), Store]] : []), ...(s.content !== 'mods' && s.pluginsSupported ? [['configs', T('Settings'), SlidersHorizontal]] : [])] },
    { id: 'worlds', label: T('World'), icon: Globe2, subs: [['worlds', T('Worlds & rules'), Globe2], ['datapacks', 'Datapacks', Package], ['map', T('Map'), MapIcon]] },
    { id: 'settings', label: T('Settings'), icon: Settings2, subs: [['settings', 'Server', Settings2], ['automation', T('Schedule & check'), CalendarClock], ['version', 'Version', ArrowUpCircle]] },
    { id: 'files', label: T('Files'), icon: FolderOpen, subs: [['files', T('Files'), FolderOpen], ['backups', T('Backups'), Archive]] },
  ];
  for (const x of contrib.tabs) groups.push({ id: x.key, label: x.label, icon: x.icon, subs: [[x.key]] });
  const group = groups.find((g) => g.subs.some(([sid]) => sid === tab)) || groups[0];
  const tabs = groups.map(({ subs, ...g }) => g);
  const go = (t) => { location.hash = `/mc/${s.id}/${t}`; };
  return (
    <div className="page fade-in mc-page">
      <div className="page-head">
        <div>
          <h1><SvcImage kind="mc" id={s.id} name={s.name} className="ico" size={30} fallback={<Box size={22} style={{ color: '#23964a' }} />} /> <Keep>{s.name}</Keep> <FavButton kind="mc" id={s.id} /> <StatusPill state={s.proc.state} label={s.proc.state === 'running' && !s.proc.extra.ready ? 'Loading world …' : undefined} /></h1>
          <p>{bedrock ? T(`${s.typeLabel} ${s.version || ''} · UDP-Port ${s.port}`) : <>{s.modpack ? `Modpack ${s.modpack.name} · ` : ''}{s.typeLabel} {s.version}{s.build ? ` (${s.content === 'mods' ? 'Loader' : 'Build'} ${s.build})` : ''} · Java {s.javaMajor} · {(s.memMax / 1024).toFixed(1).replace('.', ',')} GB RAM · port {s.port}</>} <SourceLink url={s.modpack && s.modpack.projectId ? `https://modrinth.com/project/${s.modpack.projectId}` : s.homepage} /></p>
        </div>
        <div className="actions">
          {isElectron && <Btn className="ghost" icon={ExternalLink} onClick={() => post('/app/open-path', { path: s.dir })}>Folder</Btn>}
          <ServiceButtons base={`/mc/servers/${s.id}`} state={s.proc.state} />
        </div>
      </div>
      {s.proc.state === 'error' && <div className="mb"><ErrorHelp proc={s.proc} svc={'mc:' + s.id} /></div>}
      {!bedrock && s.updates && (s.updates.modpack || s.updates.addons > 0 || s.updates.server || s.updates.mcVersion) && tab !== 'version' && tab !== 'plugins' && (
        <div className="mb"><Callout kind="info" title="Updates available">
          {s.updates.server && <div>{s.autoServerUpdates !== false ? `${s.typeLabel} ${s.version} build #${s.updates.server.build} – applied automatically at the next stop.` : `${s.typeLabel} ${s.version} build #${s.updates.server.build} available.`} <a href={`#/mc/${s.id}/version`}>Version →</a></div>}
          {s.updates.mcVersion && <div>{`Minecraft ${s.updates.mcVersion} has been released.`} <a href={`#/mc/${s.id}/version`}>Update safely (with a trial run) →</a></div>}
          {s.updates.modpack && <>Modpack <b>{s.updates.modpack.number}</b>{s.updates.modpack.mcChange ? ` (Minecraft ${s.updates.modpack.mc})` : ''} – <a href={`#/mc/${s.id}/version`}>view and install →</a> </>}
          {s.updates.addons > 0 && <>{s.updates.addons} {s.content === 'mods' ? 'Mod' : 'Plugin'}-Update{s.updates.addons > 1 ? 's' : ''} – <a href={`#/mc/${s.id}/plugins`}>update →</a></>}
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
