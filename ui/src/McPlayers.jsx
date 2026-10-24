import { useEffect, useRef, useState } from 'react';
import { Crown, UserX, Ban, Shield, ShieldOff, MessageSquare, Heart, Hammer, Compass, Eye, Navigation, Copy, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import { post, useApi, openExternal } from '@hostwerk/api';
import { Modal, toast, confirmDialog, promptDialog, Loading } from '@hostwerk/ui';
import { contextMenu } from '@hostwerk/kit';
import { PlayerHead } from '@hostwerk/kit';
import { ActivityCard } from './McTools';
import { locale } from '@hostwerk/kit';

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

const GAMEMODES = [['survival', 'Überleben', Heart], ['creative', 'Kreativ', Hammer], ['adventure', 'Abenteuer', Compass], ['spectator', 'Zuschauer', Eye]];

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
  const hint = off ? 'Server aus' : undefined;
  contextMenu(e, [
    op ? { label: 'OP entziehen', icon: Crown, disabled: off, hint, onClick: () => cmd(`deop ${name}`, `${name} ist kein OP mehr`) }
      : { label: 'OP geben', icon: Crown, disabled: off, hint, onClick: () => cmd(`op ${name}`, `${name} ist jetzt OP`) },
    ...(isOnline ? [
      '-',
      ...GAMEMODES.map(([id, label, icon]) => ({ label: `Spielmodus: ${label}`, icon, onClick: () => cmd(`gamemode ${id} ${name}`, `${name}: ${label}`) })),
      '-',
      { label: 'Heilen & sättigen', icon: Heart, onClick: () => { cmd(`effect give ${name} minecraft:instant_health 1 10`); cmd(`effect give ${name} minecraft:saturation 1 10`, `${name} geheilt`); } },
      others.length > 0 && { label: `Zu ${others.length === 1 ? others[0] : 'Spieler …'} teleportieren`, icon: Navigation, onClick: async () => {
        const to = others.length === 1 ? others[0] : await promptDialog({ title: `${name} teleportieren`, label: `Zu welchem Spieler? (${others.join(', ')})`, value: others[0] });
        if (to) cmd(`tp ${name} ${to}`, `${name} → ${to}`);
      } },
      { label: 'Privatnachricht …', icon: MessageSquare, onClick: async () => { const t = await promptDialog({ title: `Nachricht an ${name}`, label: 'Text' }); if (t) cmd(`tell ${name} ${t}`, 'Gesendet'); } },
      { label: 'Inventar leeren …', icon: Trash2, onClick: async () => { if (await confirmDialog({ title: `Inventar von ${name} leeren?`, text: 'Alle Gegenstände gehen verloren.', confirm: 'Leeren', danger: true })) cmd(`clear ${name}`, 'Inventar geleert'); } },
    ] : []),
    '-',
    wl ? { label: 'Von der Whitelist nehmen', icon: ShieldOff, disabled: off, hint, onClick: () => cmd(`whitelist remove ${name}`, 'Von der Whitelist entfernt') }
      : { label: 'Zur Whitelist hinzufügen', icon: Shield, disabled: off, hint, onClick: () => cmd(`whitelist add ${name}`, 'Zur Whitelist hinzugefügt') },
    isOnline && { label: 'Kicken …', icon: UserX, onClick: async () => { const r = await promptDialog({ title: `${name} kicken`, label: 'Grund (optional)' }); if (r !== null) cmd(`kick ${name}${r ? ' ' + r : ''}`, `${name} gekickt`); } },
    banned ? { label: 'Bann aufheben', icon: ShieldOff, disabled: off, hint, onClick: () => cmd(`pardon ${name}`, `${name} ist nicht mehr gebannt`) }
      : { label: 'Bannen …', icon: Ban, danger: true, disabled: off, hint, onClick: async () => { const r = await promptDialog({ title: `${name} bannen`, text: 'Der Spieler kann danach nicht mehr beitreten (aufheben unter Spieler → Gebannt).', label: 'Grund (optional)', confirm: 'Bannen' }); if (r !== null) cmd(`ban ${name}${r ? ' ' + r : ''}`, `${name} gebannt`); } },
    '-',
    { label: 'Namen kopieren', icon: Copy, onClick: () => { navigator.clipboard.writeText(name); toast.success('Kopiert'); } },
    { label: 'Profil auf NameMC', icon: ExternalLink, onClick: () => openExternal(`https://namemc.com/profile/${encodeURIComponent(name)}`) },
  ]);
}

