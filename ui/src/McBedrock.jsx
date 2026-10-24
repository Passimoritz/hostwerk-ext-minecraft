import { useEffect, useState } from 'react';
import { Users, Gauge, Globe2, ShieldCheck, Copy, Settings2, Save, Search, TerminalSquare, Download, RotateCcw, ArrowUpCircle, RefreshCw, UserPlus, Trash2, Crown, Smartphone, Skull, Archive, Router } from 'lucide-react';
import { post, put, del, useApi, useLogs, fmtBytes, fmtDate, waitJob } from '@hostwerk/api';
import { Btn, Field, Switch, SettingRow, Seg, Empty, Loading, Callout, StatusPill, toast, confirmDialog, InfoTip, TileEmpty, useFillHeight } from '@hostwerk/ui';
import { ProcStats, SvcShortcut } from '@hostwerk/kit';
import { Console } from '@hostwerk/kit';
import { t as T, pl } from '@hostwerk/i18n';

/*
 * Bedrock Dedicated Server im Minecraft-Bereich (Kern-Typ „bedrock“): eigene Reiter statt der Java-Reiter – keine
 * Plugins, kein Java, UDP statt TCP, Erlaubnisliste und Rechte (über die Xbox-Kennung) statt Whitelist/OPs.
 * Konsole, Sicherungen, Zeitplan und Dateien teilt er sich mit den Java-Servern (MinecraftServer.jsx).
 */

const BDS_COMMANDS = ['list', 'say ', 'kick ', 'op ', 'deop ', 'allowlist add ', 'allowlist remove ', 'allowlist list', 'permission list', 'gamemode creative ', 'gamemode survival ', 'time set day', 'time set night', 'weather clear', 'difficulty ', 'gamerule ', 'tp ', 'give ', 'save hold', 'save resume', 'stop'];
const LEVEL_LABEL = { visitor: 'Visitor', member: 'Member', operator: 'Operator' };

/*
 * NetherNet (ab Bedrock 26.60 der einzige Weg): Zustand aus bedrock.status().netherNet – „bereit“ nur, wenn der Server
 * auf GET /v1/join geantwortet hat; sonst ehrlich „unbekannt“ (Mojang beschreibt keine Statusabfrage).
 */
const NN_STATE = { ready: ['ok', 'NetherNet ready'], configured: ['info', 'NetherNet set'], unknown: ['', 'NetherNet: state unknown'], raknet: ['warn', 'RakNet only'] };
function NetherNetBadge({ nn }) {
  if (!nn) return null;
  const [kind, label] = NN_STATE[nn.state] || NN_STATE.unknown;
  return (
    <span className="row-tight">
      <span className={`badge ${kind}`}>{label}</span>
      <InfoTip title="NetherNet">
        {nn.state === 'raknet'
          ? 'The settings say “transport=raknet”. From Bedrock 26.60 (27 October 2026) no player gets in that way – set it to “nethernet”.'
          : 'New Bedrock apps connect over NetherNet: they sign in over TCP on the server port and then play over UDP. Hostwerk opens TCP next to UDP in the firewall and router for it.'}
        {nn.state === 'unknown' && nn.transport !== 'raknet' ? ' The server did not answer the status request, or this version does not describe NetherNet – players usually get in anyway.' : ''}
        {nn.identity ? ' The server identity is saved – players only have to trust it once.' : ''}
      </InfoTip>
    </span>
  );
}

/** Adressen zum Verbinden (UDP, bei NetherNet auch TCP) – mit Kopierknopf und Hinweis für Freunde von außen. */
function Addresses({ s }) {
  const nn = (s.bedrock || {}).netherNet;
  const tcp = !(nn && nn.state === 'raknet');
  return (
    <div className="stack mcb-gap">
      <div className="label row-tight">Connect <InfoTip title="How friends get in">In Minecraft (Bedrock) go to Play → Servers → “Add server” and enter the address and the port. For friends outside your network, forward the port in the router (UDP and TCP) – or “Router & port forwarding” does it by itself.</InfoTip><NetherNetBadge nn={nn} /></div>
      {[s.address.local, ...s.address.lan].map((a) => <div key={a} className="row-tight"><code className="grow ellipsis">{a}</code><span className="badge">{tcp ? 'UDP + TCP' : 'UDP'}</span><button className="btn ghost xs icon" title="Copy" aria-label="Copy" onClick={() => { navigator.clipboard.writeText(a); toast.success('Address copied'); }}><Copy /></button></div>)}
      {s.portv6 ? <div className="tiny muted">{T(`IPv6: Port ${s.portv6} (UDP)`)}</div> : null}
      {nn && nn.udp && nn.udp.length > 0 ? <div className="tiny muted">{T(`NetherNet game ports: ${nn.udp.length > 3 ? `${nn.udp[0]}–${nn.udp[nn.udp.length - 1]}` : nn.udp.join(', ')} (UDP)`)}</div> : null}
    </div>
  );
}

