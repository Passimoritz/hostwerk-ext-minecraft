import { useEffect, useRef, useState } from 'react';
import { Users, Gauge, Copy, Sun, Moon, CloudSun, CloudRain, CloudLightning, Save, Megaphone, Archive, ShieldCheck, Globe2, Map as MapIcon, Image as ImageIcon, Trash2, Download, RotateCcw, RotateCw, CalendarClock, Play, CheckCircle2, XCircle, AlertTriangle, ExternalLink, RefreshCw, Crown, HardDrive, ScrollText, Palette, Gamepad2, Search, Zap, Info, Upload, HeartPulse, UserX, SlidersHorizontal, Eraser, Package, ChevronDown, FolderOpen } from 'lucide-react';
import { get, post, put, del, useApi, useLogs, useStore, fmtBytes, fmtDate, openExternal, waitJob, mcCount } from '@hostwerk/api';
import { Btn, StatusPill, Empty, Loading, Callout, Field, Switch , toast, confirmDialog, promptDialog, InfoTip, TileEmpty, Modal } from '@hostwerk/ui';
import { SvcShortcut } from '@hostwerk/kit';
import { contextMenu } from '@hostwerk/kit';
import McDimIcon, { dimLabel, dimKey, useDimInfo } from './McDimIcon';
import { HealthSummary } from './McHealth';
import { TaskList, TaskEditor } from '@hostwerk/kit';
import { PlayerButtons, usePlayerLists, usePlayerContext } from './McPlayers';
import { PlayerHead } from '@hostwerk/kit';
import { useSlot } from '@hostwerk/kit';
import { ErrorBoundary } from '@hostwerk/kit';
import { ExtSections, useSectionRole } from '@hostwerk/kit';
import { pl, tr } from '@hostwerk/kit';
import { TpsCard, WorldUploadCard, PregenCard } from './McTools';

