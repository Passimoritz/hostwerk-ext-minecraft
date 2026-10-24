import { useEffect, useState } from 'react';
import { Users, Gauge, Globe2, ShieldCheck, Copy, Settings2, Save, Search, TerminalSquare, Download, RotateCcw, ArrowUpCircle, RefreshCw, UserPlus, Trash2, Crown, Smartphone, Skull, Archive, Router } from 'lucide-react';
import { post, put, del, useApi, useLogs, fmtBytes, fmtDate, waitJob } from '@hostwerk/api';
import { Btn, Field, Switch, SettingRow, Seg, Empty, Loading, Callout, StatusPill, toast, confirmDialog, InfoTip, TileEmpty, useFillHeight } from '@hostwerk/ui';
import { ProcStats, SvcShortcut } from '@hostwerk/kit';
import { Console } from '@hostwerk/kit';
import { pl, tr } from '@hostwerk/kit';

/*
 * Bedrock Dedicated Server im Minecraft-Bereich (Kern-Typ „bedrock“): eigene Reiter statt der Java-Reiter – keine
 * Plugins, kein Java, UDP statt TCP, Erlaubnisliste und Rechte (über die Xbox-Kennung) statt Whitelist/OPs.
 * Konsole, Sicherungen, Zeitplan und Dateien teilt er sich mit den Java-Servern (MinecraftServer.jsx).
 */

const BDS_COMMANDS = ['list', 'say ', 'kick ', 'op ', 'deop ', 'allowlist add ', 'allowlist remove ', 'allowlist list', 'permission list', 'gamemode creative ', 'gamemode survival ', 'time set day', 'time set night', 'weather clear', 'difficulty ', 'gamerule ', 'tp ', 'give ', 'save hold', 'save resume', 'stop'];
const LEVEL_LABEL = { visitor: 'Besucher', member: 'Mitglied', operator: 'Operator' };

/*
 * NetherNet (ab Bedrock 26.60 der einzige Weg): Zustand aus bedrock.status().netherNet – „bereit“ nur, wenn der Server
 * auf GET /v1/join geantwortet hat; sonst ehrlich „unbekannt“ (Mojang beschreibt keine Statusabfrage).
 */