/** Rechtsklick auf eine gebannte IP-Adresse (keine Spieler-Aktionen, nur aufheben und kopieren). */
export function ipMenu(e, { s, ip, cmd }) {
  const off = s.proc.state !== 'running';
  contextMenu(e, [
    { label: 'IP-Bann aufheben', icon: ShieldOff, disabled: off, hint: off ? 'Server aus' : undefined, onClick: () => cmd(`pardon-ip ${ip}`, `${ip} ist nicht mehr gebannt`) },
    { label: 'Adresse kopieren', icon: Copy, onClick: () => { navigator.clipboard.writeText(ip); toast.success('Kopiert'); } },
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
      <button className={`btn ghost xs icon ${op ? 'mc-op-on' : ''}`} title={op ? 'Ist OP – klicken zum Entziehen' : 'OP geben'} onClick={() => cmd(op ? `deop ${name}` : `op ${name}`, op ? `${name} ist kein OP mehr` : `${name} ist jetzt OP`)}><Crown /></button>
      <button className="btn ghost xs icon" title="Kicken" onClick={() => cmd(`kick ${name}`, `${name} gekickt`)}><UserX /></button>
      <button className="btn ghost xs icon" title="Weitere Aktionen (auch per Rechtsklick)" onClick={open}><MoreHorizontal /></button>
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
export function PlayerPick({ title, online = [], exclude = () => false, reason = false, confirm = 'Hinzufügen', danger = false, onPick, onClose }) {
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const valid = /^[A-Za-z0-9_]{2,16}$/.test(name);
  const offer = online.filter((n) => !exclude(n));
  const done = (n) => { onPick(n, why.trim()); onClose(); };
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Abbrechen</button><button className={`btn ${danger ? 'danger-solid' : 'primary'}`} disabled={!valid} onClick={() => done(name)}>{confirm}</button></>}>
      <div className="stack">
        {offer.length > 0 && (
          <div className="field">
            <label>Gerade online</label>
            <div className="mc-pick">
              {offer.map((n) => (
                <button key={n} className={`mc-pick-item ${same(n, name) ? 'active' : ''}`} onClick={() => (reason ? setName(n) : done(n))}>
                  <PlayerHead name={n} />{n}
                </button>
              ))}
            </div>
          </div>
        )}
        {online.length > 0 && offer.length === 0 && <div className="small muted">Alle Online-Spieler stehen schon in dieser Liste.</div>}
        <div className="field">
          <label>{offer.length ? 'Oder Namen eingeben' : 'Spielername'}</label>
          <input className="input" autoFocus={!offer.length} value={name} onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => { if (e.key === 'Enter' && valid) done(name); }} placeholder="z. B. Notch" />
          {name && !valid && <span className="hint" style={{ color: 'var(--err-text)' }}>2–16 Zeichen: Buchstaben, Ziffern, _</span>}
        </div>
        {reason && <div className="field"><label>Grund (optional)</label><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} /></div>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Statistik */
const dur = (ms) => { const h = Math.floor(ms / 3600000); const m = Math.round((ms % 3600000) / 60000); return h ? `${h} h ${m} min` : `${m} min`; };
const ago = (t) => { if (!t) return '–'; const d = Date.now() - t; if (d < 120000) return 'gerade eben'; if (d < 3600000) return `vor ${Math.round(d / 60000)} min`; if (d < 86400000) return `vor ${Math.round(d / 3600000)} h`; return `vor ${Math.round(d / 86400000)} Tagen`; };
const COLS = [
  ['playMs', 'Spielzeit', (p) => dur(p.playMs)],
  ['sessions', 'Besuche', (p) => p.sessions || '–'],
  ['last', 'Zuletzt', (p) => (p.online ? <span className="badge ok">online</span> : ago(p.last))],
  ['deaths', 'Tode', (p) => (p.world ? p.world.deaths : '–')],
  ['mobKills', 'Mob-Kills', (p) => (p.world ? p.world.mobKills : '–')],
  ['mined', 'Abgebaut', (p) => (p.world ? p.world.mined.toLocaleString(locale()) : '–')],
  ['distanceKm', 'Strecke', (p) => (p.world ? `${String(p.world.distanceKm).replace('.', ',')} km` : '–')],
];
const val = (p, k) => (k === 'playMs' || k === 'sessions' || k === 'last' ? p[k] || 0 : p.world ? p.world[k] || 0 : -1);

export function StatsTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/stats`);
  const [sort, setSort] = useState('playMs');
  if (!st.data) return <div className="card"><Loading /></div>;
  const d = st.data;
  const list = [...d.players].sort((a, b) => val(b, sort) - val(a, sort));
  const maxDay = Math.max(1, ...d.days.map((x) => x.unique));
  if (!d.players.length) return <div className="card card-pad"><b>Noch keine Statistik</b><div className="small muted">Sobald Spieler auf dem Server waren, erscheinen hier Spielzeit, Besuche, Tode, Kills und mehr.</div></div>;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card stat"><div className="k">Spieler</div><div className="v">{d.totals.players}</div><div className="s">{d.totals.activeWeek} in den letzten 7 Tagen</div></div>
        <div className="card stat"><div className="k">Spielzeit gesamt</div><div className="v text">{dur(d.totals.playMs)}</div><div className="s">{d.totals.sessions} Besuche</div></div>
        <div className="card stat"><div className="k">Top-Spieler</div><div className="v text ellipsis">{list[0] ? <span className="row-tight"><PlayerHead name={list[0].name} size={28} />{list[0].name}</span> : '–'}</div><div className="s">{list[0] ? dur(list[0].playMs) : ''}</div></div>
        <div className="card stat"><div className="k">Abgebaute Blöcke</div><div className="v">{d.totals.mined.toLocaleString(locale())}</div><div className="s">{d.totals.deaths} Tode insgesamt</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Aktivität der letzten 14 Tage</h3><span className="tiny muted">verschiedene Spieler je Tag · Spitze gleichzeitig</span></div>
        <div className="card-body mc-days">
          {d.days.map((x) => (
            <div key={x.date} className="mc-day" title={`${new Date(x.date).toLocaleDateString(locale())}: ${x.unique} Spieler, gleichzeitig bis ${x.peak}`}>
              <div className="mc-day-bar"><div style={{ height: `${(x.unique / maxDay) * 100}%` }} /></div>
              <span className="tiny muted">{new Date(x.date).toLocaleDateString(locale(), { weekday: 'short' }).slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </div>
      <ActivityCard activity={d.activity} />
      <div className="card">
        <div className="card-head"><h3>Rangliste</h3><span className="tiny muted">Klick auf eine Spalte sortiert</span></div>
        <table className="table">
          <thead><tr><th>#</th><th>Spieler</th>{COLS.map(([k, label]) => <th key={k} className={`num sortable ${sort === k ? 'active' : ''}`} onClick={() => setSort(k)}>{label}{sort === k ? ' ▾' : ''}</th>)}</tr></thead>
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