/* ------------------------------------------------------------------ Minecraft-Farbcodes */
const MC = { 0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA', 8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF' };
export function McText({ text }) {
  const parts = [];
  let style = { color: '#AAAAAA' };
  let buf = '';
  const s = String(text || '').replace(/\\u00a7/gi, '§').replace(/\\n/g, '\n');
  const flush = () => { if (buf) { parts.push(<span key={parts.length} style={{ ...style }}>{buf}</span>); buf = ''; } };
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
    i.onerror = () => toast.error('Das Bild ließ sich nicht öffnen.');
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
    <Modal title="Server-Symbol zuschneiden" subtitle="Ziehen verschiebt, Mausrad oder Regler vergrößert. Minecraft zeigt das Symbol mit 64×64 Pixeln." onClose={onCancel}
      footer={<><Btn onClick={onCancel}>Abbrechen</Btn><Btn className="primary" icon={Save} busy={busy} disabled={!img} onClick={save}>Als Symbol speichern</Btn></>}>
      {!img ? <Loading /> : (
        <div className="mc-crop">
          <div className="mc-crop-stage">
            <canvas ref={view} width={CROP_VIEW} height={CROP_VIEW} className="mc-crop-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
              tabIndex={0} aria-label="Ausschnitt – mit Pfeiltasten verschieben, Plus und Minus vergrößern"
              onKeyDown={(e) => { const st = e.shiftKey ? 16 : 4; const k = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key]; if (k) { e.preventDefault(); nudge(...k); } else if (e.key === '+' || e.key === '=') zoomAt(zoom * 1.1); else if (e.key === '-') zoomAt(zoom / 1.1); }} />
          </div>
          <div className="stack mc-crop-side">
            <div className="label">Vorschau</div>
            <div className="mc-serverlist mini"><div className="mc-icon"><canvas ref={small} width={64} height={64} /></div><div className="tiny muted">64×64</div></div>
            <Field label={`Größe: ${Math.round(zoom * 100)} %`}>
              <input className="range" type="range" min={Math.round(fitZoom * 50)} max={800} value={Math.round(zoom * 100)} onChange={(e) => zoomAt(Number(e.target.value) / 100)} />
            </Field>
            <div className="row-tight" style={{ flexWrap: 'wrap' }}>
              <Btn className="xs" onClick={() => { setZoom(1); setOff({ x: 0, y: 0 }); }}>Füllen</Btn>
              <Btn className="xs" onClick={() => { setZoom(fitZoom); setOff({ x: 0, y: 0 }); }}>Ganz zeigen</Btn>
              <Btn className="xs ghost" onClick={() => setOff({ x: 0, y: 0 })}>Zentrieren</Btn>
            </div>
            <div className="row-tight small"><Switch checked={!smooth} onChange={(v) => setSmooth(!v)} label="Pixel-Art (scharfe Kanten)" /><span>Pixel-Art (scharfe Kanten)</span></div>
            <div className="tiny muted">{tr(`Bild: ${img.width}×${img.height} Pixel`)}</div>
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
  const liveNote = (r) => (!r.running ? '' : r.live ? ' – sofort sichtbar' : r.bridgeNeeded ? ' – sichtbar nach Neustart (sofort mit HostwerkBridge)' : ' – sichtbar nach Neustart');
  const saveMotd = async () => {
    setSavingMotd(true);
    try { const r = await put(`/mc/servers/${s.id}/motd`, { motd: motd.replace(/§/g, '\\u00a7') }); props.setData({ ...props.data, motd: r.motd }); toast.success(tr('MOTD gespeichert') + tr(liveNote(r))); } catch (e) { toast.error(e.message); }
    setSavingMotd(false);
  };
  const saveIcon = async (png) => {
    try { const r = await put(`/mc/servers/${s.id}/icon`, { png }); setIconV(Date.now()); setHasIcon(true); setCrop(null); toast.success(tr('Server-Symbol gespeichert') + tr(liveNote({ ...r, running }))); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="card">
      <div className="card-head"><Palette size={16} /><h3>{iconOnly ? tr('Server-Symbol') : tr('So sehen Spieler deinen Server')}</h3></div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="mc-serverlist">
          <DropTarget onFile={setCrop}>
            <div className="mc-icon" role="button" tabIndex={0} onClick={() => file.current && file.current.click()} onKeyDown={(e) => { if (e.key === 'Enter') file.current && file.current.click(); }} title="Symbol ändern – Bild wählen oder hierher ziehen, danach Ausschnitt festlegen">
              {hasIcon ? <img src={`/api/mc/servers/${s.id}/icon?v=${iconV}`} alt="" onError={() => setHasIcon(false)} /> : <ImageIcon size={26} />}
            </div>
          </DropTarget>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="mc-name">{s.name}</div>
            <div className="mc-motd-preview"><McText text={shown || 'A Minecraft Server'} /></div>
          </div>
          <div className="mc-count">{mcCount(s)}/{s.proc.extra.maxPlayersLive || s.maxPlayers || 20}</div>
        </div>
        {!iconOnly && live && edited && <div className="small muted">Vorschau zeigt deine Änderung – so sehen Spieler sie nach dem Speichern.</div>}
        {!iconOnly && live && !edited && overridden && <InfoTip>Diese MOTD kommt gerade live vom Server – ein Plugin überschreibt die Beschreibung aus server.properties. Änderungen hier wirken nur, wenn das Plugin sie nicht ersetzt.</InfoTip>}
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) setCrop(e.target.files[0]); e.target.value = ''; }} />
        {!iconOnly && <>
        <Field label="Beschreibung (MOTD)" hint="Zweite Zeile mit \n. Farben per Klick einfügen.">
          <input ref={input} className="input mono" value={motd} onChange={(e) => setMotd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && edited) saveMotd(); }} />
        </Field>
        <div className="mc-colors">
          {Object.entries(MC).map(([k, c]) => <button key={k} title={`§${k}`} style={{ background: c }} onClick={() => insert('§' + k)} />)}
          <button className="fmt" title="Fett" onClick={() => insert('§l')}><b>F</b></button>
          <button className="fmt" title="Kursiv" onClick={() => insert('§o')}><i>K</i></button>
          <button className="fmt" title="Zurücksetzen" onClick={() => insert('§r')}>↺</button>
        </div>
        </>}
        <div className="row">
          {!iconOnly && <Btn className="primary sm" icon={Save} busy={savingMotd} disabled={!edited} onClick={saveMotd}>Speichern</Btn>}
          <Btn className="sm" icon={ImageIcon} onClick={() => file.current && file.current.click()}>Symbol wählen …</Btn>
          {hasIcon && <Btn className="sm ghost" icon={Trash2} onClick={async () => { try { const r = await del(`/mc/servers/${s.id}/icon`); setHasIcon(false); if (running) toast(r.live ? tr('Symbol entfernt – sofort sichtbar') : tr('Symbol entfernt – sichtbar nach Neustart')); } catch (e) { toast.error(e.message); } }}>Symbol entfernen</Btn>}
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
const RESTART_STEPS = [[0, 'Sofort'], [10, 'In 10 Sekunden'], [30, 'In 30 Sekunden'], [60, 'In 1 Minute'], [300, 'In 5 Minuten']];
const MODES = [['survival', 'Überleben'], ['creative', 'Kreativ'], ['adventure', 'Abenteuer'], ['spectator', 'Zuschauer']];
const DIFFS = [['peaceful', 'Friedlich'], ['easy', 'Einfach'], ['normal', 'Normal'], ['hard', 'Schwer']];

/** Knopf der Schnellaktionen (more = öffnet eine Auswahl). */
function Q({ icon: I, label, onClick, title, more, danger, off }) {
  return <button type="button" className={`mc-qbtn ${danger ? 'danger' : ''}`} disabled={off} title={title ? tr(title) : undefined} onClick={onClick}><I />{label}{more && <ChevronDown className="mc-qmore" />}</button>;
}

