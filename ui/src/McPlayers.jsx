import { useEffect, useRef, useState } from 'react';
import { Crown, UserX, Ban, Shield, ShieldOff, MessageSquare, Heart, Hammer, Compass, Eye, Navigation, Copy, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import { post, useApi, openExternal } from '@hostwerk/api';
import { Modal, toast, confirmDialog, promptDialog, Loading } from '@hostwerk/ui';
import { contextMenu } from '@hostwerk/kit';
import { PlayerHead } from '@hostwerk/kit';
import { ActivityCard } from './McTools';
import { locale } from '@hostwerk/kit';
import { t as T } from '@hostwerk/i18n';

/*
 * Online-Spieler: Status (OP, Whitelist) kennen und per Knopf oder Rechtsklick verwalten.
 * Vorher zeigte die Krone immer „OP geben“ – auch bei Spielern, die längst OP sind.
 */
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * OP-, Whitelist- und Bannlisten. Lädt nur, wenn sich etwas ändern kann: Spieler kommen oder gehen, der Server startet
 * oder stoppt, nach eigenen Befehlen (useCmd) und wenn das Fenster wieder in den Vordergrund kommt – nicht bei jedem
 * Server-Ereignis und ohne Takt (vorher kam die Liste alle paar Sekunden neu).
 */
export function usePlayerLists(s) {
  const online = (s.proc.extra.players || []).join(',');
  const pl = useApi(s.proxy ? null : `/mc/servers/${s.id}/players`, [], { live: false });
  const first = useRef(true); // beim Öffnen lädt useApi schon selbst
  useEffect(() => { if (first.current) { first.current = false; return; } if (!s.proxy) pl.reload({ silent: true }); }, [online, s.proc.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (s.proxy) return undefined;
    const h = () => { if (!document.hidden) pl.reload({ silent: true }); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [s.proxy, pl.reload]);
  const d = pl.data || { ops: [], whitelist: [], banned: [], bannedIps: [], online: [] };
  return {
    data: pl.data, reload: pl.reload,
    isOp: (n) => d.ops.some((o) => same(o.name, n)),
    onWhitelist: (n) => d.whitelist.some((o) => same(o.name, n)),
    isBanned: (n) => d.banned.some((o) => same(o.name, n)),
  };
}

function useCmd(s, lists) {
  return async (c, ok) => {
    try {
      await post(`/mc/servers/${s.id}/command`, { command: c });
      if (ok) toast.success(ok);
      // ops.json & Co. schreibt der Server mit kurzer Verzögerung
      setTimeout(() => lists.reload({ silent: true }), 700);
    } catch (e) { toast.error(e.message); }
  };
}

const GAMEMODES = [['survival', 'Survival', Heart], ['creative', 'Creative', Hammer], ['adventure', 'Adventure', Compass], ['spectator', 'Spectator', Eye]];

/**
 * Alle Aktionen für einen Spieler (Rechtsklick-Menü) – für Online-Spieler und für Einträge in OP-, Whitelist- und
 * Bannliste. Was einen Online-Spieler braucht (Spielmodus, Heilen, Kicken …), erscheint nur bei Online-Spielern; was
 * über die Konsole läuft, ist bei gestopptem Server ausgegraut.
 */
export function playerMenu(e, { s, name, lists, cmd, online = [] }) {
  const op = lists.isOp(name);
  const wl = lists.onWhitelist(name);
  const banned = lists.isBanned(name);
  const off = s.proc.state !== 'running';
  const isOnline = !off && online.some((n) => same(n, name));
  const others = online.filter((n) => !same(n, name));
  const hint = off ? T('Server off') : undefined;
  contextMenu(e, [
    op ? { label: T('Revoke OP'), icon: Crown, disabled: off, hint, onClick: () => cmd(`deop ${name}`, T(`${name} is no longer OP`)) }
      : { label: T('Make operator'), icon: Crown, disabled: off, hint, onClick: () => cmd(`op ${name}`, T(`${name} is now OP`)) },
    ...(isOnline ? [
      '-',
      ...GAMEMODES.map(([id, label, icon]) => ({ label: T(`Game mode: ${label}`), icon, onClick: () => cmd(`gamemode ${id} ${name}`, `${name}: ${label}`) })),
      '-',
      { label: T('Heal & feed'), icon: Heart, onClick: () => { cmd(`effect give ${name} minecraft:instant_health 1 10`); cmd(`effect give ${name} minecraft:saturation 1 10`, T(`${name} healed`)); } },
      others.length > 0 && { label: T(`Teleport to ${others.length === 1 ? others[0] : T('Player …')}`), icon: Navigation, onClick: async () => {
        const to = others.length === 1 ? others[0] : await promptDialog({ title: `Teleport ${name}`, label: `To which player? (${others.join(', ')})`, value: others[0] });
        if (to) cmd(`tp ${name} ${to}`, `${name} → ${to}`);
      } },
      { label: T('Private message …'), icon: MessageSquare, onClick: async () => { const t = await promptDialog({ title: `Message to ${name}`, label: 'Text' }); if (t) cmd(`tell ${name} ${t}`, T('Sent')); } },
      { label: T('Clear inventory …'), icon: Trash2, onClick: async () => { if (await confirmDialog({ title: `Clear ${name}'s inventory?`, text: 'All items will be lost.', confirm: 'Empty', danger: true })) cmd(`clear ${name}`, T('Inventory cleared')); } },
    ] : []),
    '-',
    wl ? { label: T('Remove from whitelist'), icon: ShieldOff, disabled: off, hint, onClick: () => cmd(`whitelist remove ${name}`, T('Removed from whitelist')) }
      : { label: T('Add to whitelist'), icon: Shield, disabled: off, hint, onClick: () => cmd(`whitelist add ${name}`, T('Added to whitelist')) },
    isOnline && { label: T('Kick …'), icon: UserX, onClick: async () => { const r = await promptDialog({ title: `Kick ${name}`, label: 'Reason (optional)' }); if (r !== null) cmd(`kick ${name}${r ? ' ' + r : ''}`, T(`${name} kicked`)); } },
    banned ? { label: T('Lift ban'), icon: ShieldOff, disabled: off, hint, onClick: () => cmd(`pardon ${name}`, T(`${name} is no longer banned`)) }
      : { label: T('Ban …'), icon: Ban, danger: true, disabled: off, hint, onClick: async () => { const r = await promptDialog({ title: `Ban ${name}`, text: 'The player can no longer join (lift it under Players → Banned).', label: 'Reason (optional)', confirm: 'Ban' }); if (r !== null) cmd(`ban ${name}${r ? ' ' + r : ''}`, T(`${name} banned`)); } },
    '-',
    { label: T('Copy name'), icon: Copy, onClick: () => { navigator.clipboard.writeText(name); toast.success('Copied'); } },
    { label: T('Profile on NameMC'), icon: ExternalLink, onClick: () => openExternal(`https://namemc.com/profile/${encodeURIComponent(name)}`) },
  ]);
}

/** Rechtsklick auf eine gebannte IP-Adresse (keine Spieler-Aktionen, nur aufheben und kopieren). */
export function ipMenu(e, { s, ip, cmd }) {
  const off = s.proc.state !== 'running';
  contextMenu(e, [
    { label: T('Lift IP ban'), icon: ShieldOff, disabled: off, hint: off ? T('Server off') : undefined, onClick: () => cmd(`pardon-ip ${ip}`, T(`${ip} is no longer banned`)) },
    { label: T('Copy address'), icon: Copy, onClick: () => { navigator.clipboard.writeText(ip); toast.success('Copied'); } },
  ]);
}

/** Knöpfe neben einem Online-Spieler: Krone (zeigt OP-Status, schaltet um), Kicken, Mehr. */
export function PlayerButtons({ s, name, lists, online }) {
  const cmd = useCmd(s, lists);
  if (s.proxy) return null;
  const op = lists.isOp(name);
  const open = (e) => playerMenu(e, { s, name, lists, cmd, online });
  return (
    <div className="row-tight" onContextMenu={open}>
      <button className={`btn ghost xs icon ${op ? 'mc-op-on' : ''}`} title={op ? 'Is OP – click to revoke' : 'Make operator'} onClick={() => cmd(op ? `deop ${name}` : `op ${name}`, op ? T(`${name} is no longer OP`) : T(`${name} is now OP`))}><Crown /></button>
      <button className="btn ghost xs icon" title="Kick" onClick={() => cmd(`kick ${name}`, T(`${name} kicked`))}><UserX /></button>
      <button className="btn ghost xs icon" title="More actions (also via right-click)" onClick={open}><MoreHorizontal /></button>
    </div>
  );
}

/** Rechtsklick auf die ganze Spielerzeile (ip = Eintrag aus der IP-Bannliste). */
export function usePlayerContext(s, lists, online) {
  const cmd = useCmd(s, lists);
  return (name, ip) => (e) => { if (s.proxy) return; if (name) playerMenu(e, { s, name, lists, cmd, online }); else if (ip) ipMenu(e, { s, ip, cmd }); };
}

/**
 * Spieler wählen (OP hinzufügen, bannen, Whitelist): Online-Spieler zum Anklicken – oder Namen eintippen.
 * exclude: wer schon in der Liste steht, wird nicht angeboten.
 */
export function PlayerPick({ title, online = [], exclude = () => false, reason = false, confirm = T('Add'), danger = false, onPick, onClose }) {
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const valid = /^[A-Za-z0-9_]{2,16}$/.test(name);
  const offer = online.filter((n) => !exclude(n));
  const done = (n) => { onPick(n, why.trim()); onClose(); };
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'danger-solid' : 'primary'}`} disabled={!valid} onClick={() => done(name)}>{confirm}</button></>}>
      <div className="stack">
        {offer.length > 0 && (
          <div className="field">
            <label>Online now</label>
            <div className="mc-pick">
              {offer.map((n) => (
                <button key={n} className={`mc-pick-item ${same(n, name) ? 'active' : ''}`} onClick={() => (reason ? setName(n) : done(n))}>
                  <PlayerHead name={n} />{n}
                </button>
              ))}
            </div>
          </div>
        )}
        {online.length > 0 && offer.length === 0 && <div className="small muted">All online players are already on this list.</div>}
        <div className="field">
          <label>{offer.length ? 'Or enter a name' : 'Player name'}</label>
          <input className="input" autoFocus={!offer.length} value={name} onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter' && valid) done(name); }} placeholder="e.g. Notch" />
          {name && !valid && <span className="hint" style={{ color: 'var(--err-text)' }}>2–16 characters: letters, digits, _</span>}
        </div>
        {reason && <div className="field"><label>Reason (optional)</label><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} /></div>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Statistik */
const dur = (ms) => { const h = Math.floor(ms / 3600000); const m = Math.round((ms % 3600000) / 60000); return h ? `${h} h ${m} min` : `${m} min`; };
const ago = (t) => { if (!t) return '–'; const d = Date.now() - t; if (d < 120000) return T('just now'); if (d < 3600000) return `vor ${Math.round(d / 60000)} min`; if (d < 86400000) return `vor ${Math.round(d / 3600000)} h`; return T(`${Math.round(d / 86400000)} days ago`); };
const COLS = [
  ['playMs', 'Play time', (p) => dur(p.playMs)],
  ['sessions', 'Visits', (p) => p.sessions || '–'],
  ['last', 'Last seen', (p) => (p.online ? <span className="badge ok">online</span> : ago(p.last))],
  ['deaths', 'Deaths', (p) => (p.world ? p.world.deaths : '–')],
  ['mobKills', 'Mob kills', (p) => (p.world ? p.world.mobKills : '–')],
  ['mined', 'Mined', (p) => (p.world ? p.world.mined.toLocaleString(locale()) : '–')],
  ['distanceKm', 'Distance', (p) => (p.world ? `${String(p.world.distanceKm).replace('.', ',')} km` : '–')],
];
const val = (p, k) => (k === 'playMs' || k === 'sessions' || k === 'last' ? p[k] || 0 : p.world ? p.world[k] || 0 : -1);

export function StatsTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/stats`);
  const [sort, setSort] = useState('playMs');
  if (!st.data) return <div className="card"><Loading /></div>;
  const d = st.data;
  const list = [...d.players].sort((a, b) => val(b, sort) - val(a, sort));
  const maxDay = Math.max(1, ...d.days.map((x) => x.unique));
  if (!d.players.length) return <div className="card card-pad"><b>No statistics yet</b><div className="small muted">As soon as players have been on the server, play time, visits, deaths, kills and more appear here.</div></div>;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card stat"><div className="k">Players</div><div className="v">{d.totals.players}</div><div className="s">{d.totals.activeWeek} in the last 7 days</div></div>
        <div className="card stat"><div className="k">Total play time</div><div className="v text">{dur(d.totals.playMs)}</div><div className="s">{d.totals.sessions} Visits</div></div>
        <div className="card stat"><div className="k">Top player</div><div className="v text ellipsis">{list[0] ? <span className="row-tight"><PlayerHead name={list[0].name} size={28} />{list[0].name}</span> : '–'}</div><div className="s">{list[0] ? dur(list[0].playMs) : ''}</div></div>
        <div className="card stat"><div className="k">Blocks mined</div><div className="v">{d.totals.mined.toLocaleString(locale())}</div><div className="s">{d.totals.deaths} deaths in total</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Activity in the last 14 days</h3><span className="tiny muted">different players per day · peak concurrent</span></div>
        <div className="card-body mc-days">
          {d.days.map((x) => (
            <div key={x.date} className="mc-day" title={`${new Date(x.date).toLocaleDateString(locale())}: ${x.unique} players, up to ${x.peak} at once`}>
              <div className="mc-day-bar"><div style={{ height: `${(x.unique / maxDay) * 100}%` }} /></div>
              <span className="tiny muted">{new Date(x.date).toLocaleDateString(locale(), { weekday: 'short' }).slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </div>
      <ActivityCard activity={d.activity} />
      <div className="card">
        <div className="card-head"><h3>Leaderboard</h3><span className="tiny muted">Click a column to sort</span></div>
        <table className="table">
          <thead><tr><th>#</th><th>Players</th>{COLS.map(([k, label]) => <th key={k} className={`num sortable ${sort === k ? 'active' : ''}`} onClick={() => setSort(k)}>{label}{sort === k ? ' ▾' : ''}</th>)}</tr></thead>
          <tbody>
            {list.map((p, i) => (
              <tr key={p.name}>
                <td className="muted">{i + 1}</td>
                <td><span className="player"><PlayerHead name={p.name} />{p.name}</span></td>
                {COLS.map(([k, , f]) => <td key={k} className="num">{f(p)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