export function BedrockOverview({ s }) {
  const running = s.proc.state === 'running';
  const ready = running && s.proc.extra.ready;
  const players = s.proc.extra.players || [];
  const worlds = useApi(`/mc/servers/${s.id}/worlds`);
  const test = useApi(`/mc/servers/${s.id}/selftest`);
  const b = s.bedrock || {};
  const worldSize = worlds.data ? worlds.data.worlds.reduce((n, w) => n + w.size, 0) : null;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card stat"><div className="k"><Users />Players</div><div className="v">{players.length}<span className="muted mcb-of"> / {s.proc.extra.maxPlayersLive || s.maxPlayers || 10}</span></div><div className="s">{running ? (ready ? 'online' : 'World loading …') : 'Server stopped'}</div></div>
        <div className="card stat"><div className="k"><Smartphone />Version</div><div className="v mcb-ver">{s.version || '–'}</div><div className="s">{b.update ? <a href={`#/mc/${s.id}/version`}>{T(`${b.latest} is out →`)}</a> : b.preview ? 'Preview' : 'current'}</div></div>
        <div className="card stat"><div className="k"><Globe2 />Worlds</div><div className="v">{worldSize != null ? fmtBytes(worldSize) : '…'}</div><div className="s">{worlds.data ? pl(worlds.data.worlds.length, '{n} world', '{n} worlds') : ''}</div></div>
        <div className="card stat"><div className="k"><ShieldCheck />Check</div><div className="v mcb-check">{test.data ? (test.data.ok ? <span className="mcb-ok">passed</span> : <span className="mcb-bad">Problems</span>) : <span className="muted">–</span>}</div><div className="s">{test.data ? fmtDate(test.data.at) : <a href={`#/mc/${s.id}/automation`}>check now →</a>}</div></div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><Gauge size={16} /><h3>Health</h3><div className="right"><StatusPill state={s.proc.state} label={running && !ready ? 'Loading world …' : undefined} /></div></div>
          <div className="card-body stack">
            {running ? <ProcStats proc={s.proc} svc={`mc:${s.id}`} /> : <div className="small muted">The server is stopped.</div>}
            <Addresses s={s} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><Users size={16} /><h3>{T(`Online (${players.length})`)}</h3><div className="right"><a className="btn ghost sm" href={`#/mc/${s.id}/players`}>Player management</a></div></div>
          {players.length === 0 ? <TileEmpty icon={Users} text={running ? 'Nobody online.' : 'Server is stopped.'} /> : (
            <ul className="mcb-list card-body">{players.map((p) => <li key={p} data-row-menu><span className="grow ellipsis">{p}</span><Btn className="ghost xs" onClick={() => post(`/mc/servers/${s.id}/command`, { command: `kick "${p}"` }).catch((e) => toast.error(e.message))}>Rauswerfen</Btn></li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function BedrockConsole({ s }) {
  const [lines] = useLogs(`mc:${s.id}`, `/mc/servers/${s.id}/logs`);
  const fill = useFillHeight({ min: 360 });
  const running = s.proc.state === 'running';
  const cmd = (c) => post(`/mc/servers/${s.id}/command`, { command: c }).catch((e) => toast.error(e.message));
  return (
    <div ref={fill} className="mcb-console">
      <Console lines={lines} height="100%" onCommand={running ? cmd : null} onClear={() => del(`/logs/mc:${s.id}`)} suggestions={BDS_COMMANDS} placeholder="Enter a command without /, e.g. “say Hello”" />
    </div>
  );
}

/* server.properties des Bedrock-Servers als Katalog (Schlüssel, Bezeichnung, Art, Erklärung) */
const BDS_GROUPS = [
  { id: 'allgemein', label: 'General', icon: Settings2, fields: [
    ['server-name', 'Servername', 'text', 'This is the server’s name in the in-game list.'],
    ['server-port', 'Port (IPv4, UDP)', 'number', 'Default 19132. Hostwerk keeps track of it – firewall and router follow.'],
    ['server-portv6', 'Port (IPv6, UDP)', 'number', 'Standard 19133.'],
    // nur, wenn die Vorlage der installierten Version die Schlüssel kennt (5. Feld „nn“)
    ['transport', 'Connection method', ['nethernet', 'raknet'], 'nethernet is the default and from Bedrock 26.60 (27 October 2026) the only way players get in.', 'nn'],
    ['server-udp-ports', 'NetherNet game ports (UDP)', 'text', 'Leave it empty – the server then picks its own and finds its way through the router. Hostwerk opens ports you enter in the firewall and router.', 'nn'],
    ['max-players', 'Max. players', 'number', 'How many may play at the same time.'],
    ['online-mode', 'Xbox sign-in required', 'bool', 'Only players with a Microsoft account (recommended).'],
    ['allow-list', 'Allow list only', 'bool', 'Only players on the allow list may join (under “Players”).'],
    ['default-player-permission-level', 'New players are', ['visitor', 'member', 'operator'], 'Visitors may only look, members build, operators do everything.'],
    ['player-idle-timeout', 'Disconnect idle players (min.)', 'number', '0 = never.'],
  ] },
  { id: 'welt', label: 'World & game', icon: Globe2, fields: [
    ['level-name', 'World', 'text', 'Folder under worlds/. A new name creates a new world.'],
    ['level-seed', 'Seed', 'text', 'Only applies to a new world.'],
    ['gamemode', 'Game mode', ['survival', 'creative', 'adventure'], ''],
    ['force-gamemode', 'Force game mode', 'bool', 'Everyone starts in the set mode.'],
    ['difficulty', 'Difficulty', ['peaceful', 'easy', 'normal', 'hard'], ''],
    ['allow-cheats', 'Allow commands', 'bool', 'Cheats for operators (achievements are off then).'],
    ['texturepack-required', 'Require resource packs', 'bool', 'Players have to load the world’s packs.'],
  ] },
  { id: 'leistung', label: 'Performance', icon: Gauge, fields: [
    ['view-distance', 'View distance (chunks)', 'number', 'Biggest effect on RAM and CPU.'],
    ['tick-distance', 'Simulation distance (4–12)', 'number', 'How far the world around players is alive.'],
    ['max-threads', 'Max. Threads', 'number', '0 = as many as possible.'],
    ['compression-threshold', 'Compression from (bytes)', 'number', ''],
    ['enable-lan-visibility', 'Visible in the local network', 'bool', 'Shows up under “Friends” on devices in the same network.'],
    ['content-log-file-enabled', 'Log content errors', 'bool', 'Write errors in add-ons to a file.'],
  ] },
];

export function BedrockSettings({ s }) {
  const props = useApi(`/mc/servers/${s.id}/properties`, [], { live: false });
  const [p, setP] = useState(null);
  const [orig, setOrig] = useState(null);
  const [group, setGroup] = useState('allgemein');
  const [q, setQ] = useState('');
  const [cfg, setCfg] = useState({ name: s.name, autostart: s.autostart, autoRestart: s.autoRestart, autoCheck: s.autoCheck !== false, autoServerUpdates: s.autoServerUpdates !== false });
  useEffect(() => { if (props.data) { setP(props.data); setOrig(props.data); } }, [props.data]);
  if (!p) return props.error ? <Callout kind="err">{props.error}</Callout> : <Loading />;
  const running = s.proc.state === 'running';
  const changed = Object.keys(p).filter((k) => p[k] !== (orig || {})[k]);
  const saveProps = async () => {
    const patch = {}; for (const k of changed) patch[k] = p[k];
    try { const r = await put(`/mc/servers/${s.id}/properties`, patch); setP(r); setOrig(r); toast.success(running ? 'Saved – takes effect after a restart' : 'Saved'); } catch (e) { toast.error(e.message); }
  };
  const saveCfg = async () => { try { await put(`/mc/servers/${s.id}`, cfg); toast.success('Saved'); } catch (e) { toast.error(e.message); } };
  const needle = q.trim().toLowerCase();
  const nnKnown = !!(s.bedrock && s.bedrock.netherNet && s.bedrock.netherNet.known);
  const fields = (needle ? BDS_GROUPS.flatMap((x) => x.fields.filter(([k, l, , h]) => `${k} ${T(l)} ${T(h || '')}`.toLowerCase().includes(needle))) : (BDS_GROUPS.find((x) => x.id === group) || BDS_GROUPS[0]).fields).filter((x) => x[4] !== 'nn' || nnKnown);
  const field = ([k, label, type, hint]) => {
    const dirty = p[k] !== (orig || {})[k];
    const val = p[k] ?? '';
    const head = <>{label}{dirty && <span className="badge warn mcb-dirty">changed</span>}</>;
    if (type === 'bool') return <SettingRow key={k} title={head} text={hint || k}><Switch checked={val === 'true'} label={label} onChange={(v) => setP({ ...p, [k]: v ? 'true' : 'false' })} /></SettingRow>;
    return (
      <Field key={k} label={head} hint={hint || k}>
        {Array.isArray(type)
          ? <select className="select" value={val} aria-label={label} onChange={(e) => setP({ ...p, [k]: e.target.value })}>{!type.includes(val) && <option value={val}>{val || T('(not set)')}</option>}{type.map((o) => <option key={o} value={o}>{LEVEL_LABEL[o] ? T(LEVEL_LABEL[o]) : o}</option>)}</select>
          : <input className={`input ${type === 'number' ? 'mono' : ''}`} type={type} value={val} aria-label={label} onChange={(e) => setP({ ...p, [k]: e.target.value })} />}
      </Field>
    );
  };
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><Settings2 size={16} /><h3>Game (server.properties)</h3>{changed.length > 0 && <span className="badge warn">{T(`${changed.length} unsaved`)}</span>}
          <div className="right row-tight">
            {changed.length > 0 && <Btn className="ghost sm" onClick={() => setP(orig)}>Discard</Btn>}
            <Btn className="primary sm" icon={Save} disabled={!changed.length} onClick={saveProps}>Save</Btn>
          </div>
        </div>
        <div className="card-body stack">
          <div className="row mcb-wrap">
            <Seg value={needle ? '' : group} onChange={(v) => { setQ(''); setGroup(v); }} options={BDS_GROUPS.map((x) => ({ id: x.id, label: x.label, icon: x.icon }))} />
            <div className="input-icon mcb-search"><Search /><input className="input sm" placeholder="Search setting …" aria-label="Search settings" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {fields.length === 0 && <div className="small muted">Nothing found.</div>}
          <div className="form-grid">{fields.filter((x) => x[2] !== 'bool').map(field)}</div>
          <div>{fields.filter((x) => x[2] === 'bool').map(field)}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><TerminalSquare size={16} /><h3>Start & care</h3><div className="right"><Btn className="primary sm" icon={Save} onClick={saveCfg}>Save</Btn></div></div>
        <div className="card-body">
          <Field label="Name in Hostwerk"><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
          <SettingRow title="Start with Hostwerk"><Switch checked={!!cfg.autostart} label="Start with Hostwerk" onChange={(v) => setCfg({ ...cfg, autostart: v })} /></SettingRow>
          <SettingRow title="Restart after crash"><Switch checked={!!cfg.autoRestart} label="Restart after crash" onChange={(v) => setCfg({ ...cfg, autoRestart: v })} /></SettingRow>
          <SettingRow title="Check after every start"><Switch checked={!!cfg.autoCheck} label="Check after every start" onChange={(v) => setCfg({ ...cfg, autoCheck: v })} /></SettingRow>
          <SettingRow title={<>Install new Bedrock versions by itself <InfoTip>Bedrock players only get in with a matching app version. Hostwerk installs new versions as soon as nobody plays – with a probe start and a way back if something goes wrong.</InfoTip></>}><Switch checked={!!cfg.autoServerUpdates} label="Install new Bedrock versions by itself" onChange={(v) => setCfg({ ...cfg, autoServerUpdates: v })} /></SettingRow>
        </div>
      </div>
    </div>
  );
}

export function BedrockPlayers({ s }) {
  const d = useApi(`/mc/servers/${s.id}/bedrock`, [s.id]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (!d.data) return d.error ? <Callout kind="err">{d.error}</Callout> : <Loading />;
  const l = d.data.lists;
  const set = (lists) => d.setData({ ...d.data, lists });
  const add = async () => { if (!name.trim()) return; setBusy(true); try { set(await post(`/mc/servers/${s.id}/bedrock/allowlist`, { name: name.trim() })); setName(''); toast.success('On the allow list'); } catch (e) { toast.error(e.message); } setBusy(false); };
  const remove = async (n) => { try { set(await post(`/mc/servers/${s.id}/bedrock/allowlist`, { name: n, remove: true })); } catch (e) { toast.error(e.message); } };
  const level = async (who, lv) => { try { set(await put(`/mc/servers/${s.id}/bedrock/permission`, { who, level: lv || null })); toast.success('Permissions saved'); } catch (e) { toast.error(e.message); } };
  const permOf = (xuid) => (l.permissions.find((x) => x.xuid === xuid) || {}).permission || '';
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><ShieldCheck size={16} /><h3>Allow list</h3>
          <span className={`badge ${l.allowListOn ? 'ok' : ''}`}>{l.allowListOn ? 'on' : 'off'}</span>
          <InfoTip>When it is on, only players on this list get in. Switch it on under Settings → “Allow list only”. Enter the gamertag (Xbox name).</InfoTip>
        </div>
        <div className="card-body stack">
          <form className="row-tight" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input className="input sm grow" value={name} maxLength={32} placeholder="Gamertag, z. B. Steve123" aria-label="Gamertag" onChange={(e) => setName(e.target.value)} />
            <Btn className="sm primary" icon={UserPlus} busy={busy} disabled={!name.trim()} type="submit">Add</Btn>
          </form>
          {l.allowlist.length === 0 ? <TileEmpty icon={ShieldCheck} text="Nobody on the list yet." /> : (
            <table className="table">
              <tbody>{l.allowlist.map((x) => <tr key={x.name || x.xuid}><td className="grow">{x.name || x.xuid}</td><td className="tiny muted">{x.xuid ? 'known' : 'not been here yet'}</td><td className="actions"><button className="btn ghost xs icon" title="Remove" aria-label={T(`Remove ${x.name}`)} onClick={() => remove(x.name)}><Trash2 /></button></td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><Crown size={16} /><h3>Permissions</h3>
          <InfoTip>Bedrock gives permissions by Xbox ID. Hostwerk learns it as soon as someone has been on the server once – so everyone who has been here is listed. “Default” means: as under Settings → “New players are”.</InfoTip>
        </div>
        {l.known.length === 0 ? <TileEmpty icon={Users} text="Nobody has been on the server yet." /> : (
          <table className="table">
            <thead><tr><th>Players</th><th>Last da</th><th>Level</th></tr></thead>
            <tbody>{l.known.map((x) => (
              <tr key={x.xuid}>
                <td>{x.name}{l.online.includes(x.name) && <span className="badge ok mcb-dirty">online</span>}</td>
                <td className="small muted">{x.seen ? fmtDate(x.seen) : '–'}</td>
                <td><select className="select sm" value={permOf(x.xuid)} aria-label={T(`Level of ${x.name}`)} onChange={(e) => level(x.xuid, e.target.value)}><option value="">{T(`Standard (${T(LEVEL_LABEL[l.defaultPermission] || l.defaultPermission)})`)}</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{T(v)}</option>)}</select></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function BedrockWorlds({ s }) {
  const w = useApi(`/mc/servers/${s.id}/worlds`);
  const stopped = s.proc.state !== 'running' && s.proc.state !== 'starting';
  if (!w.data) return w.error ? <Callout kind="err">{w.error}</Callout> : <Loading />;
  const reset = async (x) => {
    if (!(await confirmDialog({ title: T(`Reset world “${x.label}”?`), text: 'Hostwerk makes a backup first. The next start creates a new world.', confirm: 'Revert', danger: true }))) return;
    try { await waitJob((await post(`/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/reset`)).job); toast.success('World reset'); w.reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><Globe2 size={16} /><h3>Worlds</h3><InfoTip>Bedrock worlds live under worlds/. Which one runs is set by “World” in the settings. Put finished worlds (unpacked .mcworld) into worlds/ under Files.</InfoTip></div>
      {w.data.worlds.length === 0 ? <Empty icon={Globe2} title="No world yet" text="The server creates the world at its first start." /> : (
        <table className="table">
          <thead><tr><th>World</th><th>Folder</th><th className="num">Size</th><th /></tr></thead>
          <tbody>{w.data.worlds.map((x) => (
            <tr key={x.name}>
              <td>{x.label}{x.main && <span className="badge ok mcb-dirty">running</span>}</td><td className="mono small">{x.name}</td><td className="num">{fmtBytes(x.size)}</td>
              <td className="actions">
                <a className="btn ghost xs" href={`/api/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/download`}><Download />Download</a>
                <Btn className="ghost xs" icon={RotateCcw} disabled={!stopped} title={stopped ? 'Reset world' : 'Stop the server first'} onClick={() => reset(x)}>Revert</Btn>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {!stopped && <div className="info-line"><Archive size={13} /><span className="grow">Resetting only works while the server is stopped.</span><SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" /></div>}
    </div>
  );
}

export function BedrockVersion({ s }) {
  const b = s.bedrock || {};
  const [busy, setBusy] = useState(null);
  const check = async () => { setBusy('check'); try { const r = await post(`/mc/servers/${s.id}/bedrock/check`); toast.success(r.update ? T(`Version ${r.latest} is out`) : 'Already up to date'); } catch (e) { toast.error(e.message); } setBusy(null); };
  const update = async (version) => {
    if (s.proc.extra.players && s.proc.extra.players.length && !(await confirmDialog({ title: 'Update now?', text: 'People are playing right now – they get kicked briefly while the server restarts.', confirm: 'Update anyway' }))) return;
    setBusy(version || 'update');
    try { const r = await waitJob((await post(`/mc/servers/${s.id}/bedrock/update`, { version, force: true })).job); toast.success(r.result && r.result.upToDate ? 'Already up to date' : T(`Bedrock ${r.result ? r.result.version : ''} is running`)); } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const remove = async () => {
    if (await confirmDialog({ title: T(`Delete “${s.name}” permanently?`), text: T(`Folder: ${s.dir}`), confirm: 'Delete permanently', danger: true, typeToConfirm: s.name })) { try { await del(`/mc/servers/${s.id}`); location.hash = '/mc'; toast.success('Server deleted'); } catch (e) { toast.error(e.message); } }
  };
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><ArrowUpCircle size={16} /><h3>Version</h3><InfoTip title="Update with a way back">Hostwerk unpacks the new version next to the old one, moves worlds and settings over, starts it as a probe and waits for an answer. If that fails, the old one runs again – and Hostwerk skips this version. The worlds are backed up first.</InfoTip></div>
        <div className="card-body stack">
          <div className="row-tight"><span className="muted">Running:</span><b>{s.version || '–'}</b>{b.preview && <span className="badge warn">Preview</span>}</div>
          <div className="row-tight"><span className="muted">Newest:</span><b>{b.latest || '–'}</b>{b.checkedAt && <span className="tiny muted">{T(`checked ${fmtDate(b.checkedAt)}`)}</span>}</div>
          {b.failed && <Callout kind="warn" dismissible={false}>{T(`Version ${b.failed} did not start and was rolled back – Hostwerk waits for a newer one.`)}</Callout>}
          {b.update && <Callout kind="info" dismissible={false}>{s.autoServerUpdates !== false ? T(`Version ${b.latest} comes by itself as soon as nobody plays.`) : T(`Version ${b.latest} is out.`)}</Callout>}
          <div className="row-tight mcb-wrap">
            <Btn className="sm ghost" icon={RefreshCw} busy={busy === 'check'} onClick={check}>Check for updates</Btn>
            <Btn className="sm primary" icon={Download} busy={busy === 'update'} disabled={!!busy} onClick={() => update(null)}>{b.update ? T(`Update to ${b.latest}`) : 'Reinstall'}</Btn>
            {!b.preview && <Btn className="sm ghost" busy={busy === 'preview'} disabled={!!busy} title="Mojang’s preview – only for trying out, players then need the Preview app" onClick={() => update('preview')}>Try the preview</Btn>}
          </div>
          <div className="tiny muted">Mojang only offers the newest version (and a preview) – older ones are gone there. Going back works through the backups.</div>
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <div className="card-head"><Router size={16} /><h3>Ports</h3><InfoTip>Bedrock uses UDP. Hostwerk puts both ports into the firewall rules, and with “Router & port forwarding” into the router too.</InfoTip></div>
          <div className="card-body stack">
            <div className="row-tight"><span className="grow">IPv4</span><code>{s.port}</code><span className="badge">UDP</span></div>
            {s.portv6 ? <div className="row-tight"><span className="grow">IPv6</span><code>{s.portv6}</code><span className="badge">UDP</span></div> : null}
            <a className="small" href="#/live/firewall">Firewall &amp; Router →</a>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><Skull size={16} /><h3>Danger zone</h3></div>
          <div className="card-body stack">
            <span className="small muted">Deletes the server with its worlds and settings. Backups stay in the backup folder.</span>
            <Btn className="danger sm" icon={Trash2} disabled={s.proc.state === 'running'} title={s.proc.state === 'running' ? 'Stop the server first' : undefined} onClick={remove}>Delete server</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Schritt 2 im Anlegen-Dialog für Bedrock: Port (UDP), Spieler, Modus, Schwierigkeit, Xbox-Anmeldung, Sicherung, EULA. */
export function BedrockCreateFields({ f, set }) {
  return (
    <>
      <div className="form-grid">
        <Field label="Port (UDP)" hint="Empty = automatic (from 19132)"><input className="input mono" type="number" placeholder="19132" value={f.port} onChange={(e) => set({ port: e.target.value })} /></Field>
        <Field label="Max. players"><input className="input" type="number" min={1} max={200} value={f.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} /></Field>
        <Field label="Game mode"><select className="select" value={f.gamemode === 'spectator' ? 'survival' : f.gamemode} onChange={(e) => set({ gamemode: e.target.value })}><option value="survival">Survival</option><option value="creative">Creative</option><option value="adventure">Adventure</option></select></Field>
        <Field label="Difficulty"><select className="select" value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}><option value="peaceful">Peaceful</option><option value="easy">Simple</option><option value="normal">Normal</option><option value="hard">Hard</option></select></Field>
        <Field label="World seed (optional)" className="span-2"><input className="input mono" value={f.seed} onChange={(e) => set({ seed: e.target.value })} /></Field>
      </div>
      <SettingRow title="Xbox sign-in required" text="Only players with a Microsoft account (recommended)."><Switch checked={f.onlineMode} label="Xbox sign-in required" onChange={(v) => set({ onlineMode: v })} /></SettingRow>
      <SettingRow title="Back up every night" text="Worlds and settings at 3 am, the last 7 are kept."><Switch checked={f.nightlyBackup} label="Back up every night" onChange={(v) => set({ nightlyBackup: v })} /></SettingRow>
      <label className="check mcb-eula">
        <input type="checkbox" checked={f.eula} onChange={(e) => set({ eula: e.target.checked })} />
        <span>I accept the <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft-EULA</a> and <a href="https://go.microsoft.com/fwlink/?LinkId=521839" target="_blank" rel="noreferrer">Mojang’s privacy policy</a>.</span>
      </label>
    </>
  );
}

/** Kurzer Hinweis im ersten Schritt: was Bedrock anders macht. */
export function BedrockPickInfo() {
  return <InfoTip>A server only for Bedrock (phone, tablet, console, Windows). No Java players, no Java plugins – but everything exactly like in Bedrock. Java and Bedrock together: a Java server with Geyser (extension “Minecraft server network”). Hostwerk downloads the server from minecraft.net (about 100 MB) and keeps it up to date.</InfoTip>;
}

export const isBedrock = (s) => !!(s && s.caps && s.caps.edition === 'bedrock');