/** Häufige Befehle als Knöpfe, nach Zweck gruppiert. Knöpfe mit ▾ öffnen eine kleine Auswahl. */
function QuickActions({ s, ready, cmd }) {
  const run = (c, ok) => { cmd(c); if (ok) toast.success(tr(ok)); };
  const menuAt = (e, items) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, items); };
  const paper = ['paper', 'purpur', 'folia', 'leaf', 'pufferfish'].includes(s.type);
  return (
    <div className="card">
      <div className="card-head"><Zap size={16} /><h3>Schnellaktionen</h3>{!ready && <span className="tiny muted">Welt lädt …</span>}</div>
      <div className="card-body stack" style={{ gap: 10 }}>
        <div className="mc-qgroup"><div className="label">Zeit &amp; Wetter</div>
          <div className="mc-quick">
            <Q off={!ready} icon={Sun} label="Tag" onClick={() => run('time set day')} />
            <Q off={!ready} icon={Moon} label="Nacht" onClick={() => run('time set night')} />
            <Q off={!ready} icon={CloudSun} label="Sonne" onClick={() => run('weather clear')} />
            <Q off={!ready} icon={CloudRain} label="Regen" onClick={() => run('weather rain')} />
            <Q off={!ready} icon={CloudLightning} label="Gewitter" onClick={() => run('weather thunder')} />
          </div>
        </div>
        <div className="mc-qgroup"><div className="label">Spieler</div>
          <div className="mc-quick">
            <Q off={!ready} icon={Megaphone} label="Ansage" onClick={async () => { const t = await promptDialog({ title: 'Nachricht an alle', label: 'Text', placeholder: 'Server startet gleich neu!' }); if (t) cmd(`say ${t}`); }} />
            <Q off={!ready} icon={HeartPulse} label="Alle heilen" title="Alle Spieler heilen und satt machen" onClick={() => { cmd('effect give @a minecraft:instant_health 1 10'); run('effect give @a minecraft:saturation 1 10', 'Alle Spieler geheilt'); }} />
            <Q off={!ready} icon={Gamepad2} label="Spielmodus" more title="Spielmodus für alle Online-Spieler" onClick={(e) => menuAt(e, MODES.map(([id, l]) => ({ label: tr(`Alle: ${l}`), onClick: () => run(`gamemode ${id} @a`, `Alle Spieler: ${l}`) })))} />
            <Q off={!ready} icon={UserX} label="Alle kicken" danger title="Alle Spieler trennen (z. B. für Wartung)" onClick={async () => { const r = await promptDialog({ title: 'Alle Spieler kicken?', label: 'Grund (optional)', value: tr('Wartung – gleich wieder da!'), confirm: 'Alle kicken' }); if (r !== null) run(`kick @a ${r}`.trim(), 'Alle Spieler gekickt'); }} />
          </div>
        </div>
        <div className="mc-qgroup"><div className="label">Welt</div>
          <div className="mc-quick">
            <Q off={!ready} icon={SlidersHorizontal} label="Schwierigkeit" more onClick={(e) => menuAt(e, DIFFS.map(([id, l]) => ({ label: tr(l), onClick: () => run(`difficulty ${id}`, `Schwierigkeit: ${l}`) })))} />
            <Q off={!ready} icon={Eraser} label="Items aufräumen" title="Alle herumliegenden Gegenstände entfernen – hilft bei Ruckeln" onClick={async () => { if (await confirmDialog({ title: 'Herumliegende Gegenstände entfernen?', text: 'Alle Items auf dem Boden in allen geladenen Chunks verschwinden. Spieler-Inventare bleiben unberührt.', confirm: 'Aufräumen' })) run('kill @e[type=minecraft:item]', 'Gegenstände entfernt'); }} />
            <Q off={!ready} icon={Package} label="Datapacks neu laden" title="Datapacks, Rezepte und Funktionen neu einlesen (ohne Neustart)" onClick={() => run('minecraft:reload', 'Datapacks werden neu geladen')} />
            {paper && <Q off={!ready} icon={Gauge} label="TPS messen" onClick={() => cmd('tps')} />}
          </div>
        </div>
        <div className="mc-qgroup"><div className="label">Server</div>
          <div className="mc-quick">
            <Q off={!ready} icon={Save} label="Speichern" onClick={() => run('save-all', 'Welt wird gespeichert')} />
            <Q off={!ready} icon={Archive} label="Sicherung" onClick={async () => { try { await post(`/mc/servers/${s.id}/backups`, { label: 'schnell' }); toast(tr('Sicherung läuft …')); } catch (e) { toast.error(e.message); } }} />
            <Q off={!ready} icon={RotateCw} label="Neustart" more title="Neu starten – auf Wunsch mit Vorwarnung im Chat" onClick={(e) => menuAt(e, RESTART_STEPS.map(([sec, l]) => ({ label: tr(l), hint: sec ? tr('mit Ansage') : '', onClick: async () => { try { await post(`/mc/servers/${s.id}/restart-warn`, { seconds: sec }); toast(sec ? tr(`Neustart in ${sec} s – Spieler werden gewarnt`) : tr('Server startet neu …')); } catch (er) { toast.error(er.message); } } })))} />
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
        <div className="card stat"><div className="k"><Users />Spieler</div><div className="v">{players.length}<span className="of"> / {s.maxPlayers || 20}</span></div><div className="s">{running ? (ready ? 'online' : 'Welt lädt …') : 'Server gestoppt'}</div></div>
        <div className="card stat"><div className="k"><Gauge />Leistung</div><div className="v" style={{ color: tps == null ? undefined : tps >= 19.5 ? 'var(--ok)' : tps >= 17 ? 'var(--warn)' : 'var(--err)' }}>{tps != null ? tps : '–'}<span className="of"> TPS</span></div><div className="s">{tps != null ? '20 = flüssig' : ['paper', 'purpur'].includes(s.type) ? <button className="link-btn" disabled={!ready} onClick={() => cmd('tps')}>messen</button> : 'nur bei Paper/Purpur'}</div></div>
        <div className="card stat"><div className="k"><HardDrive />Welten</div><div className="v">{worldSize != null ? fmtBytes(worldSize) : '…'}</div><div className="s">{worlds.data ? (() => { const n = worlds.data.worlds.reduce((k, w) => k + Math.max(1, (w.dims || []).length), 0); return n > worlds.data.worlds.length ? `${pl(worlds.data.worlds.length, 'Welt', 'Welten')} · ${pl(n, 'Dimension', 'Dimensionen')}` : pl(worlds.data.worlds.length, 'Welt', 'Welten'); })() : ''}</div></div>
        <div className="card stat"><div className="k"><ShieldCheck />Prüfung</div><div className="v text" style={{ marginTop: 8 }}>{test.data ? (test.data.ok ? <span style={{ color: 'var(--ok-text)' }}>bestanden</span> : <span style={{ color: 'var(--err-text)' }}>Probleme</span>) : <span className="muted">–</span>}</div><div className="s">{test.data ? fmtDate(test.data.at) : <a href={`#/mc/${s.id}/automation`}>jetzt prüfen →</a>}</div></div>
      </div>
      <div className="grid grid-2 mc-fit-grid">
        <div className="stack mc-col">
          <div className="card">
            <div className="card-head"><Gauge size={16} /><h3>Zustand</h3><div className="right"><StatusPill state={s.proc.state} label={running && !ready ? 'Lädt Welt …' : undefined} /></div></div>
            <div className="card-body stack" style={{ gap: 12 }}>
              <HealthSummary s={s} />
              <div className="stack" style={{ gap: 6 }}>
                <div className="label">Verbinden</div>
                {[s.address.local, ...s.address.lan].map((a) => <div key={a} className="row-tight"><code className="grow ellipsis">{a}</code><button className="btn ghost xs icon" title="Kopieren" onClick={() => { navigator.clipboard.writeText(a); toast.success('Adresse kopiert'); }}><Copy /></button></div>)}
                {connectSlots.map((c) => <ErrorBoundary key={c.key} silent where={c.key}><c.Component s={s} /></ErrorBoundary>)}
              </div>
            </div>
          </div>
          {running && <QuickActions s={s} ready={ready} cmd={cmd} />}
          <TpsCard s={s} />
          {errors.length > 0 && (
            <div className="card">
              <div className="card-head"><AlertTriangle size={16} style={{ color: 'var(--warn-text)' }} /><h3>Letzte Fehler im Protokoll</h3><div className="right"><a className="btn ghost sm" href={`#/mc/${s.id}/console`}><ScrollText />Konsole</a></div></div>
              <div className="card-body stack" style={{ gap: 4 }}>{errors.map((e, i) => <div key={i} className="mono tiny ellipsis" style={{ color: 'var(--err-text)' }} title={e.l}>{e.l.replace(/\x1b\[[0-9;]*m/g, '')}</div>)}</div>
            </div>
          )}
        </div>
        <div className="stack mc-col">
          <div className="card">
            <div className="card-head"><Users size={16} /><h3>Online ({players.length})</h3><div className="right"><a className="btn ghost sm" href={`#/mc/${s.id}/players`}>Spielerverwaltung</a></div></div>
            {players.length === 0 ? <div className="card-body small muted">{running ? 'Niemand online.' : 'Server ist gestoppt.'}</div> : (
              <div className="mc-players">
                {players.map((p) => (
                  <div key={p} className="mc-player" onContextMenu={ctxFor(p)} title="Rechtsklick: weitere Aktionen">
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
  const LABEL = { keepInventory: 'Inventar behalten beim Tod', doDaylightCycle: 'Tag-Nacht-Wechsel', doWeatherCycle: 'Wetterwechsel', doMobSpawning: 'Kreaturen spawnen', mobGriefing: 'Kreaturen zerstören Blöcke', doFireTick: 'Feuer breitet sich aus', pvp: 'PvP', naturalRegeneration: 'Natürliche Heilung', doInsomnia: 'Phantome', doImmediateRespawn: 'Sofort wiederbeleben', announceAdvancements: 'Fortschritte ankündigen', showDeathMessages: 'Todesnachrichten', doMobLoot: 'Kreaturen droppen Beute', doTileDrops: 'Blöcke droppen Items', fallDamage: 'Fallschaden', fireDamage: 'Feuerschaden', drowningDamage: 'Ertrinken', freezeDamage: 'Erfrieren', playersSleepingPercentage: 'Schlafende Spieler für Nacht (%)', randomTickSpeed: 'Wachstumsgeschwindigkeit', spawnRadius: 'Spawn-Radius', maxEntityCramming: 'Max. Kreaturen auf einem Block', doTraderSpawning: 'Händler spawnen', doPatrolSpawning: 'Plünderer-Patrouillen', disableRaids: 'Überfälle aus', commandBlockOutput: 'Befehlsblock-Ausgabe', sendCommandFeedback: 'Befehls-Rückmeldung', reducedDebugInfo: 'Weniger Debug-Infos (F3)', spectatorsGenerateChunks: 'Zuschauer laden Chunks', forgiveDeadPlayers: 'Neutrale Mobs vergeben', universalAnger: 'Universeller Zorn', tntExplodes: 'TNT explodiert', projectilesCanBreakBlocks: 'Geschosse zerstören Blöcke' };
  // Minecraft 26: neue, englische Namen (minecraft:keep_inventory) – Erklärungen dafür und für die alten Namen
  const LABEL26 = { keep_inventory: 'Inventar behalten beim Tod', advance_time: 'Tag-Nacht-Wechsel', advance_weather: 'Wetterwechsel', spawn_mobs: 'Kreaturen spawnen', spawn_monsters: 'Monster spawnen', mob_griefing: 'Kreaturen zerstören Blöcke', fire_spread_radius_around_player: 'Feuer breitet sich aus (Radius um Spieler)', pvp: 'PvP', natural_health_regeneration: 'Natürliche Heilung', spawn_phantoms: 'Phantome', immediate_respawn: 'Sofort wiederbeleben', show_advancement_messages: 'Fortschritte ankündigen', show_death_messages: 'Todesnachrichten', mob_drops: 'Kreaturen droppen Beute', block_drops: 'Blöcke droppen Items', entity_drops: 'Objekte droppen (Loren, Rahmen …)', fall_damage: 'Fallschaden', fire_damage: 'Feuerschaden', drowning_damage: 'Ertrinken', freeze_damage: 'Erfrieren', players_sleeping_percentage: 'Schlafende Spieler für Nacht (%)', random_tick_speed: 'Wachstumsgeschwindigkeit', respawn_radius: 'Spawn-Radius', max_entity_cramming: 'Max. Kreaturen auf einem Block', spawn_wandering_traders: 'Händler spawnen', spawn_patrols: 'Plünderer-Patrouillen', raids: 'Überfälle', command_block_output: 'Befehlsblock-Ausgabe', send_command_feedback: 'Befehls-Rückmeldung', reduced_debug_info: 'Weniger Debug-Infos (F3)', spectators_generate_chunks: 'Zuschauer laden Chunks', forgive_dead_players: 'Neutrale Mobs vergeben', universal_anger: 'Universeller Zorn', tnt_explodes: 'TNT explodiert', projectiles_can_break_blocks: 'Geschosse zerstören Blöcke', spawn_wardens: 'Wärter spawnen', command_blocks_work: 'Befehlsblöcke funktionieren', log_admin_commands: 'Admin-Befehle protokollieren', limited_crafting: 'Nur freigeschaltete Rezepte', elytra_movement_check: 'Elytra-Bewegungsprüfung', player_movement_check: 'Bewegungsprüfung (Anti-Cheat)', global_sound_events: 'Globale Klänge (Drache, Wither)', lava_source_conversion: 'Lava wird zur Quelle', water_source_conversion: 'Wasser wird zur Quelle', spread_vines: 'Ranken wachsen', allow_entering_nether_using_portals: 'Netherportale nutzbar', players_nether_portal_default_delay: 'Portal-Wartezeit (Ticks)', players_nether_portal_creative_delay: 'Portal-Wartezeit Kreativ (Ticks)', tnt_explosion_drop_decay: 'TNT: Drops gehen teils verloren', block_explosion_drop_decay: 'Block-Explosion: Drops gehen teils verloren', mob_explosion_drop_decay: 'Creeper: Drops gehen teils verloren', ender_pearls_vanish_on_death: 'Enderperlen verschwinden beim Tod', spawner_blocks_work: 'Spawner funktionieren', locator_bar: 'Spieler-Kompassleiste', max_command_sequence_length: 'Max. Befehlskettenlänge', max_command_forks: 'Max. Befehls-Verzweigungen', max_block_modifications: 'Max. Blockänderungen je Befehl', max_snow_accumulation_height: 'Max. Schneehöhe', disable_elytra_movement_check: 'Elytra-Prüfung aus', disable_player_movement_check: 'Bewegungsprüfung aus', do_vines_spread: 'Ranken wachsen', do_warden_spawning: 'Wärter spawnen' };
  const GROUP26 = (n) => (/damage|regeneration|respawn|keep_inventory|sleeping|phantom|ender_pearl|pvp|forgive|anger|locator/.test(n) ? 'Spieler' : /spawn|mob|raid|patrol|trader|warden|griefing|cramming/.test(n) ? 'Kreaturen' : /drop|tnt|explo|fire|vine|source|tick|snow|block|projectile|nether|portal|time|weather/.test(n) ? 'Welt' : 'Technik');
  const labelOf = (r) => { const short = r.name.replace(/^minecraft:/, ''); return LABEL[r.name] || LABEL26[short] || short.replace(/_/g, ' ').replace(/^do /, '').replace(/^\w/, (c) => c.toUpperCase()); };
  const setRule = async (r, v) => {
    try {
      const res = await put(`/mc/servers/${s.id}/gamerules`, { name: r.name, value: v });
      setRules({ ...rules, rules: rules.rules.map((x) => (x.name === r.name ? { ...x, value: String(v) } : x)) });
      toast.success(res.live ? `${labelOf(r)} gesetzt` : `${labelOf(r)} in der Weltdatei gesetzt – gilt beim nächsten Start`);
    } catch (e) { toast.error(e.message); }
  };
  const list = rules && rules.rules ? rules.rules.filter((r) => !rq || `${r.name} ${labelOf(r)}`.toLowerCase().includes(rq.toLowerCase())) : [];
  const groups = [...new Set(list.map((r) => GROUP26(r.name.replace(/^minecraft:/, ''))))].sort((a, b) => ['Spieler', 'Kreaturen', 'Welt', 'Technik'].indexOf(a) - ['Spieler', 'Kreaturen', 'Welt', 'Technik'].indexOf(b));
  const stopped = s.proc.state !== 'running';
  const dimInfo = useDimInfo(s.id); // Symbole aus dem Katalog bzw. aus den echten Eigenschaften der Dimension
  const reset = async (x, d) => {
    const what = d ? `${dimLabel(d.id, dimInfo(d.id))} (${x.name})` : x.name;
    const text = d
      ? (d.id === 'minecraft:overworld' ? 'Das Gelände der Oberwelt wird gelöscht und beim nächsten Start neu erzeugt. Spielerdaten, Seed und Spielregeln bleiben. Vorher legt Hostwerk eine Sicherung an.' : 'Nur diese Dimension wird gelöscht und beim nächsten Start neu erzeugt – die anderen bleiben, wie sie sind. Vorher legt Hostwerk eine Sicherung an.')
      : 'Die ganze Welt (alle Dimensionen darin) wird gelöscht und beim nächsten Start neu erzeugt. Vorher legt Hostwerk eine Sicherung an.';
    if (!(await confirmDialog({ title: tr(`„${what}“ zurücksetzen?`), text, confirm: 'Zurücksetzen', danger: true, typeToConfirm: x.main && (!d || d.id === 'minecraft:overworld') ? x.name : null }))) return;
    try { const r = await post(`/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/reset`, d ? { dim: d.id } : {}); await waitJob(r.job); toast.success(tr(`${what} zurückgesetzt`)); } catch (e) { toast.error(e.message); }
    w.reload();
  };
  // Welten ohne erkannte Dimension (nur level.dat): eine Zeile nach Art des Ordners
  const dimsOf = (x) => ((x.dims || []).length ? x.dims : [{ id: { nether: 'minecraft:the_nether', end: 'minecraft:the_end' }[x.kind] || 'minecraft:overworld', path: null, size: x.size, guess: true }]);
  return (
    <div className="grid grid-2 mc-fit-grid">
      <div className="card mc-scroll">
        <div className="card-head"><Globe2 size={16} /><h3>Welten</h3>{w.data && w.data.seed && <span className="badge" title="Seed">Seed {w.data.seed}</span>}<div className="right row-tight">{!s.proxy && <><Btn className="ghost sm" icon={Upload} onClick={() => setDlg('upload')}>Welt hochladen …</Btn><Btn className="ghost sm" icon={Zap} onClick={() => setDlg('pregen')}>Vorgenerieren …</Btn></>}<button className="btn ghost sm icon" title="Neu laden" aria-label="Neu laden" onClick={w.reload}><RefreshCw /></button></div></div>
        {!stopped && w.data && w.data.worlds.length > 0 && <div className="info-line mc-scroll-fixed"><Info size={13} /><span className="grow">Welten zurücksetzen geht nur bei gestopptem Server.</span><SvcShortcut base={`/mc/servers/${s.id}`} state={s.proc.state} want="stopped" /></div>}
        <div className="mc-scroll-body">
          {!w.data ? <Loading /> : w.data.worlds.length === 0 ? <TileEmpty text="Noch keine Welt – sie wird beim ersten Start erzeugt." /> : w.data.worlds.map((x) => (
            <div key={x.name} className="mc-world">
              <div className="mc-world-head">
                <FolderOpen size={15} className="muted" />
                <b className="ellipsis">{x.name}</b>{x.main && <span className="badge accent">Hauptwelt</span>}
                <span className="tiny muted">{fmtBytes(x.size)}{(x.dims || []).length > 1 ? ` · ${pl(x.dims.length, 'Dimension', 'Dimensionen')}` : ''}</span>
                <span className="grow" />
                <a className="btn ghost xs" href={`/api/mc/servers/${s.id}/worlds/${encodeURIComponent(x.name)}/download`} title="Ganze Welt als ZIP herunterladen"><Download />ZIP</a>
                <Btn className="ghost xs" icon={RotateCcw} disabled={!stopped} title={!stopped ? 'Server zuerst stoppen' : 'Ganze Welt neu erzeugen'} onClick={() => reset(x, null)}>Alles zurücksetzen</Btn>
              </div>
              {dimsOf(x).map((d) => (
                <div key={d.id} className="list-item mc-dim">
                  <McDimIcon id={d.id} info={dimInfo(d.id)} size={32} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="bold">{dimLabel(d.id, dimInfo(d.id))}</div>
                    <div className="tiny muted"><span className="mono">{dimKey(d.id)}</span>{d.size != null ? ` · ${fmtBytes(d.size)}` : ''}{!d.id.startsWith('minecraft:') ? ` · ${tr('aus Datenpaket oder Mod')}` : ''}</div>
                  </div>
                  {d.path && !d.guess && (x.dims || []).length > 1 && <Btn className="ghost xs" icon={RotateCcw} disabled={!stopped} title={!stopped ? 'Server zuerst stoppen' : 'Nur diese Dimension neu erzeugen'} onClick={() => reset(x, d)}>Zurücksetzen</Btn>}
                </div>
              ))}
            </div>
          ))}
          <div className="card-body tiny muted">Tipp: Nether und Ende einzeln zurückzusetzen ist ein beliebter Weg, neue Ressourcen zu bekommen – die Oberwelt bleibt erhalten.</div>
        </div>
      </div>
      <div className="card mc-scroll">
        <div className="card-head"><ShieldCheck size={16} /><h3>Spielregeln</h3>{rules && rules.rules && rules.rules.length > 0 && <span className="badge">{rules.live ? 'live' : rules.running ? 'aus der Weltdatei' : 'Server gestoppt'}</span>}
          <div className="right row-tight"><div className="input-icon" style={{ width: 170 }}><Search /><input className="input sm" placeholder="Regel suchen …" value={rq} onChange={(e) => setRq(e.target.value)} /></div><button className="btn ghost sm icon" title="Neu laden" onClick={loadRules}><RefreshCw /></button></div>
        </div>
        {!rules ? <Loading /> : !rules.rules.length ? <div className="card-body small muted">{running ? 'Keine Regeln gefunden – die Welt ist noch nicht gespeichert. Nach dem ersten „save-all“ erscheinen sie hier.' : 'Noch keine Welt – nach dem ersten Start lassen sich die Regeln hier ändern (auch bei gestopptem Server).'}</div> : (
          <div className="card-body mc-rules mc-scroll-body" style={{ paddingTop: 4 }}>
            {!rules.running && <div className="tiny muted" style={{ marginBottom: 6 }}>Der Server ist aus – Änderungen landen direkt in der Weltdatei und gelten beim nächsten Start.</div>}
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
      {dlg === 'upload' && <Modal title="Welt hochladen" subtitle="Eine Einzelspieler-Welt (Ordner aus .minecraft/saves) oder eine gezippte Welt übernehmen. Vorher sichert Hostwerk den ganzen Server." onClose={() => setDlg(null)} footer={<Btn onClick={() => setDlg(null)}>Schließen</Btn>}><WorldUploadCard s={s} bare onDone={() => { w.reload(); setDlg(null); }} /></Modal>}
      {dlg === 'pregen' && <Modal title="Welt vorgenerieren" subtitle="Mit Chunky erzeugt der Server das Gelände vorab – später ruckelt es beim Erkunden nicht mehr." onClose={() => setDlg(null)} footer={<Btn onClick={() => setDlg(null)}>Schließen</Btn>}><PregenCard s={s} bare /></Modal>}
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
  if (!d.supported) return <div className="card"><Empty icon={MapIcon} title="Karte braucht Plugins" text="Vanilla-Server unterstützen keine Plugins. Wechsle unter „Version“ auf Paper oder Purpur – deine Welt bleibt erhalten." /></div>;
  const setup = async () => { setBusy(true); try { const r = await post(`/mc/servers/${s.id}/map`); const j = await waitJob(r.job); toast.success(j.result.needsRestart ? 'BlueMap installiert – Server jetzt neu starten' : 'BlueMap installiert – Server starten'); } catch (e) { toast.error(e.message); } setBusy(false); st.reload(); };
  if (!d.installed) {
    return (
      <div className="card"><Empty icon={MapIcon} title="Live-Karte deiner Welt" text="Hostwerk richtet das Plugin BlueMap ein: eine 3D-Karte im Browser, auf der du Spieler, Gebäude und Gelände siehst. Beim ersten Start rendert BlueMap die Welt – das kann einige Minuten dauern.">
        <Btn className="grad" icon={MapIcon} busy={busy} onClick={setup}>Karte einrichten</Btn>
      </Empty></div>
    );
  }
  return (
    <div className="stack">
      <div className="row">
        <span className="badge ok">BlueMap · Port {d.port}</span>
        {!d.running ? <span className="small muted">Server starten, um die Karte zu sehen.</span> : reach === false ? <span className="small muted">Karte startet noch … (nach dem Neustart rendert BlueMap im Hintergrund)</span> : null}
        <div className="right row-tight">
          <Btn className="sm" icon={ExternalLink} disabled={!d.running} onClick={() => openExternal(d.url)}>Im Browser öffnen</Btn>
          <Btn className="sm ghost" icon={RefreshCw} onClick={setup}>Einrichtung prüfen</Btn>
        </div>
      </div>
      {d.running && reach ? <iframe className="mc-map" title="Karte" src={d.url} /> : (
        <div className="card"><Empty icon={MapIcon} title={d.running ? 'Karte wird vorbereitet …' : 'Server ist gestoppt'} text={d.running ? 'Falls BlueMap gerade erst installiert wurde: Server einmal neu starten.' : ''} /></div>
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
    { label: 'Nächtlicher Neustart', name: `Neustart ${s.name}`, action: { type: 'mc-restart', target: s.id, warnSeconds: 60 }, schedule: { mode: 'daily', time: '04:00' } },
    { label: 'Tägliche Sicherung', name: `Sicherung ${s.name}`, action: { type: 'mc-backup', target: s.id }, schedule: { mode: 'daily', time: '03:30' } },
    { label: 'Regelmäßige Ansage', name: `Ansage ${s.name}`, action: { type: 'mc-command', target: s.id, command: 'say §aDanke fürs Spielen auf unserem Server!' }, schedule: { mode: 'every', minutes: 60 } },
  ];
  const [preset, setPreset] = useState(null);
  return (
    <div className="grid grid-2">
      <div className="stack">
        <div className="card">
          <div className="card-head"><CalendarClock size={16} /><h3>Vorlagen</h3></div>
          <div className="card-body row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {presets.map((p) => <Btn key={p.label} className="sm" onClick={() => setPreset({ ...p, lockTarget: true, key: Date.now() })}>{p.label}</Btn>)}
          </div>
        </div>
        <TaskList key={preset ? preset.key : 0} compact filter={(t) => t.action.target === s.id} preset={preset || { action: { type: 'mc-restart', target: s.id, warnSeconds: 60 }, schedule: { mode: 'daily', time: '04:00' } }} />
        {preset && <PresetOpener preset={preset} onDone={() => setPreset(null)} />}
      </div>
      <div className="card">
        <div className="card-head"><ShieldCheck size={16} /><h3>Server-Prüfung</h3><div className="right"><Btn className="sm primary" icon={Play} busy={busy} onClick={run}>Jetzt prüfen</Btn></div></div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="small muted">Startet den Server (falls nötig), wartet bis er bereit ist und prüft Plugins, Fehler im Protokoll, Leistung, Arbeitsspeicher und Erreichbarkeit. War der Server aus, wird er danach wieder gestoppt. Ideal nach Updates oder neuen Plugins.</div>
          {!r ? <Empty icon={ShieldCheck} title="Noch nicht geprüft" /> : (
            <>
              <div className={`test-summary ${r.ok ? 'ok' : 'fail'}`}>{r.ok ? <CheckCircle2 /> : <XCircle />}<div><b>{r.ok ? (r.warnings ? `Bestanden mit ${pl(r.warnings, 'Hinweis', 'Hinweisen')}` : 'Alles in Ordnung') : 'Es gibt Probleme'}</b><div className="small">{fmtDate(r.at)} · {Math.round(r.ms / 1000)} s</div></div></div>
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
