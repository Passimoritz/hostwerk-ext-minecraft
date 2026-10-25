import { useEffect, useRef, useState } from 'react';
import { Users, Gauge, Copy, Sun, Moon, CloudSun, CloudRain, CloudLightning, Save, Megaphone, Archive, ShieldCheck, Globe2, Map as MapIcon, Image as ImageIcon, Trash2, Download, RotateCcw, RotateCw, CalendarClock, Play, CheckCircle2, XCircle, AlertTriangle, ExternalLink, RefreshCw, Crown, HardDrive, ScrollText, Palette, Gamepad2, Search, Zap, Info, Upload, HeartPulse, UserX, SlidersHorizontal, Eraser, Package, ChevronDown, FolderOpen } from 'lucide-react';
import { get, post, put, del, useApi, useLogs, useStore, fmtBytes, fmtDate, openExternal, waitJob, playerCount } from '@hostwerk/api';
import { Btn, StatusPill, Empty, Loading, Callout, Field, Switch , toast, confirmDialog, promptDialog, InfoTip, TileEmpty, Modal } from '@hostwerk/ui';
import { SvcShortcut } from '@hostwerk/kit';
import { contextMenu } from '@hostwerk/kit';
import McDimIcon, { dimLabel, dimKey, useDimInfo } from './McDimIcon';
import { HealthSummary } from './McHealth';
import { TaskList, TaskEditor } from '@hostwerk/kit';
import { PlayerButtons, usePlayerLists, usePlayerContext } from './McPlayers';
import { PlayerHead, Keep } from '@hostwerk/kit';
import { useSlot } from '@hostwerk/kit';
import { ErrorBoundary } from '@hostwerk/kit';
import { ExtSections, useSectionRole } from '@hostwerk/kit';
import { TpsCard, WorldUploadCard, PregenCard } from './McTools';
import { t as T, pl } from '@hostwerk/i18n';

/* ------------------------------------------------------------------ Minecraft-Farbcodes */
const MC = { 0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA', 8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF' };
export function McText({ text }) {
  const parts = [];
  let style = { color: '#AAAAAA' };
  let buf = '';
  const s = String(text || '').replace(/\\u00a7/gi, '§').replace(/\\n/g, '\n');
  const flush = () => { if (buf) { parts.push(<span key={parts.length} style={{ ...style }}><Keep>{buf}</Keep></span>); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '§' && i + 1 < s.length) {
      flush();
      const c = s[++i].toLowerCase();
      if (MC[c]) style = { color: MC[c] };
      else if (c === 'l') style = { ...style, fontWeight: 700 };
      else if (c === 'o') style = { ...style, fontStyle: 'italic' };
      else if (c === 'n') style = { ...style, textDecoration: 'underline' };
      else if (c === 'm') style = { ...style, textDecoration: 'line-through' };
      else if (c === 'r') style = { color: '#AAAAAA' };
      continue;
    }
    if (s[i] === '\n') { flush(); parts.push(<br key={parts.length} />); continue; }
    buf += s[i];
  }
  flush();
  return <>{parts}</>;
}

/* ------------------------------------------------------------------ Server-Symbol zuschneiden */
const CROP_VIEW = 256; // Vorschaufläche in Pixeln – gespeichert wird 64×64 (Vorgabe von Minecraft)
/**
 * Bild als Server-Symbol zuschneiden: verschieben (ziehen, Pfeiltasten), vergrößern (Regler, Mausrad, +/−), füllen
 * oder ganz zeigen, für Pixel-Art ohne Weichzeichnen. Ergebnis: PNG 64×64 als data-URL.
 */
