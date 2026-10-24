import { useEffect, useState } from 'react';
import { Gauge, Upload, FolderOpen, Globe2, Package, Search, Download, Trash2, Play, Pause, Square, History, Bug, Copy, Users, Save, SlidersHorizontal, Network as NetIcon, CalendarDays, Sparkles, ExternalLink, FileText } from 'lucide-react';
import { get, post, put, del, api, useApi, waitJob, fmtBytes, fmtDate, fmtNumber, pickFolder, isElectron, openExternal } from '@hostwerk/api';
import { Btn, Field, Switch, SettingRow, Seg, Empty, Loading, Callout, DropZone, Modal, toast, confirmDialog, InfoTip, Sparkline, TileEmpty } from '@hostwerk/ui';
import { PlayerHead, LazyImg } from '@hostwerk/kit';
import { AiHint } from '@hostwerk/kit';
import { pl } from '@hostwerk/kit';

const tpsColor = (t) => (t == null ? undefined : t >= 19.5 ? 'var(--ok)' : t >= 17 ? 'var(--warn)' : 'var(--err)');

/* ------------------------------------------------------------------ TPS-Verlauf (Übersicht) */
export function TpsCard({ s }) {
  const h = useApi(`/mc/servers/${s.id}/tps`, [s.proc.extra.tps]);
  const list = h.data || [];
  if (s.proc.state !== 'running' || list.length < 2) return null;
  const vals = list.map((x) => x.tps);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const last = list[list.length - 1];
  return (
    <div className="card">
      <div className="card-head"><Gauge size={16} /><h3>Leistung im Verlauf</h3><InfoTip>Hostwerk misst alle 30 Sekunden die Ticks pro Sekunde (20 = flüssig) – still, ohne Zeilen in der Konsole.</InfoTip></div>
      <div className="card-body stack" style={{ gap: 8 }}>
        <Sparkline data={vals} width={420} height={48} max={20} color={tpsColor(min)} />
        <div className="row small muted mc-tps-legend">
          <span>{`Jetzt ${last.tps} TPS`}{last.mspt != null ? ` · ${last.mspt} ms je Tick` : ''}</span>
          <span>{`Schnitt ${avg.toFixed(1)}`}</span>
          <span style={{ color: tpsColor(min) }}>{`Tiefster Wert ${min}`}</span>
          <span>{`seit ${fmtDate(list[0].t)}`}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Welt hochladen */
export function WorldUploadCard({ s, onDone, bare = false }) {
  const [mode, setMode] = useState('new');
  const [makeMain, setMakeMain] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = s.proc.state === 'running';
  const needsStop = mode === 'replace' || makeMain;
  const finish = async (r) => { const j = await waitJob(r.job); toast.success(j.result && j.result.main ? `Welt „${j.result.name}“ ist jetzt die Hauptwelt` : `Welt „${j.result && j.result.name}“ übernommen`); onDone && onDone(); };
  const confirmReplace = async () => mode !== 'replace' || confirmDialog({ title: 'Hauptwelt ersetzen?', text: 'Die bisherige Welt samt Nether und End wird entfernt. Vorher legt Hostwerk eine Sicherung des ganzen Servers an.', confirm: 'Ersetzen', danger: true });
  const upload = async (files) => {
    if (!(await confirmReplace())) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('file', files[0]); fd.append('mode', mode); fd.append('makeMain', String(makeMain)); fd.append('name', files[0].name.replace(/\.zip$/i, ''));
      await finish(await api('POST', `/mc/servers/${s.id}/worlds/upload`, fd));
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const folder = async () => {
    const dir = await pickFolder('Welt-Ordner wählen (z. B. aus .minecraft/saves)');
    if (!dir || !(await confirmReplace())) return;
    setBusy(true);
    try { await finish(await post(`/mc/servers/${s.id}/worlds/import`, { path: dir, mode, makeMain })); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className={bare ? '' : 'card'}>
      {!bare && <div className="card-head"><Upload size={16} /><h3>Welt hochladen</h3><InfoTip>Eine Einzelspieler-Welt (Ordner aus .minecraft/saves) oder eine gezippte Welt übernehmen. Vorher sichert Hostwerk den ganzen Server.</InfoTip></div>}
      <div className={bare ? 'stack' : 'card-body stack'}>
        <Seg value={mode} onChange={setMode} options={[{ id: 'new', label: 'Als neue Welt' }, { id: 'replace', label: 'Hauptwelt ersetzen' }]} />
        {mode === 'new' && <SettingRow title="Danach als Hauptwelt verwenden" text="Stellt level-name in server.properties um."><Switch checked={makeMain} onChange={setMakeMain} /></SettingRow>}
        {needsStop && running ? <Callout kind="warn">Bitte den Server zuerst stoppen.</Callout> : (
          <>
            <DropZone accept=".zip" onFiles={upload}><Upload size={22} /><div className="bold">{busy ? 'Wird übernommen …' : 'ZIP hierher ziehen oder auswählen'}</div></DropZone>
            {isElectron && <Btn className="ghost sm" icon={FolderOpen} busy={busy} onClick={folder}>Ordner auf diesem PC wählen</Btn>}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Vorgenerieren (Chunky) */
export function PregenCard({ s, bare = false }) {
  const st = useApi(`/mc/servers/${s.id}/pregen`, [], { poll: true });
  const [world, setWorld] = useState('overworld');
  const [radius, setRadius] = useState(2000);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!st.data || !st.data.task || st.data.task.state !== 'running') return undefined;
    const t = setInterval(() => st.reload({ silent: true }), 5000);
    return () => clearInterval(t);
  }, [st.data && st.data.task && st.data.task.state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.data) return null;
  const d = st.data;
  if (!d.supported) return null;
  const task = d.task;
  const run = async (fn) => { setBusy(true); try { await fn(); st.reload(); } catch (e) { toast.error(e.message); } setBusy(false); };
  const label = { running: 'läuft', paused: 'pausiert', done: 'fertig', cancelled: 'abgebrochen' };
  return (
    <div className={bare ? '' : 'card'}>
      {!bare && <div className="card-head"><Globe2 size={16} /><h3>Welt vorgenerieren</h3><InfoTip>Mit Chunky erzeugt der Server das Gelände vorab. Später ruckelt es beim Erkunden nicht mehr, weil nichts mehr neu berechnet werden muss.</InfoTip></div>}
      <div className={bare ? 'stack' : 'card-body stack'}>
        {!d.installed ? (
          <>
            <div className="small muted">Dafür braucht es das {d.mods ? 'Mod' : 'Plugin'} Chunky (von Modrinth).</div>
            <Btn className="sm" icon={Download} busy={busy} onClick={() => run(async () => { const r = await post(`/mc/servers/${s.id}/pregen/install`, {}); await waitJob(r.job); toast.success(d.running ? 'Chunky installiert – nach dem nächsten Neustart verfügbar' : 'Chunky installiert'); })}>Chunky installieren</Btn>
          </>
        ) : (
          <>
            {task && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row small"><b>{task.world}</b><span className={`badge ${task.state === 'done' ? 'ok' : task.state === 'running' ? 'accent' : ''}`}>{label[task.state] || task.state}</span><span className="grow" />{task.eta && task.state === 'running' && <span className="muted">{`noch ${task.eta}`}</span>}</div>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(task.percent || 0)} aria-valuemin={0} aria-valuemax={100} aria-label="Fortschritt der Vorgenerierung"><div style={{ width: `${Math.min(100, task.percent || 0)}%` }} /></div>
                <div className="tiny muted">{`${fmtNumber(task.chunks || 0)} Chunks · ${(task.percent || 0).toFixed(1)} %`}{task.rate ? ` · ${task.rate} Chunks/s` : ''}{task.total ? ` · Dauer ${task.total}` : ''}</div>
                {d.running && task.state === 'running' && <div className="row-tight"><Btn className="ghost xs" icon={Pause} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen/pause`, {}))}>Pausieren</Btn><Btn className="ghost xs" icon={Square} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen/cancel`, {}))}>Abbrechen</Btn></div>}
                {d.running && task.state === 'paused' && <Btn className="ghost xs" icon={Play} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen/continue`, {}))}>Fortsetzen</Btn>}
              </div>
            )}
            {(!task || task.state !== 'running') && (
              <>
                <div className="form-grid">
                  <Field label="Welt"><select className="select" value={world} onChange={(e) => setWorld(e.target.value)}><option value="overworld">Oberwelt</option><option value="nether">Nether</option><option value="end">End</option></select></Field>
                  <Field label="Radius (Blöcke)" hint={`Gebiet von ${(radius * 2).toLocaleString('de-DE')} × ${(radius * 2).toLocaleString('de-DE')} Blöcken rund um den Spawn.`}><input className="input" type="number" min={100} max={50000} step={500} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></Field>
                </div>
                {d.running && d.ready ? <Btn className="primary sm" icon={Play} busy={busy} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen`, { world, radius }))}>Vorgenerieren starten</Btn> : <div className="small muted">Starte den Server, dann kann Chunky loslegen.</div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Datapacks */
export function DatapacksTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/datapacks`);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [busy, setBusy] = useState(null);
  const search = async (query = q) => { try { setHits(await get(`/mc/servers/${s.id}/datapacks-market?q=${encodeURIComponent(query)}`)); } catch (e) { toast.error(e.message); setHits([]); } };
  useEffect(() => { search(''); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.data) return <Loading />;
  const d = st.data;
  const toggle = async (p) => { try { const r = await put(`/mc/servers/${s.id}/datapacks/${encodeURIComponent(p.name)}`, { enabled: !p.enabled }); toast.success(r.live ? 'Sofort übernommen' : 'Wirkt beim nächsten Start'); st.reload(); } catch (e) { toast.error(e.message); } };
  const remove = async (p) => { if (!(await confirmDialog({ title: `„${p.name}“ löschen?`, confirm: 'Löschen', danger: true }))) return; try { await del(`/mc/servers/${s.id}/datapacks/${encodeURIComponent(p.name)}`); st.reload(); } catch (e) { toast.error(e.message); } };
  const install = async (h) => { setBusy(h.id); try { const r = await post(`/mc/servers/${s.id}/datapacks-market`, { projectId: h.id }); await waitJob(r.job); toast.success(`${h.title} installiert`); st.reload(); search(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const upload = async (files) => { try { const fd = new FormData(); fd.append('file', files[0]); await api('POST', `/mc/servers/${s.id}/datapacks/upload`, fd); toast.success('Datapack hinzugefügt'); st.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="grid grid-2">
      <div className="stack">
        <div className="card">
          <div className="card-head"><Package size={16} /><h3>Datapacks in „{d.world}“</h3><span className="badge">{d.packs.length}</span><InfoTip>Datapacks ändern Rezepte, Beute, Weltgenerierung oder fügen Funktionen hinzu – ganz ohne Plugins. Läuft der Server, wirkt An/Aus sofort.</InfoTip></div>
          {!d.exists ? <Empty icon={Package} title="Noch keine Welt" text="Starte den Server einmal, dann lassen sich Datapacks hinzufügen." /> : d.packs.length === 0 ? <Empty icon={Package} title="Keine Datapacks" text="Rechts im Marktplatz suchen oder eine ZIP hochladen." /> : d.packs.map((p) => (
            <div key={p.name} className="list-item" data-row-menu>
              <Switch checked={p.enabled} label={`${p.name} an/aus`} onChange={() => toggle(p)} />
              <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{p.name}</div><div className="tiny muted ellipsis">{p.description || (p.kind === 'zip' ? 'ZIP' : 'Ordner')} · {fmtBytes(p.size)}</div></div>
              <button className="btn ghost xs icon" title="Löschen" aria-label={`${p.name} löschen`} onClick={() => remove(p)}><Trash2 /></button>
            </div>
          ))}
        </div>
        {d.exists && <DropZone accept=".zip" onFiles={upload}><Upload size={20} /><div className="bold">Datapack-ZIP hochladen</div></DropZone>}
      </div>
      <div className="card">
        <div className="card-head"><Search size={16} /><h3>Datapacks von Modrinth</h3></div>
        <div className="card-body stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <div className="input-icon grow"><Search /><input className="input sm" aria-label="Datapacks suchen" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </form>
          {!hits ? <Loading /> : hits.length === 0 ? <div className="small muted">Keine Treffer für Minecraft {s.version}.</div> : hits.map((h) => (
            <div key={h.id} className="row-tight mc-dp-hit">
              <LazyImg src={h.icon} style={{ width: 32, height: 32, borderRadius: 6 }} fallback={<Package size={20} />} />
              <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{h.title}</div><div className="tiny muted ellipsis">{h.description}</div></div>
              <button className="btn ghost xs icon" title="Seite öffnen" aria-label={`${h.title} auf Modrinth öffnen`} onClick={() => openExternal(h.url)}><ExternalLink /></button>
              {h.installed ? <span className="badge ok">installiert</span> : <Btn className="xs" icon={Download} busy={busy === h.id} disabled={!d.exists} onClick={() => install(h)}>Installieren</Btn>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Ältere Protokolle */
export function OldLogsTab({ s }) {
  const files = useApi(`/mc/servers/${s.id}/logfiles`);
  const [file, setFile] = useState(null);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [view, setView] = useState(null);
  useEffect(() => {
    if (!file) { setView(null); return undefined; }
    const t = setTimeout(() => get(`/mc/servers/${s.id}/logfiles/${encodeURIComponent(file)}?q=${encodeURIComponent(q)}&level=${level}`).then(setView).catch((e) => { toast.error(e.message); setView(null); }), 250);
    return () => clearTimeout(t);
  }, [file, q, level]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!files.data) return <Loading />;
  if (!files.data.length) return <Empty icon={History} title="Keine Protokolle" text="Der Server legt sie beim ersten Start im Ordner logs an." />;
  return (
    <div className="grid" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
      <div className="card mc-log-files">
        {files.data.map((f) => (
          <button key={f.file} className={`list-item ${file === f.file ? 'active' : ''}`} onClick={() => setFile(f.file)}>
            <FileText size={14} /><div className="grow" style={{ minWidth: 0, textAlign: 'left' }}><div className="small bold ellipsis">{f.current ? 'Aktuell (latest.log)' : f.file.replace(/\.log(\.gz)?$/, '')}</div><div className="tiny muted">{fmtDate(f.time)} · {fmtBytes(f.size)}</div></div>
          </button>
        ))}
      </div>
      <div className="card">
        {!file ? <Empty icon={History} title="Protokoll wählen" text="Links stehen alle Protokolle, auch die gepackten älteren Tage." /> : (
          <div className="card-body stack">
            <div className="row">
              <div className="input-icon grow"><Search /><input className="input sm" aria-label="Im Protokoll suchen" placeholder="Im Protokoll suchen, z. B. einen Spielernamen …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Seg value={level} onChange={setLevel} options={[{ id: '', label: 'Alles' }, { id: 'warn', label: 'Warnungen' }, { id: 'error', label: 'Fehler' }]} />
            </div>
            {!view ? <Loading /> : (
              <>
                <div className="tiny muted">{q || level ? `${pl(view.matches, 'Treffer', 'Treffer')} von ${pl(view.total, 'Zeile', 'Zeilen')}` : pl(view.total, 'Zeile', 'Zeilen')}{view.truncated ? ' – die letzten 5000 werden gezeigt' : ''}</div>
                <pre className="code-block mc-log-view">{view.lines.join('\n') || '(keine passenden Zeilen)'}</pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Absturzberichte */
export function CrashTab({ s }) {
  const list = useApi(`/mc/servers/${s.id}/crash-reports`);
  const [open, setOpen] = useState(null);
  if (!list.data) return <Loading />;
  if (!list.data.length) return <Empty icon={Bug} title="Keine Absturzberichte" text="Stürzt der Server ab, schreibt Minecraft hier einen Bericht – Hostwerk hängt ihn auch an den Vorfall." />;
  const show = async (f) => { try { setOpen(await get(`/mc/servers/${s.id}/crash-reports/${encodeURIComponent(f.file)}`)); } catch (e) { toast.error(e.message); } };
  return (
    <div className="card">
      {list.data.map((f) => (
        <button key={f.file} className="list-item" onClick={() => show(f)}>
          <Bug size={15} style={{ color: 'var(--err-text)' }} />
          <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}><div className="bold ellipsis">{f.description || f.file}</div><div className="tiny muted ellipsis">{fmtDate(f.time)}{f.exception ? ` · ${f.exception}` : ''}</div></div>
        </button>
      ))}
      {open && (
        <Modal title={open.description || 'Absturzbericht'} subtitle={open.file} size="xwide" onClose={() => setOpen(null)}>
          <div className="stack">
            {open.exception && <Callout kind="err" title="Ursache laut Bericht">{open.exception}</Callout>}
            <AiHint item="crash" title="KI: Was ist passiert?" input={`Minecraft-Server ${s.typeLabel} ${s.version}, Absturzbericht:\n${open.text.slice(0, 6000)}`} />
            <pre className="code-block mc-log-view">{open.text}</pre>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Testkopie und Spielerlisten */
export function ServerToolsTab({ s, servers }) {
  const [name, setName] = useState(`${s.name} (Test)`);
  const [worlds, setWorlds] = useState(true);
  const [busy, setBusy] = useState(null);
  const others = servers.filter((x) => x.id !== s.id && !x.proxy);
  const [targets, setTargets] = useState([]);
  const [lists, setLists] = useState(['whitelist', 'ops']);
  const [mode, setMode] = useState('merge');
  const inNetwork = s.network && s.network.proxy;
  const copy = async () => {
    setBusy('copy');
    try { const r = await post(`/mc/servers/${s.id}/copy`, { name, worlds }); const j = await waitJob(r.job); toast.success(`Testkopie auf Port ${j.result.port} angelegt`); location.hash = `/mc/${j.result.id}`; } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const transfer = async (t) => {
    setBusy('transfer');
    try {
      const r = await post(`/mc/servers/${s.id}/players/transfer`, { targets: t, lists, mode });
      const added = r.results.reduce((n, x) => n + x.added, 0); const removed = r.results.reduce((n, x) => n + x.removed, 0);
      toast.success(`${pl(r.results.length, 'Server', 'Server')} abgeglichen: ${added} hinzugefügt${removed ? `, ${removed} entfernt` : ''}`);
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const tog = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><Copy size={16} /><h3>Testkopie</h3><InfoTip>Eine Kopie mit eigenem Port – zum Ausprobieren von Plugins oder Updates, ohne den echten Server anzufassen. Nächtliche Sicherung und Autostart sind bei der Kopie aus.</InfoTip></div>
        <div className="card-body stack">
          <Field label="Name der Kopie"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <SettingRow title="Welten mitkopieren" text="Aus = frische Welten beim ersten Start."><Switch checked={worlds} onChange={setWorlds} /></SettingRow>
          <Callout kind="info">Plugins, die eine Datenbank oder Discord nutzen, schreiben in der Kopie dorthin, wo auch das Original schreibt – vor dem Start ihre Einstellungen prüfen.</Callout>
          <Btn className="primary sm" icon={Copy} busy={busy === 'copy'} disabled={!name.trim()} onClick={copy}>Kopie anlegen</Btn>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><Users size={16} /><h3>Spielerlisten übertragen</h3><InfoTip>Whitelist, Ops und Banns von diesem Server auf andere übernehmen. Laufende Server bekommen die Änderungen per Befehl, damit nichts überschrieben wird.</InfoTip></div>
        <div className="card-body stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {[['whitelist', 'Whitelist'], ['ops', 'Ops'], ['banned', 'Gebannte Spieler'], ['bannedIps', 'Gebannte IPs']].map(([k, l]) => <label key={k} className="check small"><input type="checkbox" checked={lists.includes(k)} onChange={() => tog(lists, setLists, k)} />{l}</label>)}
          </div>
          <Seg value={mode} onChange={setMode} options={[{ id: 'merge', label: 'Ergänzen' }, { id: 'replace', label: 'Genau übernehmen' }]} />
          {others.length === 0 ? <div className="small muted">Es gibt keinen anderen Server.</div> : (
            <div className="stack" style={{ gap: 4 }}>
              {others.map((x) => <label key={x.id} className="check small"><input type="checkbox" checked={targets.includes(x.id)} onChange={() => tog(targets, setTargets, x.id)} />{x.name}{x.proc.state === 'running' ? ' (läuft)' : ''}</label>)}
            </div>
          )}
          <div className="row-tight">
            <Btn className="sm" icon={Save} busy={busy === 'transfer'} disabled={!targets.length || !lists.length} onClick={() => transfer(targets)}>Übertragen</Btn>
            {inNetwork && <Btn className="ghost sm" icon={NetIcon} busy={busy === 'transfer'} disabled={!lists.length} onClick={() => transfer('network')}>An alle im Netzwerk</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Formulare für Plugin-Einstellungen */
export function PluginFormsTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/plugin-forms`, [], { live: false }); // kein Nachladen: Formular in Bearbeitung
  const [sel, setSel] = useState(null);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  if (!st.data) return <Loading />;
  const forms = st.data.forms;
  if (!forms.length) return <Empty icon={SlidersHorizontal} title="Keine bekannten Plugins" text="Formulare gibt es für die häufigsten Plugins (EssentialsX, LuckPerms, WorldEdit, Geyser …). Starte den Server einmal, damit sie ihre Einstellungsdateien anlegen." />;
  const form = forms.find((f) => f.id === sel) || forms[0];
  const value = (f) => (f.key in vals ? vals[f.key] : f.value);
  const save = async () => {
    setBusy(true);
    try { const r = await put(`/mc/servers/${s.id}/plugin-forms/${form.id}`, { values: vals }); toast.success(r.changed ? `${pl(r.changed, 'Einstellung', 'Einstellungen')} gespeichert${st.data.running ? ' – wirkt nach einem Neustart' : ''}` : 'Nichts geändert'); setVals({}); st.reload(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
      <div className="card">
        {forms.map((f) => <button key={f.id} className={`list-item ${form.id === f.id ? 'active' : ''}`} onClick={() => { setSel(f.id); setVals({}); }}><SlidersHorizontal size={14} /><span className="grow" style={{ textAlign: 'left' }}>{f.name}</span><span className="tiny muted">{f.fields.length}</span></button>)}
      </div>
      <div className="card">
        <div className="card-head"><h3>{form.name}</h3><code className="tiny muted">{form.file}</code><div className="right"><Btn className="primary sm" icon={Save} busy={busy} disabled={!Object.keys(vals).length} onClick={save}>Speichern</Btn></div></div>
        <div className="card-body stack">
          {form.error && <Callout kind="err">{form.error}</Callout>}
          {st.data.running && <InfoTip>Die meisten Plugins lesen ihre Einstellungen nur beim Start – nach dem Speichern den Server neu starten.</InfoTip>}
          {form.fields.map((f) => (
            f.type === 'bool'
              ? <SettingRow key={f.key} title={f.label} text={f.help}><Switch checked={value(f) === true} onChange={(v) => setVals({ ...vals, [f.key]: v })} /></SettingRow>
              : (
                <Field key={f.key} label={f.label} hint={f.help}>
                  {Array.isArray(f.type)
                    ? <select className="select" value={String(value(f) ?? '')} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>{f.type.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'} placeholder={f.type === 'password' && f.hasValue ? 'gespeichert – leer lassen = unverändert' : ''} value={value(f) ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />}
                </Field>
              )
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Spieler-Aktivität (Statistik) */
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAY_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const hrs = (ms) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1).replace('.', ',')} h` : `${Math.round(ms / 60000)} min`);
export function ActivityCard({ activity }) {
  if (!activity) return null;
  const max = Math.max(0.01, ...activity.hours);
  const players = [...new Set(activity.weeks.flatMap((w) => Object.keys(w.players)))]
    .map((n) => ({ n, sum: activity.weeks.reduce((a, w) => a + (w.players[n] || 0), 0) })).sort((a, b) => b.sum - a.sum).slice(0, 10);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><CalendarDays size={16} /><h3>Stoßzeiten</h3><InfoTip>Durchschnittlich gleichzeitig online je Wochentag und Stunde – gemessen, seit Hostwerk die Sitzungen aufzeichnet.</InfoTip></div>
        <div className="card-body stack" style={{ gap: 6 }}>
          {activity.peak ? <div className="small">{`Meist los: ${DAY_NAMES[activity.peak.day]}, ${activity.peak.hour}–${activity.peak.hour + 1} Uhr (Ø ${String(activity.peak.players).replace('.', ',')} Spieler)`}</div> : <div className="small muted">Noch zu wenige Daten.</div>}
          <div className="mc-heat" role="img" aria-label="Stoßzeiten je Wochentag und Stunde">
            {DAYS.map((d, di) => (
              <div key={d} className="mc-heat-row">
                <span className="tiny muted">{d}</span>
                {activity.hours.slice(di * 24, di * 24 + 24).map((v, h) => <span key={h} className="mc-heat-cell" style={{ opacity: v > 0 ? 0.15 + (v / max) * 0.85 : 0.06 }} title={`${DAY_NAMES[di]} ${h}:00 – Ø ${String(v).replace('.', ',')} Spieler`} />)}
              </div>
            ))}
            <div className="mc-heat-row"><span /><span className="tiny muted mc-heat-axis">0</span><span className="tiny muted mc-heat-axis" style={{ gridColumn: 'span 11' }} /><span className="tiny muted mc-heat-axis">12</span><span className="tiny muted mc-heat-axis" style={{ gridColumn: 'span 10' }} /><span className="tiny muted mc-heat-axis">23</span></div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><Sparkles size={16} /><h3>Spielzeit je Woche</h3></div>
        {players.length === 0 ? <TileEmpty text="Noch keine aufgezeichneten Sitzungen." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Spieler</th>{activity.weeks.slice(-4).map((w) => <th key={w.week} className="num">{w.week.replace(/^\d+-W/, 'KW ')}</th>)}</tr></thead>
              <tbody>{players.map(({ n }) => (
                <tr key={n}><td><span className="player"><PlayerHead name={n} />{n}</span></td>{activity.weeks.slice(-4).map((w) => <td key={w.week} className="num">{w.players[n] ? hrs(w.players[n]) : '–'}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Netzwerk als Grafik */
export function NetworkGraph({ proxy, members, servers }) {
  if (!members.length) return null;
  const W = 640; const rowH = 56; const H = Math.max(140, members.length * rowH + 20);
  const info = (id) => servers.find((x) => x.id === id);
  const count = (x) => (x && x.proc.state === 'running' ? (x.proc.extra.playerCount ?? (x.proc.extra.players || []).length) : null);
  const pc = count(info(proxy.id));
  return (
    <div className="card">
      <div className="card-head"><NetIcon size={16} /><h3>Netzwerk als Grafik</h3></div>
      <div className="card-body">
        <svg className="mc-net-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Proxy und verbundene Server mit Spielerzahl">
          {members.map((m, i) => { const y = 30 + i * rowH; return <path key={m.id} d={`M 190 ${H / 2} C 300 ${H / 2}, 330 ${y + 10}, 420 ${y + 10}`} className={`mc-net-link ${info(m.id) && info(m.id).proc.state === 'running' ? 'on' : ''}`} />; })}
          <g transform={`translate(20 ${H / 2 - 28})`}>
            <rect width="170" height="56" rx="10" className="mc-net-node proxy" />
            <text x="14" y="24" className="mc-net-title">{proxy.name}</text>
            <text x="14" y="44" className="mc-net-sub">{pc != null ? `Proxy · ${pl(pc, 'Spieler', 'Spieler')}` : 'Proxy · aus'}</text>
          </g>
          {members.map((m, i) => {
            const x = info(m.id); const c = count(x);
            return (
              <g key={m.id} transform={`translate(420 ${10 + i * rowH})`}>
                <rect width="200" height="44" rx="9" className={`mc-net-node ${c != null ? 'on' : ''}`} />
                <text x="12" y="19" className="mc-net-title">{m.name}{i === 0 ? ' ★' : ''}</text>
                <text x="12" y="35" className="mc-net-sub">{c != null ? `/server ${m.key} · ${pl(c, 'Spieler', 'Spieler')}` : `/server ${m.key} · aus`}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Modpacks von CurseForge */
export function CurseForgePicker({ value, onPick }) {
  const st = useApi('/mc/curseforge', [], { live: false }); // kein Nachladen: Auswahl im Anlege-Dialog
  const [key, setKey] = useState('');
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const search = async (query = q) => { setBusy(true); try { setRes(await get(`/mc/curseforge/modpacks?q=${encodeURIComponent(query)}`)); } catch (e) { toast.error(e.message); setRes({ hits: [] }); } setBusy(false); };
  useEffect(() => { if (st.data && st.data.hasKey) search(''); }, [st.data && st.data.hasKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st.data) return <Loading />;
  if (!st.data.hasKey) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="small">CurseForge verlangt einen eigenen API-Schlüssel. Du bekommst ihn kostenlos unter <button className="link-btn" onClick={() => openExternal('https://console.curseforge.com/')}>console.curseforge.com</button> („API keys“).</div>
        <div className="row">
          <input className="input grow mono" type="password" aria-label="CurseForge-API-Schlüssel" placeholder="$2a$10$…" value={key} onChange={(e) => setKey(e.target.value)} />
          <Btn className="sm primary" busy={busy} disabled={!key.trim()} onClick={async () => { setBusy(true); try { await put('/mc/curseforge/key', { key }); toast.success('Schlüssel gespeichert'); st.reload(); } catch (e) { toast.error(e.message); } setBusy(false); }}>Speichern</Btn>
        </div>
        <InfoTip>Der Schlüssel wird verschlüsselt gespeichert und nur an CurseForge geschickt.</InfoTip>
      </div>
    );
  }
  const pick = async (h) => {
    setDetail({ loading: true, title: h.title });
    try { const d = await get(`/mc/curseforge/modpacks/${h.id}`); setDetail({ ...d, title: h.title }); onPick({ source: 'curseforge', projectId: h.id, fileId: d.id, name: h.title, mc: d.mc, loader: d.loader }); } catch (e) { toast.error(e.message); setDetail(null); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div className="input-icon grow"><Search /><input className="input sm" aria-label="CurseForge-Modpacks suchen" placeholder="Modpack suchen, z. B. All the Mods, RLCraft …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn className="sm" busy={busy} onClick={() => search()}>Suchen</Btn>
      </form>
      <div className="ver-list" style={{ maxHeight: 260 }}>
        {!res ? <div className="ver-item muted">Lädt Modpacks …</div> : res.hits.length === 0 ? <div className="ver-item muted">Keine Treffer</div> : res.hits.map((h) => (
          <div key={h.id} className={`ver-item ${value && value.projectId === h.id ? 'active' : ''}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') pick(h); }} onClick={() => pick(h)} style={{ alignItems: 'center' }}>
            <LazyImg src={h.icon} style={{ width: 28, height: 28, borderRadius: 6 }} fallback={<Package size={20} />} />
            <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{h.title}</div><div className="tiny muted ellipsis">{h.description}</div></div>
            <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{h.loaders.join(' · ')} · {h.versions[0] || ''} · {(h.downloads / 1000).toFixed(0)}k</span>
          </div>
        ))}
      </div>
      {detail && (detail.loading ? <div className="small muted">Lädt „{detail.title}“ …</div> : (
        <InfoTip title={`${detail.title} · ${detail.number}`}>Minecraft {detail.mc || '?'} · {detail.loader || '?'}{detail.size ? ` · Paket ${fmtBytes(detail.size)}` : ''}. Hostwerk installiert den Loader und lädt alle Mods; Mods, deren Autor fremde Downloads verbietet, zeigt Hostwerk zum Herunterladen von Hand.</InfoTip>
      ))}
    </div>
  );
}