const NN_STATE = { ready: ['ok', 'NetherNet bereit'], configured: ['info', 'NetherNet eingestellt'], unknown: ['', 'NetherNet: Zustand unbekannt'], raknet: ['warn', 'Nur RakNet'] };
function NetherNetBadge({ nn }) {
  if (!nn) return null;
  const [kind, label] = NN_STATE[nn.state] || NN_STATE.unknown;
  return (
    <span className="row-tight">
      <span className={`badge ${kind}`}>{label}</span>
      <InfoTip title="NetherNet">
        {nn.state === 'raknet'
          ? 'In den Einstellungen steht „transport=raknet“. Ab Bedrock 26.60 (27. Oktober 2026) kommen damit keine Spieler mehr hinein – stell es auf „nethernet“.'
          : 'Neue Bedrock-Apps verbinden sich über NetherNet: Sie melden sich per TCP auf dem Server-Port an und spielen dann über UDP. Hostwerk öffnet dafür TCP zusätzlich zu UDP in Firewall und Router.'}
        {nn.state === 'unknown' && nn.transport !== 'raknet' ? ' Der Server hat auf die Statusabfrage nicht geantwortet oder die Version beschreibt NetherNet nicht – Spieler kommen trotzdem meist hinein.' : ''}
        {nn.identity ? ' Die Server-Identität ist gespeichert, Spieler müssen ihr nur einmal vertrauen.' : ''}
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
      <div className="label row-tight">Verbinden <InfoTip title="So kommen Freunde rein">In Minecraft (Bedrock) unter Spielen → Server → „Server hinzufügen“ die Adresse und den Port eintragen. Für Freunde außerhalb deines Netzwerks den Port im Router freigeben (UDP und TCP) – oder „Router & Portfreigaben“ macht es selbst.</InfoTip><NetherNetBadge nn={nn} /></div>
      {[s.address.local, ...s.address.lan].map((a) => <div key={a} className="row-tight"><code className="grow ellipsis">{a}</code><span className="badge">{tcp ? 'UDP + TCP' : 'UDP'}</span><button className="btn ghost xs icon" title="Kopieren" aria-label="Kopieren" onClick={() => { navigator.clipboard.writeText(a); toast.success('Adresse kopiert'); }}><Copy /></button></div>)}
      {s.portv6 ? <div className="tiny muted">{tr(`IPv6: Port ${s.portv6} (UDP)`)}</div> : null}
      {nn && nn.udp && nn.udp.length > 0 ? <div className="tiny muted">{tr(`NetherNet-Spielports: ${nn.udp.length > 3 ? `${nn.udp[0]}–${nn.udp[nn.udp.length - 1]}` : nn.udp.join(', ')} (UDP)`)}</div> : null}
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
        <div className="card stat"><div className="k"><Users />Spieler</div><div className="v">{players.length}<span className="muted mcb-of"> / {s.proc.extra.maxPlayersLive || s.maxPlayers || 10}</span></div><div className="s">{running ? (ready ? 'online' : 'Welt lädt …') : 'Server gestoppt'}</div></div>
        <div className="card stat"><div className="k"><Smartphone />Version</div><div className="v mcb-ver">{s.version || '–'}</div><div className="s">{b.update ? <a href={`#/mc/${s.id}/version`}>{tr(`${b.latest} ist da →`)}</a> : b.preview ? 'Vorschau' : 'aktuell'}</div></div>
        <div className="card stat"><div className="k"><Globe2 />Welten</div><div className="v">{worldSize != null ? fmtBytes(worldSize) : '…'}</div><div className="s">{worlds.data ? pl(worlds.data.worlds.length, 'Welt', 'Welten') : ''}</div></div>
        <div className="card stat"><div className="k"><ShieldCheck />Prüfung</div><div className="v mcb-check">{test.data ? (test.data.ok ? <span className="mcb-ok">bestanden</span> : <span className="mcb-bad">Probleme</span>) : <span className="muted">–</span>}</div><div className="s">{test.data ? fmtDate(test.data.at) : <a href={`#/mc/${s.id}/automation`}>jetzt prüfen →</a>}</div></div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><Gauge size={16} /><h3>Zustand</h3><div className="right"><StatusPill state={s.proc.state} label={running && !ready ? 'Lädt Welt …' : undefined} /></div></div>
          <div className="card-body stack">
            {running ? <ProcStats proc={s.proc} svc={`mc:${s.id}`} /> : <div className="small muted">Der Server ist gestoppt.</div>}
            <Addresses s={s} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><Users size={16} /><h3>{tr(`Online (${players.length})`)}</h3><div className="right"><a className="btn ghost sm" href={`#/mc/${s.id}/players`}>Spielerverwaltung</a></div></div>
          {players.length === 0 ? <TileEmpty icon={Users} text={running ? 'Niemand online.' : 'Server ist gestoppt.'} /> : (
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
      <Console lines={lines} height="100%" onCommand={running ? cmd : null} onClear={() => del(`/logs/mc:${s.id}`)} suggestions={BDS_COMMANDS} placeholder="Befehl ohne / eingeben, z. B. „say Hallo“" />
    </div>
  );
}

/* server.properties des Bedrock-Servers als Katalog (Schlüssel, Bezeichnung, Art, Erklärung) */
const BDS_GROUPS = [
  { id: 'allgemein', label: 'Allgemein', icon: Settings2, fields: [
    ['server-name', 'Servername', 'text', 'So heißt der Server in der Liste im Spiel.'],
    ['server-port', 'Port (IPv4, UDP)', 'number', 'Standard 19132. Hostwerk führt ihn – Firewall und Router folgen.'],
    ['server-portv6', 'Port (IPv6, UDP)', 'number', 'Standard 19133.'],
    // nur, wenn die Vorlage der installierten Version die Schlüssel kennt (5. Feld „nn“)
    ['transport', 'Verbindungsweg', ['nethernet', 'raknet'], 'nethernet ist Standard und ab Bedrock 26.60 (27. Oktober 2026) der einzige Weg, auf dem Spieler hineinkommen.', 'nn'],
    ['server-udp-ports', 'NetherNet-Spielports (UDP)', 'text', 'Leer lassen – dann wählt der Server selbst und findet seinen Weg durch den Router. Eingetragene Ports öffnet Hostwerk in Firewall und Router.', 'nn'],
    ['max-players', 'Max. Spieler', 'number', 'Wie viele gleichzeitig spielen dürfen.'],
    ['online-mode', 'Xbox-Anmeldung nötig', 'bool', 'Nur Spieler mit Microsoft-Konto (empfohlen).'],
    ['allow-list', 'Nur Erlaubnisliste', 'bool', 'Nur Spieler auf der Erlaubnisliste dürfen rein (unter „Spieler“).'],
    ['default-player-permission-level', 'Neue Spieler sind', ['visitor', 'member', 'operator'], 'Besucher dürfen nur schauen, Mitglieder bauen, Operatoren alles.'],
    ['player-idle-timeout', 'Inaktive trennen (Min.)', 'number', '0 = nie.'],
  ] },
  { id: 'welt', label: 'Welt & Spiel', icon: Globe2, fields: [
    ['level-name', 'Welt', 'text', 'Ordner unter worlds/. Ein neuer Name legt eine neue Welt an.'],
    ['level-seed', 'Seed', 'text', 'Nur bei neuer Welt wirksam.'],
    ['gamemode', 'Spielmodus', ['survival', 'creative', 'adventure'], ''],
    ['force-gamemode', 'Spielmodus erzwingen', 'bool', 'Alle starten im eingestellten Modus.'],
    ['difficulty', 'Schwierigkeit', ['peaceful', 'easy', 'normal', 'hard'], ''],
    ['allow-cheats', 'Befehle erlauben', 'bool', 'Cheats für Operatoren (Achievements sind dann aus).'],
    ['texturepack-required', 'Ressourcenpakete erzwingen', 'bool', 'Spieler müssen die Pakete der Welt laden.'],
  ] },
  { id: 'leistung', label: 'Leistung', icon: Gauge, fields: [
    ['view-distance', 'Sichtweite (Chunks)', 'number', 'Größter Einfluss auf RAM und CPU.'],
    ['tick-distance', 'Simulationsweite (4–12)', 'number', 'Wie weit die Welt um Spieler lebt.'],
    ['max-threads', 'Max. Threads', 'number', '0 = so viele wie möglich.'],
    ['compression-threshold', 'Kompression ab (Byte)', 'number', ''],
    ['enable-lan-visibility', 'Im WLAN sichtbar', 'bool', 'Taucht bei Geräten im selben Netzwerk unter „Freunde“ auf.'],
    ['content-log-file-enabled', 'Inhalts-Fehler protokollieren', 'bool', 'Fehler in Add-ons in eine Datei schreiben.'],
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
    try { const r = await put(`/mc/servers/${s.id}/properties`, patch); setP(r); setOrig(r); toast.success(running ? 'Gespeichert – wirkt nach einem Neustart' : 'Gespeichert'); } catch (e) { toast.error(e.message); }
  };
  const saveCfg = async () => { try { await put(`/mc/servers/${s.id}`, cfg); toast.success('Gespeichert'); } catch (e) { toast.error(e.message); } };
  const needle = q.trim().toLowerCase();
  const nnKnown = !!(s.bedrock && s.bedrock.netherNet && s.bedrock.netherNet.known);
  const fields = (needle ? BDS_GROUPS.flatMap((x) => x.fields.filter(([k, l, , h]) => `${k} ${tr(l)} ${tr(h || '')}`.toLowerCase().includes(needle))) : (BDS_GROUPS.find((x) => x.id === group) || BDS_GROUPS[0]).fields).filter((x) => x[4] !== 'nn' || nnKnown);
  const field = ([k, label, type, hint]) => {
    const dirty = p[k] !== (orig || {})[k];
    const val = p[k] ?? '';
    const head = <>{label}{dirty && <span className="badge warn mcb-dirty">geändert</span>}</>;
    if (type === 'bool') return <SettingRow key={k} title={head} text={hint || k}><Switch checked={val === 'true'} label={label} onChange={(v) => setP({ ...p, [k]: v ? 'true' : 'false' })} /></SettingRow>;
    return (
      <Field key={k} label={head} hint={hint || k}>
        {Array.isArray(type)
          ? <select className="select" value={val} aria-label={label} onChange={(e) => setP({ ...p, [k]: e.target.value })}>{!type.includes(val) && <option value={val}>{val || tr('(nicht gesetzt)')}</option>}{type.map((o) => <option key={o} value={o}>{LEVEL_LABEL[o] ? tr(LEVEL_LABEL[o]) : o}</option>)}</select>
          : <input className={`input ${type === 'number' ? 'mono' : ''}`} type={type} value={val} aria-label={label} onChange={(e) => setP({ ...p, [k]: e.target.value })} />}
      </Field>
    );
  };
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><Settings2 size={16} /><h3>Spiel (server.properties)</h3>{changed.length > 0 && <span className="badge warn">{tr(`${changed.length} ungespeichert`)}</span>}
          <div className="right row-tight">
            {changed.length > 0 && <Btn className="ghost sm" onClick={() => setP(orig)}>Verwerfen</Btn>}
            <Btn className="primary sm" icon={Save} disabled={!changed.length} onClick={saveProps}>Speichern</Btn>
          </div>
        </div>
        <div className="card-body stack">
          <div className="row mcb-wrap">
            <Seg value={needle ? '' : group} onChange={(v) => { setQ(''); setGroup(v); }} options={BDS_GROUPS.map((x) => ({ id: x.id, label: x.label, icon: x.icon }))} />
            <div className="input-icon mcb-search"><Search /><input className="input sm" placeholder="Einstellung suchen …" aria-label="Einstellung suchen" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          {fields.length === 0 && <div className="small muted">Nichts gefunden.</div>}
          <div className="form-grid">{fields.filter((x) => x[2] !== 'bool').map(field)}</div>
          <div>{fields.filter((x) => x[2] === 'bool').map(field)}</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><TerminalSquare size={16} /><h3>Start &amp; Pflege</h3><div className="right"><Btn className="primary sm" icon={Save} onClick={saveCfg}>Speichern</Btn></div></div>
        <div className="card-body">
          <Field label="Name in Hostwerk"><input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
          <SettingRow title="Mit Hostwerk starten"><Switch checked={!!cfg.autostart} label="Mit Hostwerk starten" onChange={(v) => setCfg({ ...cfg, autostart: v })} /></SettingRow>
          <SettingRow title="Nach Absturz neu starten"><Switch checked={!!cfg.autoRestart} label="Nach Absturz neu starten" onChange={(v) => setCfg({ ...cfg, autoRestart: v })} /></SettingRow>
          <SettingRow title="Nach jedem Start prüfen"><Switch checked={!!cfg.autoCheck} label="Nach jedem Start prüfen" onChange={(v) => setCfg({ ...cfg, autoCheck: v })} /></SettingRow>
          <SettingRow title={<>Neue Bedrock-Versionen selbst einspielen <InfoTip>Bedrock-Spieler kommen nur mit passender App-Version rein. Hostwerk spielt neue Versionen ein, sobald niemand spielt – mit Probestart und Rücksprung, falls etwas nicht klappt.</InfoTip></>}><Switch checked={!!cfg.autoServerUpdates} label="Neue Bedrock-Versionen selbst einspielen" onChange={(v) => setCfg({ ...cfg, autoServerUpdates: v })} /></SettingRow>
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
  const add = async () => { if (!name.trim()) return; setBusy(true); try { set(await post(`/mc/servers/${s.id}/bedrock/allowlist`, { name: name.trim() })); setName(''); toast.success('Auf der Erlaubnisliste'); } catch (e) { toast.error(e.message); } setBusy(false); };
  const remove = async (n) => { try { set(await post(`/mc/servers/${s.id}/bedrock/allowlist`, { name: n, remove: true })); } catch (e) { toast.error(e.message); } };
  const level = async (who, lv) => { try { set(await put(`/mc/servers/${s.id}/bedrock/permission`, { who, level: lv || null })); toast.success('Rechte gespeichert'); } catch (e) { toast.error(e.message); } };
  const permOf = (xuid) => (l.permissions.find((x) => x.xuid === xuid) || {}).permission || '';
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><ShieldCheck size={16} /><h3>Erlaubnisliste</h3>
          <span className={`badge ${l.allowListOn ? 'ok' : ''}`}>{l.allowListOn ? 'an' : 'aus'}</span>
          <InfoTip>Ist sie an, kommen nur Spieler auf dieser Liste rein. Einschalten unter Einstellungen → „Nur Erlaubnisliste“. Eingetragen wird der Gamertag (Xbox-Name).</InfoTip>
        </div>
        <div className="card-body stack">
          <form className="row-tight" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input className="input sm grow" value={name} maxLength={32} placeholder="Gamertag, z. B. Steve123" aria-label="Gamertag" onChange={(e) => setName(e.target.value)} />
            <Btn className="sm primary" icon={UserPlus} busy={busy} disabled={!name.trim()} type="submit">Hinzufügen</Btn>
          </form>
          {l.allowlist.length === 0 ? <TileEmpty icon={ShieldCheck} text="Noch niemand auf der Liste." /> : (
            <table className="table">
              <tbody>{l.allowlist.map((x) => <tr key={x.name || x.xuid}><td className="grow">{x.name || x.xuid}</td><td className="tiny muted">{x.xuid ? 'bekannt' : 'noch nicht da gewesen'}</td><td className="actions"><button className="btn ghost xs icon" title="Entfernen" aria-label={tr(`${x.name} entfernen`)} onClick={() => remove(x.name)}><Trash2 /></button></td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><Crown size={16} /><h3>Rechte</h3>
          <InfoTip>Bedrock vergibt Rechte über die Xbox-Kennung. Die erfährt Hostwerk, sobald jemand einmal auf dem Server war – darum stehen hier alle, die schon da waren. „Standard“ heißt: wie unter Einstellungen → „Neue Spieler sind“.</InfoTip>
        </div>
        {l.known.length === 0 ? <TileEmpty icon={Users} text="Noch niemand war auf dem Server." /> : (
          <table className="table">
            <thead><tr><th>Spieler</th><th>Zuletzt da</th><th>Stufe</th></tr></thead>
            <tbody>{l.known.map((x) => (
              <tr key={x.xuid}>
                <td>{x.name}{l.online.includes(x.name) && <span className="badge ok mcb-dirty">online</span>}</td>
                <td className="small muted">{x.seen ? fmtDate(x.seen) : '–'}</td>
                <td><select className="select sm" value={permOf(x.xuid)} aria-label={tr(`Stufe von ${x.name}`)} onChange={(e) => level(x.xuid, e.target.value)}><option value="">{tr(`Standard (${tr(LEVEL_LABEL[l.defaultPermission] || l.defaultPermission)})`)}</option>{Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select></td>
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
    if (!(await confirmDialog({ title: tr(`Welt „${x.label}“ zurücksetzen?`), text: 'Vorher legt Hostwerk eine Sicherung an. Beim nächsten Start entsteht eine neue Welt.', confirm: 'Zurücksetzen', danger: true }))) return;
    try { await waitJob((await post(`/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/reset`)).job); toast.success('Welt zurückgesetzt'); w.reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><Globe2 size={16} /><h3>Welten</h3><InfoTip>Bedrock-Welten liegen unter worlds/. Welche läuft, bestimmt „Welt“ in den Einstellungen. Fertige Welten (.mcworld entpackt) einfach unter Dateien nach worlds/ legen.</InfoTip></div>
      {w.data.worlds.length === 0 ? <Empty icon={Globe2} title="Noch keine Welt" text="Beim ersten Start legt der Server die Welt an." /> : (
        <table className="table">
          <thead><tr><th>Welt</th><th>Ordner</th><th className="num">Größe</th><th /></tr></thead>
          <tbody>{w.data.worlds.map((x) => (
            <tr key={x.name}>
              <td>{x.label}{x.main && <span className="badge ok mcb-dirty">läuft</span>}</td><td className="mono small">{x.name}</td><td className="num">{fmtBytes(x.size)}</td>
              <td className="actions">
                <a className="btn ghost xs" href={`/api/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/download`}><Download />Laden</a>
                <Btn className="ghost xs" icon={RotateCcw} disabled={!stopped} title={stopped ? 'Welt zurücksetzen' : 'Server zuerst stoppen'} onClick={() => reset(x)}>Zurücksetzen</Btn>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {!stopped && <div className="info-line"><Archive size={13} /><span className="grow">Zurücksetzen geht nur bei gestopptem Server.</span><SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" /></div>}
    </div>
  );
}

export function BedrockVersion({ s }) {
  const b = s.bedrock || {};
  const [busy, setBusy] = useState(null);
  const check = async () => { setBusy('check'); try { const r = await post(`/mc/servers/${s.id}/bedrock/check`); toast.success(r.update ? tr(`Version ${r.latest} ist da`) : 'Schon aktuell'); } catch (e) { toast.error(e.message); } setBusy(null); };
  const update = async (version) => {
    if (s.proc.extra.players && s.proc.extra.players.length && !(await confirmDialog({ title: 'Jetzt aktualisieren?', text: 'Gerade spielen Leute – sie fliegen kurz raus, während der Server neu startet.', confirm: 'Trotzdem aktualisieren' }))) return;
    setBusy(version || 'update');
    try { const r = await waitJob((await post(`/mc/servers/${s.id}/bedrock/update`, { version, force: true })).job); toast.success(r.result && r.result.upToDate ? 'Schon aktuell' : tr(`Bedrock ${r.result ? r.result.version : ''} läuft`)); } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const remove = async () => {
    if (await confirmDialog({ title: tr(`„${s.name}“ endgültig löschen?`), text: tr(`Ordner: ${s.dir}`), confirm: 'Endgültig löschen', danger: true, typeToConfirm: s.name })) { try { await del(`/mc/servers/${s.id}`); location.hash = '/mc'; toast.success('Server gelöscht'); } catch (e) { toast.error(e.message); } }
  };
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><ArrowUpCircle size={16} /><h3>Version</h3><InfoTip title="Update mit Rücksprung">Hostwerk entpackt die neue Version neben der alten, übernimmt Welten und Einstellungen, startet zur Probe und wartet auf eine Antwort. Klappt das nicht, läuft wieder die alte – und Hostwerk lässt diese Version aus. Vorher entsteht eine Sicherung der Welten.</InfoTip></div>
        <div className="card-body stack">
          <div className="row-tight"><span className="muted">Läuft:</span><b>{s.version || '–'}</b>{b.preview && <span className="badge warn">Vorschau</span>}</div>
          <div className="row-tight"><span className="muted">Neueste:</span><b>{b.latest || '–'}</b>{b.checkedAt && <span className="tiny muted">{tr(`geprüft ${fmtDate(b.checkedAt)}`)}</span>}</div>
          {b.failed && <Callout kind="warn" dismissible={false}>{tr(`Version ${b.failed} startete nicht und wurde zurückgenommen – Hostwerk wartet auf eine neuere.`)}</Callout>}
          {b.update && <Callout kind="info" dismissible={false}>{s.autoServerUpdates !== false ? tr(`Version ${b.latest} kommt von selbst, sobald niemand spielt.`) : tr(`Version ${b.latest} ist da.`)}</Callout>}
          <div className="row-tight mcb-wrap">
            <Btn className="sm ghost" icon={RefreshCw} busy={busy === 'check'} onClick={check}>Nach Updates suchen</Btn>
            <Btn className="sm primary" icon={Download} busy={busy === 'update'} disabled={!!busy} onClick={() => update(null)}>{b.update ? tr(`Auf ${b.latest} aktualisieren`) : 'Neu einspielen'}</Btn>
            {!b.preview && <Btn className="sm ghost" busy={busy === 'preview'} disabled={!!busy} title="Mojangs Vorabversion – nur zum Ausprobieren, Spieler brauchen dann die Vorschau-App" onClick={() => update('preview')}>Vorschau testen</Btn>}
          </div>
          <div className="tiny muted">Mojang bietet nur die neueste Version an (und eine Vorschau) – ältere gibt es dort nicht mehr. Ein Zurück geht über die Sicherungen.</div>
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <div className="card-head"><Router size={16} /><h3>Ports</h3><InfoTip>Bedrock nutzt UDP. Hostwerk trägt beide Ports in die Firewall-Regeln ein, und mit „Router & Portfreigaben“ auch im Router.</InfoTip></div>
          <div className="card-body stack">
            <div className="row-tight"><span className="grow">IPv4</span><code>{s.port}</code><span className="badge">UDP</span></div>
            {s.portv6 ? <div className="row-tight"><span className="grow">IPv6</span><code>{s.portv6}</code><span className="badge">UDP</span></div> : null}
            <a className="small" href="#/live/firewall">Firewall &amp; Router →</a>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><Skull size={16} /><h3>Gefahrenzone</h3></div>
          <div className="card-body stack">
            <span className="small muted">Löscht den Server mit Welten und Einstellungen. Sicherungen bleiben im Sicherungsordner.</span>
            <Btn className="danger sm" icon={Trash2} disabled={s.proc.state === 'running'} title={s.proc.state === 'running' ? 'Server zuerst stoppen' : undefined} onClick={remove}>Server löschen</Btn>
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
        <Field label="Port (UDP)" hint="Leer = automatisch (ab 19132)"><input className="input mono" type="number" placeholder="19132" value={f.port} onChange={(e) => set({ port: e.target.value })} /></Field>
        <Field label="Max. Spieler"><input className="input" type="number" min={1} max={200} value={f.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} /></Field>
        <Field label="Spielmodus"><select className="select" value={f.gamemode === 'spectator' ? 'survival' : f.gamemode} onChange={(e) => set({ gamemode: e.target.value })}><option value="survival">Überleben</option><option value="creative">Kreativ</option><option value="adventure">Abenteuer</option></select></Field>
        <Field label="Schwierigkeit"><select className="select" value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}><option value="peaceful">Friedlich</option><option value="easy">Einfach</option><option value="normal">Normal</option><option value="hard">Schwer</option></select></Field>
        <Field label="Welt-Seed (optional)" className="span-2"><input className="input mono" value={f.seed} onChange={(e) => set({ seed: e.target.value })} /></Field>
      </div>
      <SettingRow title="Xbox-Anmeldung nötig" text="Nur Spieler mit Microsoft-Konto (empfohlen)."><Switch checked={f.onlineMode} label="Xbox-Anmeldung nötig" onChange={(v) => set({ onlineMode: v })} /></SettingRow>
      <SettingRow title="Jede Nacht sichern" text="Um 3 Uhr Welten und Einstellungen, die letzten 7 bleiben."><Switch checked={f.nightlyBackup} label="Jede Nacht sichern" onChange={(v) => set({ nightlyBackup: v })} /></SettingRow>
      <label className="check mcb-eula">
        <input type="checkbox" checked={f.eula} onChange={(e) => set({ eula: e.target.checked })} />
        <span>Ich akzeptiere die <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft-EULA</a> und <a href="https://go.microsoft.com/fwlink/?LinkId=521839" target="_blank" rel="noreferrer">Mojangs Datenschutzerklärung</a>.</span>
      </label>
    </>
  );
}

/** Kurzer Hinweis im ersten Schritt: was Bedrock anders macht. */
export function BedrockPickInfo() {
  return <InfoTip>Ein Server nur für Bedrock (Handy, Tablet, Konsole, Windows). Keine Java-Spieler, keine Java-Plugins – dafür alles genau wie in Bedrock. Java und Bedrock zusammen: ein Java-Server mit Geyser (Erweiterung „Minecraft-Servernetzwerk“). Hostwerk lädt den Server von minecraft.net (rund 100 MB) und hält ihn aktuell.</InfoTip>;
}

export const isBedrock = (s) => !!(s && s.caps && s.caps.edition === 'bedrock');