export function IconCropper({ file, onCancel, onSave }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [smooth, setSmooth] = useState(true);
  const [busy, setBusy] = useState(false);
  const view = useRef(null);
  const small = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { setImg(i); setSmooth(!(i.width <= 64 && i.height <= 64)); }; // kleine Bilder sind meist Pixel-Art
    i.onerror = () => toast.error('The image could not be opened.');
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // „Füllen“ = kürzere Seite füllt das Quadrat (Zoom 1), „Ganz zeigen“ = ganzes Bild sichtbar
  const cover = img ? CROP_VIEW / Math.min(img.width, img.height) : 1;
  const fitZoom = img ? Math.min(img.width, img.height) / Math.max(img.width, img.height) : 1;
  const draw = (canvas, size) => {
    if (!canvas || !img) return;
    const k = size / CROP_VIEW;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, size, size);
    g.imageSmoothingEnabled = smooth;
    g.imageSmoothingQuality = 'high';
    const sc = cover * zoom * k;
    const w = img.width * sc; const h = img.height * sc;
    g.drawImage(img, (CROP_VIEW / 2 + off.x) * k - w / 2, (CROP_VIEW / 2 + off.y) * k - h / 2, w, h);
  };
  useEffect(() => { draw(view.current, CROP_VIEW); draw(small.current, 64); });
  const zoomAt = (z2, px = CROP_VIEW / 2, py = CROP_VIEW / 2) => {
    const nz = Math.max(fitZoom * 0.5, Math.min(8, z2));
    // Punkt unter dem Mauszeiger bleibt stehen
    const cx = px - CROP_VIEW / 2; const cy = py - CROP_VIEW / 2;
    setOff((o) => ({ x: cx - ((cx - o.x) * nz) / zoom, y: cy - ((cy - o.y) * nz) / zoom }));
    setZoom(nz);
  };
  const onDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, o: off }; };
  const onMove = (e) => { const d = drag.current; if (!d) return; const r = e.currentTarget.getBoundingClientRect(); const k = CROP_VIEW / r.width; setOff({ x: d.o.x + (e.clientX - d.x) * k, y: d.o.y + (e.clientY - d.y) * k }); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => { const r = e.currentTarget.getBoundingClientRect(); const k = CROP_VIEW / r.width; zoomAt(zoom * Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) * k, (e.clientY - r.top) * k); };
  const nudge = (dx, dy) => setOff((o) => ({ x: o.x + dx, y: o.y + dy }));
  const save = async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    draw(c, 64);
    setBusy(true);
    try { await onSave(c.toDataURL('image/png')); } finally { setBusy(false); }
  };
  return (
    <Modal title="Crop server icon" subtitle="Drag to move, mouse wheel or slider to zoom. Minecraft shows the icon at 64×64 pixels." onClose={onCancel}
      footer={<><Btn onClick={onCancel}>Cancel</Btn><Btn className="primary" icon={Save} busy={busy} disabled={!img} onClick={save}>Save as icon</Btn></>}>
      {!img ? <Loading /> : (
        <div className="mc-crop">
          <div className="mc-crop-stage">
            <canvas ref={view} width={CROP_VIEW} height={CROP_VIEW} className="mc-crop-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
              tabIndex={0} aria-label="Crop – move with the arrow keys, zoom with plus and minus"
              onKeyDown={(e) => { const st = e.shiftKey ? 16 : 4; const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key]; if (k) { e.preventDefault(); nudge(...k); } else if (e.key === '+' || e.key === '=') zoomAt(zoom * 1.1); else if (e.key === '-') zoomAt(zoom / 1.1); }} />
          </div>
          <div className="stack mc-crop-side">
            <div className="label">Preview</div>
            <div className="mc-serverlist mini"><div className="mc-icon"><canvas ref={small} width={64} height={64} /></div><div className="tiny muted">64×64</div></div>
            <Field label={`Size: ${Math.round(zoom * 100)} %`}>
              <input className="range" type="range" min={Math.round(fitZoom * 50)} max={800} value={Math.round(zoom * 100)} onChange={(e) => zoomAt(Number(e.target.value) / 100)} />
            </Field>
            <div className="row-tight" style={{ flexWrap: 'wrap' }}>
              <Btn className="xs" onClick={() => { setZoom(1); setOff({ x: 0, y: 0 }); }}>Fill</Btn>
              <Btn className="xs" onClick={() => { setZoom(fitZoom); setOff({ x: 0, y: 0 }); }}>Show all</Btn>
              <Btn className="xs ghost" onClick={() => setOff({ x: 0, y: 0 })}>Zentrieren</Btn>
            </div>
            <div className="row-tight small"><Switch checked={!smooth} onChange={(v) => setSmooth(!v)} label="Pixel art (sharp edges)" /><span>Pixel art (sharp edges)</span></div>
            <div className="tiny muted">{T(`Image: ${img.width}×${img.height} pixels`)}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ Darstellung (MOTD + Symbol) */
/** iconOnly: nur das Server-Symbol (wenn eine Erweiterung wie MOTD-Studio die Beschreibung übernimmt). */
function Appearance({ s, iconOnly = false }) {
  const props = useApi(`/mc/servers/${s.id}/properties`, [], { live: false });
  const [motd, setMotd] = useState(null);
  const [iconV, setIconV] = useState(Date.now());
  const [hasIcon, setHasIcon] = useState(true);
  const [crop, setCrop] = useState(null); // gewählte Bilddatei → Zuschneiden
  const [savingMotd, setSavingMotd] = useState(false);
  const input = useRef(null);
  const file = useRef(null);
  useEffect(() => { if (props.data) setMotd((props.data.motd || '').replace(/\\u00a7/gi, '§')); }, [props.data]);
  if (motd === null) return <div className="card"><Loading /></div>;
  const running = s.proc.state === 'running';
  // Vorschau: was Spieler gerade wirklich sehen (Live-Abfrage), außer du tippst gerade eine neue MOTD
  const saved = (props.data.motd || '').replace(/\\u00a7/gi, '§');
  const live = running ? s.proc.extra.liveMotd : null;
  const edited = motd !== saved;
  const norm = (t) => String(t || '').replace(/§[0-9a-fk-orx]/gi, '').replace(/\\n/g, '\n').trim();
  const overridden = !!live && norm(live) !== norm(saved);
  const shown = edited || !live ? motd : live;
  const insert = (code) => {
    const el = input.current;
    const pos = el ? el.selectionStart : motd.length;
    setMotd(motd.slice(0, pos) + code + motd.slice(pos));
    setTimeout(() => { if (el) { el.focus(); el.setSelectionRange(pos + code.length, pos + code.length); } }, 0);
  };
  // Läuft der Server mit HostwerkBridge 1.2+, sehen Spieler MOTD und Symbol sofort – sonst nach dem nächsten Neustart
  const liveNote = (r) => (!r.running ? '' : r.live ? T(' – visible right away') : r.bridgeNeeded ? T(' – visible after a restart (right away with HostwerkBridge)') : T(' – visible after restart'));
  const saveMotd = async () => {
    setSavingMotd(true);
    try { const r = await put(`/mc/servers/${s.id}/motd`, { motd: motd.replace(/§/g, '\\u00a7') }); props.setData({ ...props.data, motd: r.motd }); toast.success(T('MOTD saved') + T(liveNote(r))); } catch (e) { toast.error(e.message); }
    setSavingMotd(false);
  };
  const saveIcon = async (png) => {
    try { const r = await put(`/mc/servers/${s.id}/icon`, { png }); setIconV(Date.now()); setHasIcon(true); setCrop(null); toast.success(T('Server icon saved') + T(liveNote({ ...r, running }))); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><Palette size={16} /><h3>{iconOnly ? T(T('Server icon')) : T('This is how players see your server')}</h3></div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="mc-serverlist">
          <DropTarget onFile={setCrop}>
            <div className="mc-icon" role="button" tabIndex={0} onClick={() => file.current && file.current.click()} onKeyDown={(e) => { if (e.key === 'Enter') file.current && file.current.click(); }} title="Change icon – pick an image or drop it here, then choose the crop">
              {hasIcon ? <img src={`/api/mc/servers/${s.id}/icon?v=${iconV}`} alt="" onError={() => setHasIcon(false)} /> : <ImageIcon size={26} />}
            </div>
          </DropTarget>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="mc-name"><Keep>{s.name}</Keep></div>
            <div className="mc-motd-preview"><McText text={shown || 'A Minecraft Server'} /></div>
          </div>
          <div className="mc-count">{playerCount(s)}/{s.proc.extra.maxPlayersLive || s.maxPlayers || 20}</div>
        </div>
        {!iconOnly && live && edited && <div className="small muted">The preview shows your change – this is what players see after saving.</div>}
        {!iconOnly && live && !edited && overridden && <InfoTip>This MOTD comes live from the server – a plugin overrides the description from server.properties. Changes here only apply if the plugin doesn't replace them.</InfoTip>}
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) setCrop(e.target.files[0]); e.target.value = ''; }} />
        {!iconOnly && <>
        <Field label="Description (MOTD)" hint={'Second line with \\n. Insert colors with a click.'}>
          <input ref={input} className="input mono" value={motd} onChange={(e) => setMotd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && edited) saveMotd(); }} />
        </Field>
        <div className="mc-colors">
          {Object.entries(MC).map(([k, c]) => <button key={k} title={`§${k}`} style={{ background: c }} onClick={() => insert('§' + k)} />)}
          <button className="fmt" title="Fett" onClick={() => insert('§l')}><b>F</b></button>
          <button className="fmt" title="Kursiv" onClick={() => insert('§o')}><i>K</i></button>
          <button className="fmt" title="Revert" onClick={() => insert('§r')}>↺</button>
        </div>
        </>}
        <div className="row">
          {!iconOnly && <Btn className="primary sm" icon={Save} busy={savingMotd} disabled={!edited} onClick={saveMotd}>Save</Btn>}
          <Btn className="sm" icon={ImageIcon} onClick={() => file.current && file.current.click()}>Choose icon …</Btn>
          {hasIcon && <Btn className="sm ghost" icon={Trash2} onClick={async () => { try { const r = await del(`/mc/servers/${s.id}/icon`); setHasIcon(false); if (running) toast(r.live ? T('Icon removed – visible right away') : T('Icon removed – visible after a restart')); } catch (e) { toast.error(e.message); } }}>Remove icon</Btn>}
        </div>
      </div>
      {crop && <IconCropper file={crop} onCancel={() => setCrop(null)} onSave={saveIcon} />}
    </div>
  );
}

/** Bild per Ziehen & Ablegen aufs Symbol annehmen. */
function DropTarget({ onFile, children }) {
  const [over, setOver] = useState(false);
  return (
    <div className={`mc-icon-drop ${over ? 'over' : ''}`} onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files].find((x) => /^image\//.test(x.type)); if (f) onFile(f); }}>
      {children}
    </div>
  );
}


/* ------------------------------------------------------------------ Schnellaktionen */
const RESTART_STEPS = [[0, 'Right away'], [10, 'In 10 seconds'], [30, 'In 30 seconds'], [60, 'In 1 minute'], [300, 'In 5 minutes']];
const MODES = [['survival', 'Survival'], ['creative', 'Creative'], ['adventure', 'Adventure'], ['spectator', 'Spectator']];
const DIFFS = [['peaceful', 'Peaceful'], ['easy', 'Simple'], ['normal', 'Normal'], ['hard', 'Hard']];

/** Knopf der Schnellaktionen (more = öffnet eine Auswahl). */
function Q({ icon: I, label, onClick, title, more, danger, off }) {
  return <button type="button" className={`mc-qbtn ${danger ? 'danger' : ''}`} disabled={off} title={title ? T(title) : undefined} onClick={onClick}><I />{label}{more && <ChevronDown className="mc-qmore" />}</button>;
}

/** Häufige Befehle als Knöpfe, nach Zweck gruppiert. Knöpfe mit ▾ öffnen eine kleine Auswahl. */
function QuickActions({ s, ready, cmd }) {
  const run = (c, ok) => { cmd(c); if (ok) toast.success(T(ok)); };
  const menuAt = (e, items) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, items); };
  const paper = ['paper', 'purpur', 'folia', 'leaf', 'pufferfish'].includes(s.type);
  return (
    <div className="card">
      <div className="card-head"><Zap size={16} /><h3>Quick actions</h3>{!ready && <span className="tiny muted">World loading …</span>}</div>
      <div className="card-body stack" style={{ gap: 10 }}>
        <div className="mc-qgroup"><div className="label">Time & weather</div>
          <div className="mc-quick">
            <Q off={!ready} icon={Sun} label="Day" onClick={() => run('time set day')} />
            <Q off={!ready} icon={Moon} label="Night" onClick={() => run('time set night')} />
            <Q off={!ready} icon={CloudSun} label="Sunny" onClick={() => run('weather clear')} />
            <Q off={!ready} icon={CloudRain} label="Rain" onClick={() => run('weather rain')} />
            <Q off={!ready} icon={CloudLightning} label="Thunder" onClick={() => run('weather thunder')} />
          </div>
        </div>
        <div className="mc-qgroup"><div className="label">Players</div>
          <div className="mc-quick">
            <Q off={!ready} icon={Megaphone} label="Announce" onClick={async () => { const t = await promptDialog({ title: 'Message to everyone', label: 'Text', placeholder: 'Server restarting soon!' }); if (t) cmd(`say ${t}`); }} />
            <Q off={!ready} icon={HeartPulse} label="Heal all" title="Heal and feed all players" onClick={() => { cmd('effect give @a minecraft:instant_health 1 10'); run('effect give @a minecraft:saturation 1 10', T('All players healed')); }} />
            <Q off={!ready} icon={Gamepad2} label="Game mode" more title="Game mode for all online players" onClick={(e) => menuAt(e, MODES.map(([id, l]) => ({ label: T(`All: ${l}`), onClick: () => run(`gamemode ${id} @a`, T(`All players: ${l}`)) })))} />
            <Q off={!ready} icon={UserX} label="Kick all" danger title="Disconnect all players (e.g. for maintenance)" onClick={async () => { const r = await promptDialog({ title: 'Kick all players?', label: 'Reason (optional)', value: T('Maintenance – back in a moment!'), confirm: 'Kick all' }); if (r !== null) run(`kick @a ${r}`.trim(), T('All players kicked')); }} />
          </div>
        </div>
        <div className="mc-qgroup"><div className="label">World</div>
          <div className="mc-quick">
            <Q off={!ready} icon={SlidersHorizontal} label="Difficulty" more onClick={(e) => menuAt(e, DIFFS.map(([id, l]) => ({ label: T(l), onClick: () => run(`difficulty ${id}`, T(`Difficulty: ${l}`)) })))} />
            <Q off={!ready} icon={Eraser} label="Clear items" title="Remove all items lying around – helps against lag" onClick={async () => { if (await confirmDialog({ title: 'Remove items lying around?', text: 'All items on the ground in all loaded chunks disappear. Player inventories stay untouched.', confirm: 'Clean up' })) run('kill @e[type=minecraft:item]', T('Items removed')); }} />
            <Q off={!ready} icon={Package} label="Reload datapacks" title="Re-read datapacks, recipes and functions (no restart)" onClick={() => run('minecraft:reload', T('Datapacks are being reloaded'))} />
            {paper && <Q off={!ready} icon={Gauge} label="Measure TPS" onClick={() => cmd('tps')} />}
          </div>
        </div>
        <div className="mc-qgroup"><div className="label">Server</div>
          <div className="mc-quick">
            <Q off={!ready} icon={Save} label="Save" onClick={() => run('save-all', T('World is being saved'))} />
            <Q off={!ready} icon={Archive} label="Backup" onClick={async () => { try { await post(`/mc/servers/${s.id}/backups`, { label: 'schnell' }); toast(T('Backup running …')); } catch (e) { toast.error(e.message); } }} />
            <Q off={!ready} icon={RotateCw} label="Restart" more title="Restart – with a warning in chat if you like" onClick={(e) => menuAt(e, RESTART_STEPS.map(([sec, l]) => ({ label: T(l), hint: sec ? T('with announcement') : '', onClick: async () => { try { await post(`/mc/servers/${s.id}/restart-warn`, { seconds: sec }); toast(sec ? T(`Restart in ${sec} s – players are being warned`) : T('Server is restarting …')); } catch (er) { toast.error(er.message); } } })))} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Übersicht */
export function OverviewTab({ s }) {
  const connectSlots = useSlot('mc.connect'); // z. B. Bedrock-Spieler (Erweiterung Bedrock-Brücke)
  const running = s.proc.state === 'running';
  const ready = running && s.proc.extra.ready;
  const players = s.proc.extra.players || [];
  const worlds = useApi(`/mc/servers/${s.id}/worlds`);
  const test = useApi(`/mc/servers/${s.id}/selftest`);
  const [lines] = useLogs(`mc:${s.id}`, `/mc/servers/${s.id}/logs`);
  const cmd = (c) => post(`/mc/servers/${s.id}/command`, { command: c }).catch((e) => toast.error(e.message));
  const errors = lines.filter((l) => /\b(ERROR|SEVERE)\b|Exception/.test(l.l)).slice(-5);
  const worldSize = worlds.data ? worlds.data.worlds.reduce((n, w) => n + w.size, 0) : null;
  const tps = s.proc.extra.tps;
  const lists = usePlayerLists(s);
  const ctxFor = usePlayerContext(s, lists, players);
  // Bringt eine Erweiterung einen Abschnitt mit Rolle „motd“ (z. B. MOTD-Studio), zeigt nur er Vorschau und Editor
  const motdByExt = useSectionRole('mc.overview', 'motd', { kind: 'minecraft', id: s.id });
  return (
    <div className="mc-fit-stack">
      <div className="grid grid-4">
        <div className="card stat"><div className="k"><Users />Players</div><div className="v">{players.length}<span className="of"> / {s.maxPlayers || 20}</span></div><div className="s">{running ? (ready ? 'online' : 'World loading …') : 'Server stopped'}</div></div>
        <div className="card stat"><div className="k"><Gauge />Performance</div><div className="v" style={{ color: tps == null ? undefined : tps >= 19.5 ? 'var(--ok)' : tps >= 17 ? 'var(--warn)' : 'var(--err)' }}>{tps != null ? tps : '–'}<span className="of"> TPS</span></div><div className="s">{tps != null ? '20 = smooth' : ['paper', 'purpur'].includes(s.type) ? <button className="link-btn" disabled={!ready} onClick={() => cmd('tps')}>measure</button> : 'Paper/Purpur only'}</div></div>
        <div className="card stat"><div className="k"><HardDrive />Worlds</div><div className="v">{worldSize != null ? fmtBytes(worldSize) : '…'}</div><div className="s">{worlds.data ? (() => { const n = worlds.data.worlds.reduce((k, w) => k + Math.max(1, (w.dims || []).length), 0); return n > worlds.data.worlds.length ? `${pl(worlds.data.worlds.length, '{n} world', '{n} worlds')} · ${pl(n, '{n} dimension', '{n} dimensions')}` : pl(worlds.data.worlds.length, '{n} world', '{n} worlds'); })() : ''}</div></div>
        <div className="card stat"><div className="k"><ShieldCheck />Check</div><div className="v text" style={{ marginTop: 8 }}>{test.data ? (test.data.ok ? <span style={{ color: 'var(--ok-text)' }}>passed</span> : <span style={{ color: 'var(--err-text)' }}>Problems</span>) : <span className="muted">–</span>}</div><div className="s">{test.data ? fmtDate(test.data.at) : <a href={`#/mc/${s.id}/automation`}>check now →</a>}</div></div>
      </div>
      <div className="grid grid-2 mc-fit-grid">
        <div className="stack mc-col">
          <div className="card">
            <div className="card-head"><Gauge size={16} /><h3>Health</h3><div className="right"><StatusPill state={s.proc.state} label={running && !ready ? 'Loading world …' : undefined} /></div></div>
            <div className="card-body stack" style={{ gap: 12 }}>
              <HealthSummary s={s} />
              <div className="stack" style={{ gap: 6 }}>
                <div className="label">Connect</div>
                {[s.address.local, ...s.address.lan].map((a) => <div key={a} className="row-tight"><code className="grow ellipsis">{a}</code><button className="btn ghost xs icon" title="Copy" onClick={() => { navigator.clipboard.writeText(a); toast.success('Address copied'); }}><Copy /></button></div>)}
                {connectSlots.map((c) => <ErrorBoundary key={c.key} silent where={c.key}><c.Component s={s} /></ErrorBoundary>)}
              </div>
            </div>
          </div>
          {running && <QuickActions s={s} ready={ready} cmd={cmd} />}
          <TpsCard s={s} />
          {errors.length > 0 && (
            <div className="card">
              <div className="card-head"><AlertTriangle size={16} style={{ color: 'var(--warn-text)' }} /><h3>Recent errors in the log</h3><div className="right"><a className="btn ghost sm" href={`#/mc/${s.id}/console`}><ScrollText />Console</a></div></div>
              <div className="card-body stack" style={{ gap: 4 }}>{errors.map((e, i) => <div key={i} className="mono tiny ellipsis" style={{ color: 'var(--err-text)' }} title={e.l}>{e.l.replace(/\x1b\[[0-9;]*m/g, '')}</div>)}</div>
            </div>
          )}
        </div>
        <div className="stack mc-col">
          <div className="card">
            <div className="card-head"><Users size={16} /><h3>Online ({players.length})</h3><div className="right"><a className="btn ghost sm" href={`#/mc/${s.id}/players`}>Player management</a></div></div>
            {players.length === 0 ? <div className="card-body small muted">{running ? 'Nobody online.' : 'Server is stopped.'}</div> : (
              <div className="mc-players">
                {players.map((p) => (
                  <div key={p} className="mc-player" onContextMenu={ctxFor(p)} title="Right-click: more actions">
                    <PlayerHead name={p} size={40} />
                    <span className="ellipsis">{p}{lists.isOp(p) && <Crown size={12} className="mc-op-badge" />}</span>
                    <PlayerButtons s={s} name={p} lists={lists} online={players} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <Appearance s={s} iconOnly={!!motdByExt} />
          {/* Abschnitte von Erweiterungen (SDK 3.2), z. B. MOTD-Studio – statt eigener Reiter */}
          <ExtSections place="mc.overview" ctx={{ kind: 'minecraft', id: s.id }} native={{ server: s }} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Welten & Regeln */
export function WorldsTab({ s }) {
  const w = useApi(`/mc/servers/${s.id}/worlds`);
  const [rules, setRules] = useState(null);
  const [rq, setRq] = useState('');
  const [dlg, setDlg] = useState(null); // „upload“ | „pregen“ – Seltenes im Fenster, die Weltenliste steht oben
  const running = s.proc.state === 'running' && s.proc.extra.ready;
  const loadRules = () => get(`/mc/servers/${s.id}/gamerules`).then(setRules).catch((e) => toast.error(e.message));
  useEffect(() => { loadRules(); }, [running, s.proc.state]); // eslint-disable-line react-hooks/exhaustive-deps -- kein Nachladen: Regeln werden hier bearbeitet, neu bei Start/Stopp
  const LABEL = { keepInventory: T('Keep inventory on death'), doDaylightCycle: T('Day-night cycle'), doWeatherCycle: T('Weather cycle'), doMobSpawning: T('Mobs spawn'), mobGriefing: T('Mobs destroy blocks'), doFireTick: T('Fire spreads'), pvp: 'PvP', naturalRegeneration: T('Natural regeneration'), doInsomnia: T('Phantoms'), doImmediateRespawn: T('Immediate respawn'), announceAdvancements: T('Announce advancements'), showDeathMessages: T('Death messages'), doMobLoot: T('Mobs drop loot'), doTileDrops: T('Blocks drop items'), fallDamage: T('Fall damage'), fireDamage: T('Fire damage'), drowningDamage: T('Drowning'), freezeDamage: T('Freezing'), playersSleepingPercentage: T('Sleeping players to skip night (%)'), randomTickSpeed: T('Random tick speed'), spawnRadius: T('Spawn radius'), maxEntityCramming: T('Max. entities on one block'), doTraderSpawning: T('Traders spawn'), doPatrolSpawning: T('Pillager patrols'), disableRaids: T('Disable raids'), commandBlockOutput: T('Command block output'), sendCommandFeedback: T('Command feedback'), reducedDebugInfo: T('Reduced debug info (F3)'), spectatorsGenerateChunks: T('Spectators generate chunks'), forgiveDeadPlayers: T('Neutral mobs forgive'), universalAnger: T('Universal anger'), tntExplodes: T('TNT explodes'), projectilesCanBreakBlocks: T('Projectiles break blocks') };
  // Minecraft 26: neue, englische Namen (minecraft:keep_inventory) – Erklärungen dafür und für die alten Namen
  const LABEL26 = { keep_inventory: T('Keep inventory on death'), advance_time: T('Day-night cycle'), advance_weather: T('Weather cycle'), spawn_mobs: T('Mobs spawn'), spawn_monsters: T('Monsters spawn'), mob_griefing: T('Mobs destroy blocks'), fire_spread_radius_around_player: T('Fire spreads (radius around players)'), pvp: 'PvP', natural_health_regeneration: T('Natural regeneration'), spawn_phantoms: T('Phantoms'), immediate_respawn: T('Immediate respawn'), show_advancement_messages: T('Announce advancements'), show_death_messages: T('Death messages'), mob_drops: T('Mobs drop loot'), block_drops: T('Blocks drop items'), entity_drops: T('Entities drop items (minecarts, frames …)'), fall_damage: T('Fall damage'), fire_damage: T('Fire damage'), drowning_damage: T('Drowning'), freeze_damage: T('Freezing'), players_sleeping_percentage: T('Sleeping players to skip night (%)'), random_tick_speed: T('Random tick speed'), respawn_radius: T('Spawn radius'), max_entity_cramming: T('Max. entities on one block'), spawn_wandering_traders: T('Traders spawn'), spawn_patrols: T('Pillager patrols'), raids: T('Raids'), command_block_output: T('Command block output'), send_command_feedback: T('Command feedback'), reduced_debug_info: T('Reduced debug info (F3)'), spectators_generate_chunks: T('Spectators generate chunks'), forgive_dead_players: T('Neutral mobs forgive'), universal_anger: T('Universal anger'), tnt_explodes: T('TNT explodes'), projectiles_can_break_blocks: T('Projectiles break blocks'), spawn_wardens: T('Wardens spawn'), command_blocks_work: T('Command blocks work'), log_admin_commands: T('Log admin commands'), limited_crafting: T('Only unlocked recipes'), elytra_movement_check: T('Elytra movement check'), player_movement_check: T('Movement check (anti-cheat)'), global_sound_events: T('Global sounds (dragon, wither)'), lava_source_conversion: T('Lava becomes a source'), water_source_conversion: T('Water becomes a source'), spread_vines: T('Vines spread'), allow_entering_nether_using_portals: T('Nether portals usable'), players_nether_portal_default_delay: T('Portal wait (ticks)'), players_nether_portal_creative_delay: T('Portal wait in creative (ticks)'), tnt_explosion_drop_decay: T('TNT: some drops are lost'), block_explosion_drop_decay: T('Block explosion: some drops are lost'), mob_explosion_drop_decay: T('Creeper: some drops are lost'), ender_pearls_vanish_on_death: T('Ender pearls vanish on death'), spawner_blocks_work: T('Spawners work'), locator_bar: T('Player locator bar'), max_command_sequence_length: T('Max. command chain length'), max_command_forks: T('Max. command forks'), max_block_modifications: T('Max. block modifications per command'), max_snow_accumulation_height: T('Max. snow accumulation'), disable_elytra_movement_check: T('Elytra check off'), disable_player_movement_check: T('Movement check off'), do_vines_spread: T('Vines spread'), do_warden_spawning: T('Wardens spawn') };
  const GROUP26 = (n) => (/damage|regeneration|respawn|keep_inventory|sleeping|phantom|ender_pearl|pvp|forgive|anger|locator/.test(n) ? T('Players') : /spawn|mob|raid|patrol|trader|warden|griefing|cramming/.test(n) ? T('Creatures') : /drop|tnt|explo|fire|vine|source|tick|snow|block|projectile|nether|portal|time|weather/.test(n) ? T('World') : T('Tech'));
  const labelOf = (r) => { const short = r.name.replace(/^minecraft:/, ''); return LABEL[r.name] || LABEL26[short] || short.replace(/_/g, ' ').replace(/^do /, '').replace(/^\w/, (c) => c.toUpperCase()); };
  const setRule = async (r, v) => {
    try {
      const res = await put(`/mc/servers/${s.id}/gamerules`, { name: r.name, value: v });
      setRules({ ...rules, rules: rules.rules.map((x) => (x.name === r.name ? { ...x, value: String(v) } : x)) });
      toast.success(res.live ? `${labelOf(r)} set` : `${labelOf(r)} set in the world file – applies on the next start`);
    } catch (e) { toast.error(e.message); }
  };
  const list = rules && rules.rules ? rules.rules.filter((r) => !rq || `${r.name} ${labelOf(r)}`.toLowerCase().includes(rq.toLowerCase())) : [];
  const groups = [...new Set(list.map((r) => GROUP26(r.name.replace(/^minecraft:/, ''))))].sort((a, b) => [T('Players'), T('Creatures'), T('World'), T('Tech')].indexOf(a) - [T('Players'), T('Creatures'), T('World'), T('Tech')].indexOf(b));
  const stopped = s.proc.state !== 'running';
  const dimInfo = useDimInfo(s.id); // Symbole aus dem Katalog bzw. aus den echten Eigenschaften der Dimension
  const reset = async (x, d) => {
    const what = d ? `${dimLabel(d.id, dimInfo(d.id))} (${x.name})` : x.name;
    const text = d
      ? (d.id === 'minecraft:overworld' ? T('The overworld terrain is deleted and generated again at the next start. Player data, seed and game rules stay. Hostwerk makes a backup first.') : T('Only this dimension is deleted and generated again at the next start – the others stay as they are. Hostwerk makes a backup first.'))
      : T('The whole world (all dimensions in it) is deleted and generated again at the next start. Hostwerk makes a backup first.');
    if (!(await confirmDialog({ title: T(`Reset “${what}”?`), text, confirm: 'Revert', danger: true, typeToConfirm: x.main && (!d || d.id === 'minecraft:overworld') ? x.name : null }))) return;
    try { const r = await post(`/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/reset`, d ? { dim: d.id } : {}); await waitJob(r.job); toast.success(T(`${what} reset`)); } catch (e) { toast.error(e.message); }
    w.reload();
  };
  // Welten ohne erkannte Dimension (nur level.dat): eine Zeile nach Art des Ordners
  const dimsOf = (x) => ((x.dims || []).length ? x.dims : [{ id: { nether: 'minecraft:the_nether', end: 'minecraft:the_end' }[x.kind] || 'minecraft:overworld', path: null, size: x.size, guess: true }]);
  return (
    <div className="grid grid-2 mc-fit-grid">
      <div className="card mc-scroll">
        <div className="card-head"><Globe2 size={16} /><h3>Worlds</h3>{w.data && w.data.seed && <span className="badge" title="Seed">Seed {w.data.seed}</span>}<div className="right row-tight">{!s.proxy && <><Btn className="ghost sm" icon={Upload} onClick={() => setDlg('upload')}>Upload world …</Btn><Btn className="ghost sm" icon={Zap} onClick={() => setDlg('pregen')}>Pre-generate …</Btn></>}<button className="btn ghost sm icon" title="Reload" aria-label="Reload" onClick={w.reload}><RefreshCw /></button></div></div>
        {!stopped && w.data && w.data.worlds.length > 0 && <div className="info-line mc-scroll-fixed"><Info size={13} /><span className="grow">Worlds can only be reset while the server is stopped.</span><SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" /></div>}
        <div className="mc-scroll-body">
          {!w.data ? <Loading /> : w.data.worlds.length === 0 ? <TileEmpty text="No world yet – it's generated on first start." /> : w.data.worlds.map((x) => (
            <div key={x.name} className="mc-world">
              <div className="mc-world-head">
                <FolderOpen size={15} className="muted" />
                <b className="ellipsis">{x.name}</b>{x.main && <span className="badge accent">Main world</span>}
                <span className="tiny muted">{fmtBytes(x.size)}{(x.dims || []).length > 1 ? ` · ${pl(x.dims.length, '{n} dimension', '{n} dimensions')}` : ''}</span>
                <span className="grow" />
                <a className="btn ghost xs" href={`/api/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/download`} title="Download whole world as ZIP"><Download />ZIP</a>
                <Btn className="ghost xs" icon={RotateCcw} disabled={!stopped} title={!stopped ? 'Stop the server first' : 'Regenerate the whole world'} onClick={() => reset(x, null)}>Reset everything</Btn>
              </div>
              {dimsOf(x).map((d) => (
                <div key={d.id} className="list-item mc-dim">
                  <McDimIcon id={d.id} info={dimInfo(d.id)} size={32} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="bold">{dimLabel(d.id, dimInfo(d.id))}</div>
                    <div className="tiny muted"><span className="mono">{dimKey(d.id)}</span>{d.size != null ? ` · ${fmtBytes(d.size)}` : ''}{!d.id.startsWith('minecraft:') ? ` · ${T('from datapack or mod')}` : ''}</div>
                  </div>
                  {d.path && !d.guess && (x.dims || []).length > 1 && <Btn className="ghost xs" icon={RotateCcw} disabled={!stopped} title={!stopped ? 'Stop the server first' : 'Regenerate only this dimension'} onClick={() => reset(x, d)}>Revert</Btn>}
                </div>
              ))}
            </div>
          ))}
          <div className="card-body tiny muted">Tip: resetting the Nether and the End on their own is a popular way to get new resources – the overworld stays.</div>
        </div>
      </div>
      <div className="card mc-scroll">
        <div className="card-head"><ShieldCheck size={16} /><h3>Game rules</h3>{rules && rules.rules && rules.rules.length > 0 && <span className="badge">{rules.live ? 'live' : rules.running ? 'from the world file' : 'Server stopped'}</span>}
          <div className="right row-tight"><div className="input-icon" style={{ width: 170 }}><Search /><input className="input sm" placeholder="Search rule …" value={rq} onChange={(e) => setRq(e.target.value)} /></div><button className="btn ghost sm icon" title="Reload" onClick={loadRules}><RefreshCw /></button></div>
        </div>
        {!rules ? <Loading /> : !rules.rules.length ? <div className="card-body small muted">{running ? 'No rules found – the world is not saved yet. After the first “save-all” they appear here.' : 'No world yet – after the first start the rules can be changed here (even with the server stopped).'}</div> : (
          <div className="card-body mc-rules mc-scroll-body" style={{ paddingTop: 4 }}>
            {!rules.running && <div className="tiny muted" style={{ marginBottom: 6 }}>The server is off – changes go straight into the world file and apply on the next start.</div>}
            {groups.map((gname) => (
              <div key={gname} className="mc-rules-group">
                <div className="label">{gname}</div>
                {list.filter((r) => GROUP26(r.name.replace(/^minecraft:/, '')) === gname).map((r) => (
                  <div key={r.name} className="mc-rule" title={r.name}>
                    <div className="grow" style={{ minWidth: 0 }}><div className="small ellipsis">{labelOf(r)}</div><div className="tiny muted mono ellipsis">{r.name.replace(/^minecraft:/, '')}</div></div>
                    {r.type === 'bool' ? <Switch checked={r.value === 'true'} onChange={(v) => setRule(r, v)} /> : <input className="input sm mono" style={{ width: 84 }} type="number" defaultValue={r.value} onBlur={(e) => { if (e.target.value !== r.value) setRule(r, Number(e.target.value)); }} />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {dlg === 'upload' && <Modal title="Upload world" subtitle="Import a singleplayer world (folder from .minecraft/saves) or a zipped world. Hostwerk backs up the whole server first." onClose={() => setDlg(null)} footer={<Btn onClick={() => setDlg(null)}>Close</Btn>}><WorldUploadCard s={s} bare onDone={() => { w.reload(); setDlg(null); }} /></Modal>}
      {dlg === 'pregen' && <Modal title="Pre-generate world" subtitle="With Chunky the server generates the terrain in advance – exploring no longer stutters later." onClose={() => setDlg(null)} footer={<Btn onClick={() => setDlg(null)}>Close</Btn>}><PregenCard s={s} bare /></Modal>}
    </div>
  );
}

/* ------------------------------------------------------------------ Karte */
export function MapTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/map`);
  const [busy, setBusy] = useState(false);
  const [reach, setReach] = useState(null);
  const d = st.data;
  useEffect(() => {
    if (!d || !d.installed || !d.running) { setReach(null); return undefined; }
    let alive = true;
    const probe = () => fetch(d.url, { mode: 'no-cors' }).then(() => alive && setReach(true)).catch(() => alive && setReach(false));
    probe();
    const t = setInterval(probe, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [d && d.url, d && d.installed, d && d.running]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Loading />;
  if (!d.supported) return <div className="card"><Empty icon={MapIcon} title="The map needs plugins" text="Vanilla servers don't support plugins. Switch to Paper or Purpur under “Version” – your world is kept." /></div>;
  const setup = async () => { setBusy(true); try { const r = await post(`/mc/servers/${s.id}/map`); const j = await waitJob(r.job); toast.success(j.result.needsRestart ? 'BlueMap installed – restart the server now' : 'BlueMap installed – start the server'); } catch (e) { toast.error(e.message); } setBusy(false); st.reload(); };
  if (!d.installed) {
    return (
      <div className="card"><Empty icon={MapIcon} title="Live map of your world" text="Hostwerk sets up the BlueMap plugin: a 3D map in the browser showing players, buildings and terrain. On first start BlueMap renders the world – this can take a few minutes.">
        <Btn className="grad" icon={MapIcon} busy={busy} onClick={setup}>Set up map</Btn>
      </Empty></div>
    );
  }
  return (
    <div className="stack">
      <div className="row">
        <span className="badge ok">BlueMap · port {d.port}</span>
        {!d.running ? <span className="small muted">Start the server to see the map.</span> : reach === false ? <span className="small muted">Map is still starting … (after the restart BlueMap renders in the background)</span> : null}
        <div className="right row-tight">
          <Btn className="sm" icon={ExternalLink} disabled={!d.running} onClick={() => openExternal(d.url)}>Open in browser</Btn>
          <Btn className="sm ghost" icon={RefreshCw} onClick={setup}>Check setup</Btn>
        </div>
      </div>
      {d.running && reach ? <iframe className="mc-map" title="Map" src={d.url} /> : (
        <div className="card"><Empty icon={MapIcon} title={d.running ? 'Preparing map …' : 'Server is stopped'} text={d.running ? 'If BlueMap was just installed: restart the server once.' : ''} /></div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Zeitplan & Prüfung */
export function AutomationTab({ s }) {
  const test = useApi(`/mc/servers/${s.id}/selftest`);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { const r = await post(`/mc/servers/${s.id}/selftest`); const j = await waitJob(r.job); test.setData(j.result); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const r = test.data;
  const icon = { ok: <CheckCircle2 size={16} style={{ color: 'var(--ok-text)' }} />, warn: <AlertTriangle size={16} style={{ color: 'var(--warn-text)' }} />, fail: <XCircle size={16} style={{ color: 'var(--err-text)' }} /> };
  const presets = [
    { label: T('Nightly restart'), name: T('Restart {name}', { name: s.name }), action: { type: 'mc-restart', target: s.id, warnSeconds: 60 }, schedule: { mode: 'daily', time: '04:00' } },
    { label: T('Daily backup'), name: T('Backup {name}', { name: s.name }), action: { type: 'mc-backup', target: s.id }, schedule: { mode: 'daily', time: '03:30' } },
    { label: T('Regular announcement'), name: T('Announcement {name}', { name: s.name }), action: { type: 'mc-command', target: s.id, command: T('say §aThanks for playing on our server!') }, schedule: { mode: 'every', minutes: 60 } },
  ];
  const [preset, setPreset] = useState(null);
  return (
    <div className="grid grid-2">
      <div className="stack">
        <div className="card">
          <div className="card-head"><CalendarClock size={16} /><h3>Templates</h3></div>
          <div className="card-body row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {presets.map((p) => <Btn key={p.label} className="sm" onClick={() => setPreset({ ...p, lockTarget: true, key: Date.now() })}>{p.label}</Btn>)}
          </div>
        </div>
        <TaskList key={preset ? preset.key : 0} compact filter={(t) => t.action.target === s.id} preset={preset || { action: { type: 'mc-restart', target: s.id, warnSeconds: 60 }, schedule: { mode: 'daily', time: '04:00' } }} />
        {preset && <PresetOpener preset={preset} onDone={() => setPreset(null)} />}
      </div>
      <div className="card">
        <div className="card-head"><ShieldCheck size={16} /><h3>Server check</h3><div className="right"><Btn className="sm primary" icon={Play} busy={busy} onClick={run}>Check now</Btn></div></div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="small muted">Starts the server (if needed), waits until it's ready and checks plugins, log errors, performance, memory and reachability. If the server was off, it's stopped again afterwards. Ideal after updates or new plugins.</div>
          {!r ? <Empty icon={ShieldCheck} title="Not checked yet" /> : (
            <>
              <div className={`test-summary ${r.ok ? 'ok' : 'fail'}`}>{r.ok ? <CheckCircle2 /> : <XCircle />}<div><b>{r.ok ? (r.warnings ? `Passed with ${pl(r.warnings, '{n} note', '{n} notes')}` : 'All good') : 'There are problems'}</b><div className="small">{fmtDate(r.at)} · {Math.round(r.ms / 1000)} s</div></div></div>
              {r.checks.map((c, i) => <div key={i} className="row" style={{ alignItems: 'flex-start' }}>{icon[c.status]}<div className="grow"><div className="bold small">{c.name}</div><div className="small muted">{c.detail}</div></div></div>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Öffnet den Editor einer Vorlage über die TaskList (Trick: neue TaskList-Instanz mit Preset). */
function PresetOpener({ preset, onDone }) {
  return <TaskEditor preset={preset} onClose={onDone} onSaved={onDone} />;
}
