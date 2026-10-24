import { useEffect, useState } from 'react';
import { Gauge, Upload, FolderOpen, Globe2, Package, Search, Download, Trash2, Play, Pause, Square, History, Bug, Copy, Users, Save, SlidersHorizontal, Network as NetIcon, CalendarDays, Sparkles, ExternalLink, FileText } from 'lucide-react';
import { get, post, put, del, api, useApi, waitJob, fmtBytes, fmtDate, fmtNumber, pickFolder, isElectron, openExternal } from '@hostwerk/api';
import { Btn, Field, Switch, SettingRow, Seg, Empty, Loading, Callout, DropZone, Modal, toast, confirmDialog, InfoTip, Sparkline, TileEmpty } from '@hostwerk/ui';
import { PlayerHead, LazyImg } from '@hostwerk/kit';
import { AiHint } from '@hostwerk/kit';
import { t as T, pl } from '@hostwerk/i18n';

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
      <div className="card-head"><Gauge size={16} /><h3>Performance over time</h3><InfoTip>Hostwerk measures the ticks per second every 30 seconds (20 = smooth) – quietly, without lines in the console.</InfoTip></div>
      <div className="card-body stack" style={{ gap: 8 }}>
        <Sparkline data={vals} width={420} height={48} max={20} color={tpsColor(min)} />
        <div className="row small muted mc-tps-legend">
          <span>{`Now ${last.tps} TPS`}{last.mspt != null ? ` · ${last.mspt} ms je Tick` : ''}</span>
          <span>{`Schnitt ${avg.toFixed(1)}`}</span>
          <span style={{ color: tpsColor(min) }}>{`Lowest value ${min}`}</span>
          <span>{`for ${fmtDate(list[0].t)}`}</span>
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
  const finish = async (r) => { const j = await waitJob(r.job); toast.success(j.result && j.result.main ? `World “${j.result.name}” is now the main world` : `World “${j.result && j.result.name}” imported`); onDone && onDone(); };
  const confirmReplace = async () => mode !== 'replace' || confirmDialog({ title: 'Replace main world?', text: 'The current world including Nether and End will be removed. Hostwerk backs up the whole server first.', confirm: 'Replace', danger: true });
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
    const dir = await pickFolder(T('Choose world folder (e.g. from .minecraft/saves)'));
    if (!dir || !(await confirmReplace())) return;
    setBusy(true);
    try { await finish(await post(`/mc/servers/${s.id}/worlds/import`, { path: dir, mode, makeMain })); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className={bare ? '' : 'card'}>
      {!bare && <div className="card-head"><Upload size={16} /><h3>Upload world</h3><InfoTip>Import a singleplayer world (folder from .minecraft/saves) or a zipped world. Hostwerk backs up the whole server first.</InfoTip></div>}
      <div className={bare ? 'stack' : 'card-body stack'}>
        <Seg value={mode} onChange={setMode} options={[{ id: 'new', label: 'As a new world' }, { id: 'replace', label: 'Replace main world' }]} />
        {mode === 'new' && <SettingRow title="Use as main world afterwards" text="Changes level-name in server.properties."><Switch checked={makeMain} onChange={setMakeMain} /></SettingRow>}
        {needsStop && running ? <Callout kind="warn">Please stop the server first.</Callout> : (
          <>
            <DropZone accept=".zip" onFiles={upload}><Upload size={22} /><div className="bold">{busy ? 'Importing …' : 'Drag a ZIP here or choose one'}</div></DropZone>
            {isElectron && <Btn className="ghost sm" icon={FolderOpen} busy={busy} onClick={folder}>Choose folder on this PC</Btn>}
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
  const label = { running: T('running'), paused: T('paused'), done: T('done'), cancelled: T('canceled') };
  return (
    <div className={bare ? '' : 'card'}>
      {!bare && <div className="card-head"><Globe2 size={16} /><h3>Pre-generate world</h3><InfoTip>With Chunky the server generates the terrain in advance. Exploring no longer stutters later because nothing needs to be computed anymore.</InfoTip></div>}
      <div className={bare ? 'stack' : 'card-body stack'}>
        {!d.installed ? (
          <>
            <div className="small muted">This needs the {d.mods ? 'Mod' : 'Plugin'} Chunky (from Modrinth).</div>
            <Btn className="sm" icon={Download} busy={busy} onClick={() => run(async () => { const r = await post(`/mc/servers/${s.id}/pregen/install`, {}); await waitJob(r.job); toast.success(d.running ? 'Chunky installed – after the next restart available' : 'Chunky installed'); })}>Install Chunky</Btn>
          </>
        ) : (
          <>
            {task && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row small"><b>{task.world}</b><span className={`badge ${task.state === 'done' ? 'ok' : task.state === 'running' ? 'accent' : ''}`}>{label[task.state] || task.state}</span><span className="grow" />{task.eta && task.state === 'running' && <span className="muted">{`${task.eta} left`}</span>}</div>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(task.percent || 0)} aria-valuemin={0} aria-valuemax={100} aria-label="Pre-generation progress"><div style={{ width: `${Math.min(100, task.percent || 0)}%` }} /></div>
                <div className="tiny muted">{`${fmtNumber(task.chunks || 0)} Chunks · ${(task.percent || 0).toFixed(1)} %`}{task.rate ? ` · ${task.rate} Chunks/s` : ''}{task.total ? ` · duration ${task.total}` : ''}</div>
                {d.running && task.state === 'running' && <div className="row-tight"><Btn className="ghost xs" icon={Pause} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen/pause`, {}))}>Pause</Btn><Btn className="ghost xs" icon={Square} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen/cancel`, {}))}>Cancel</Btn></div>}
                {d.running && task.state === 'paused' && <Btn className="ghost xs" icon={Play} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen/continue`, {}))}>Resume</Btn>}
              </div>
            )}
            {(!task || task.state !== 'running') && (
              <>
                <div className="form-grid">
                  <Field label="World"><select className="select" value={world} onChange={(e) => setWorld(e.target.value)}><option value="overworld">Overworld</option><option value="nether">Nether</option><option value="end">End</option></select></Field>
                  <Field label="Radius (blocks)" hint={`Area of ${(radius * 2).toLocaleString('de-DE')} × ${(radius * 2).toLocaleString('de-DE')} blocks around the spawn.`}><input className="input" type="number" min={100} max={50000} step={500} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></Field>
                </div>
                {d.running && d.ready ? <Btn className="primary sm" icon={Play} busy={busy} onClick={() => run(() => post(`/mc/servers/${s.id}/pregen`, { world, radius }))}>Start pre-generation</Btn> : <div className="small muted">Start the server, then Chunky can get going.</div>}
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
  const toggle = async (p) => { try { const r = await put(`/mc/servers/${s.id}/datapacks/${encodeURIComponent(p.name)}`, { enabled: !p.enabled }); toast.success(r.live ? 'Applied immediately' : 'Takes effect on the next start'); st.reload(); } catch (e) { toast.error(e.message); } };
  const remove = async (p) => { if (!(await confirmDialog({ title: `Delete “${p.name}”?`, confirm: 'Delete', danger: true }))) return; try { await del(`/mc/servers/${s.id}/datapacks/${encodeURIComponent(p.name)}`); st.reload(); } catch (e) { toast.error(e.message); } };
  const install = async (h) => { setBusy(h.id); try { const r = await post(`/mc/servers/${s.id}/datapacks-market`, { projectId: h.id }); await waitJob(r.job); toast.success(`${h.title} installed`); st.reload(); search(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const upload = async (files) => { try { const fd = new FormData(); fd.append('file', files[0]); await api('POST', `/mc/servers/${s.id}/datapacks/upload`, fd); toast.success('Datapack added'); st.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="grid grid-2">
      <div className="stack">
        <div className="card">
          <div className="card-head"><Package size={16} /><h3>Datapacks in „{d.world}“</h3><span className="badge">{d.packs.length}</span><InfoTip>Datapacks change recipes, loot, world generation or add features – without any plugins. While the server runs, on/off takes effect immediately.</InfoTip></div>
          {!d.exists ? <Empty icon={Package} title="No world yet" text="Start the server once, then you can add datapacks." /> : d.packs.length === 0 ? <Empty icon={Package} title="No datapacks" text="Search the marketplace on the right or upload a ZIP." /> : d.packs.map((p) => (
            <div key={p.name} className="list-item" data-row-menu>
              <Switch checked={p.enabled} label={`${p.name} on/off`} onChange={() => toggle(p)} />
              <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{p.name}</div><div className="tiny muted ellipsis">{p.description || (p.kind === 'zip' ? 'ZIP' : 'Folder')} · {fmtBytes(p.size)}</div></div>
              <button className="btn ghost xs icon" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}><Trash2 /></button>
            </div>
          ))}
        </div>
        {d.exists && <DropZone accept=".zip" onFiles={upload}><Upload size={20} /><div className="bold">Upload datapack ZIP</div></DropZone>}
      </div>
      <div className="card">
        <div className="card-head"><Search size={16} /><h3>Datapacks of Modrinth</h3></div>
        <div className="card-body stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <div className="input-icon grow"><Search /><input className="input sm" aria-label="Search datapacks" placeholder="Search …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </form>
          {!hits ? <Loading /> : hits.length === 0 ? <div className="small muted">No results for Minecraft {s.version}.</div> : hits.map((h) => (
            <div key={h.id} className="row-tight mc-dp-hit">
              <LazyImg src={h.icon} style={{ width: 32, height: 32, borderRadius: 6 }} fallback={<Package size={20} />} />
              <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{h.title}</div><div className="tiny muted ellipsis">{h.description}</div></div>
              <button className="btn ghost xs icon" title="Open Page" aria-label={`Open ${h.title} on Modrinth`} onClick={() => openExternal(h.url)}><ExternalLink /></button>
              {h.installed ? <span className="badge ok">installed</span> : <Btn className="xs" icon={Download} busy={busy === h.id} disabled={!d.exists} onClick={() => install(h)}>Install</Btn>}
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
  if (!files.data.length) return <Empty icon={History} title="No logs" text="The server creates them in the logs folder on its first start." />;
  return (
    <div className="grid" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
      <div className="card mc-log-files">
        {files.data.map((f) => (
          <button key={f.file} className={`list-item ${file === f.file ? 'active' : ''}`} onClick={() => setFile(f.file)}>
            <FileText size={14} /><div className="grow" style={{ minWidth: 0, textAlign: 'left' }}><div className="small bold ellipsis">{f.current ? 'Current (latest.log)' : f.file.replace(/\.log(\.gz)?$/, '')}</div><div className="tiny muted">{fmtDate(f.time)} · {fmtBytes(f.size)}</div></div>
          </button>
        ))}
      </div>
      <div className="card">
        {!file ? <Empty icon={History} title="Choose a log" text="All logs are listed on the left, including the packed older days." /> : (
          <div className="card-body stack">
            <div className="row">
              <div className="input-icon grow"><Search /><input className="input sm" aria-label="Search the log" placeholder="Search the log, e.g. a player name …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Seg value={level} onChange={setLevel} options={[{ id: '', label: 'Everything' }, { id: 'warn', label: 'Warnings' }, { id: 'error', label: 'Error' }]} />
            </div>
            {!view ? <Loading /> : (
              <>
                <div className="tiny muted">{q || level ? `${pl(view.matches, '{n} match', '{n} matches')} of ${pl(view.total, '{n} row', '{n} rows')}` : pl(view.total, '{n} row', '{n} rows')}{view.truncated ? ' – the last 5000 are shown' : ''}</div>
                <pre className="code-block mc-log-view">{view.lines.join('\n') || '(no matching lines)'}</pre>
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
  if (!list.data.length) return <Empty icon={Bug} title="No crash reports" text="If the server crashes, Minecraft writes a report here – Hostwerk also attaches it to the incident." />;
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
        <Modal title={open.description || 'Crash report'} subtitle={open.file} size="xwide" onClose={() => setOpen(null)}>
          <div className="stack">
            {open.exception && <Callout kind="err" title="Cause according to the report">{open.exception}</Callout>}
            <AiHint item="crash" title="AI: What happened?" input={`Minecraft server ${s.typeLabel} ${s.version}, crash report:\n${open.text.slice(0, 6000)}`} />
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
    try { const r = await post(`/mc/servers/${s.id}/copy`, { name, worlds }); const j = await waitJob(r.job); toast.success(`Test copy created on port ${j.result.port}`); location.hash = `/mc/${j.result.id}`; } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const transfer = async (t) => {
    setBusy('transfer');
    try {
      const r = await post(`/mc/servers/${s.id}/players/transfer`, { targets: t, lists, mode });
      const added = r.results.reduce((n, x) => n + x.added, 0); const removed = r.results.reduce((n, x) => n + x.removed, 0);
      toast.success(T('{servers} synced: {added} added', { servers: pl(r.results.length, '{n} server', '{n} servers'), added }) + (removed ? T(', {n} removed', { n: removed }) : ''));
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const tog = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><Copy size={16} /><h3>Test copy</h3><InfoTip>A copy with its own port – for trying out plugins or updates without touching the real server. Nightly backup and autostart are off for the copy.</InfoTip></div>
        <div className="card-body stack">
          <Field label="Name of the copy"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <SettingRow title="Copy worlds too" text="Off = fresh worlds on the first start."><Switch checked={worlds} onChange={setWorlds} /></SettingRow>
          <Callout kind="info">Plugins that use a database or Discord write to the same place from the copy as the original does – check their settings before starting.</Callout>
          <Btn className="primary sm" icon={Copy} busy={busy === 'copy'} disabled={!name.trim()} onClick={copy}>Create copy</Btn>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><Users size={16} /><h3>Transfer player lists</h3><InfoTip>Copy the whitelist, ops and bans from this server to others. Running servers get the changes via commands so nothing is overwritten.</InfoTip></div>
        <div className="card-body stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {[['whitelist', 'Whitelist'], ['ops', 'Ops'], ['banned', T('Gebannte player')], ['bannedIps', 'Gebannte IPs']].map(([k, l]) => <label key={k} className="check small"><input type="checkbox" checked={lists.includes(k)} onChange={() => tog(lists, setLists, k)} />{l}</label>)}
          </div>
          <Seg value={mode} onChange={setMode} options={[{ id: 'merge', label: 'Add' }, { id: 'replace', label: 'Copy exactly' }]} />
          {others.length === 0 ? <div className="small muted">There is no other server.</div> : (
            <div className="stack" style={{ gap: 4 }}>
              {others.map((x) => <label key={x.id} className="check small"><input type="checkbox" checked={targets.includes(x.id)} onChange={() => tog(targets, setTargets, x.id)} />{x.name}{x.proc.state === 'running' ? ' (running)' : ''}</label>)}
            </div>
          )}
          <div className="row-tight">
            <Btn className="sm" icon={Save} busy={busy === 'transfer'} disabled={!targets.length || !lists.length} onClick={() => transfer(targets)}>Transferred</Btn>
            {inNetwork && <Btn className="ghost sm" icon={NetIcon} busy={busy === 'transfer'} disabled={!lists.length} onClick={() => transfer('network')}>To everyone in the network</Btn>}
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
  if (!forms.length) return <Empty icon={SlidersHorizontal} title="No known plugins" text="Forms exist for the most common plugins (EssentialsX, LuckPerms, WorldEdit, Geyser …). Start the server once so they create their settings files." />;
  const form = forms.find((f) => f.id === sel) || forms[0];
  const value = (f) => (f.key in vals ? vals[f.key] : f.value);
  const save = async () => {
    setBusy(true);
    try { const r = await put(`/mc/servers/${s.id}/plugin-forms/${form.id}`, { values: vals }); toast.success(r.changed ? T('{settings} saved', { settings: pl(r.changed, '{n} setting', '{n} settings') }) + (st.data.running ? T(' – takes effect after a restart') : '') : 'Nothing changed'); setVals({}); st.reload(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
      <div className="card">
        {forms.map((f) => <button key={f.id} className={`list-item ${form.id === f.id ? 'active' : ''}`} onClick={() => { setSel(f.id); setVals({}); }}><SlidersHorizontal size={14} /><span className="grow" style={{ textAlign: 'left' }}>{f.name}</span><span className="tiny muted">{f.fields.length}</span></button>)}
      </div>
      <div className="card">
        <div className="card-head"><h3>{form.name}</h3><code className="tiny muted">{form.file}</code><div className="right"><Btn className="primary sm" icon={Save} busy={busy} disabled={!Object.keys(vals).length} onClick={save}>Save</Btn></div></div>
        <div className="card-body stack">
          {form.error && <Callout kind="err">{form.error}</Callout>}
          {st.data.running && <InfoTip>Most plugins only read their settings on start – restart the server after saving.</InfoTip>}
          {form.fields.map((f) => (
            f.type === 'bool'
              ? <SettingRow key={f.key} title={f.label} text={f.help}><Switch checked={value(f) === true} onChange={(v) => setVals({ ...vals, [f.key]: v })} /></SettingRow>
              : (
                <Field key={f.key} label={f.label} hint={f.help}>
                  {Array.isArray(f.type)
                    ? <select className="select" value={String(value(f) ?? '')} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>{f.type.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : <input className="input" type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'} placeholder={f.type === 'password' && f.hasValue ? 'saved – leave empty = unchanged' : ''} value={value(f) ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />}
                </Field>
              )
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Spieler-Aktivität (Statistik) */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hrs = (ms) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1).replace('.', ',')} h` : `${Math.round(ms / 60000)} min`);
export function ActivityCard({ activity }) {
  if (!activity) return null;
  const max = Math.max(0.01, ...activity.hours);
  const players = [...new Set(activity.weeks.flatMap((w) => Object.keys(w.players)))]
    .map((n) => ({ n, sum: activity.weeks.reduce((a, w) => a + (w.players[n] || 0), 0) })).sort((a, b) => b.sum - a.sum).slice(0, 10);
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><CalendarDays size={16} /><h3>Peak times</h3><InfoTip>Average players online at the same time per weekday and hour – measured since Hostwerk started recording sessions.</InfoTip></div>
        <div className="card-body stack" style={{ gap: 6 }}>
          {activity.peak ? <div className="small">{`Busiest: ${DAY_NAMES[activity.peak.day]}, ${activity.peak.hour}–${activity.peak.hour + 1} h (avg. ${String(activity.peak.players).replace('.', ',')} players)`}</div> : <div className="small muted">Not enough data yet.</div>}
          <div className="mc-heat" role="img" aria-label="Peak times per weekday and hour">
            {DAYS.map((d, di) => (
              <div key={d} className="mc-heat-row">
                <span className="tiny muted">{d}</span>
                {activity.hours.slice(di * 24, di * 24 + 24).map((v, h) => <span key={h} className="mc-heat-cell" style={{ opacity: v > 0 ? 0.15 + (v / max) * 0.85 : 0.06 }} title={T('{day} {h}:00 – Ø {n} players', { day: T(DAY_NAMES[di]), h, n: Number(v).toLocaleString() })} />)}
              </div>
            ))}
            <div className="mc-heat-row"><span /><span className="tiny muted mc-heat-axis">0</span><span className="tiny muted mc-heat-axis" style={{ gridColumn: 'span 11' }} /><span className="tiny muted mc-heat-axis">12</span><span className="tiny muted mc-heat-axis" style={{ gridColumn: 'span 10' }} /><span className="tiny muted mc-heat-axis">23</span></div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><Sparkles size={16} /><h3>Playtime per week</h3></div>
        {players.length === 0 ? <TileEmpty text="No recorded sessions yet." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Players</th>{activity.weeks.slice(-4).map((w) => <th key={w.week} className="num">{w.week.replace(/^\d+-W/, 'KW ')}</th>)}</tr></thead>
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
      <div className="card-head"><NetIcon size={16} /><h3>Network as a diagram</h3></div>
      <div className="card-body">
        <svg className="mc-net-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Proxy and connected servers with player count">
          {members.map((m, i) => { const y = 30 + i * rowH; return <path key={m.id} d={`M 190 ${H / 2} C 300 ${H / 2}, 330 ${y + 10}, 420 ${y + 10}`} className={`mc-net-link ${info(m.id) && info(m.id).proc.state === 'running' ? 'on' : ''}`} />; })}
          <g transform={`translate(20 ${H / 2 - 28})`}>
            <rect width="170" height="56" rx="10" className="mc-net-node proxy" />
            <text x="14" y="24" className="mc-net-title">{proxy.name}</text>
            <text x="14" y="44" className="mc-net-sub">{pc != null ? `Proxy · ${pl(pc, '{n} player', '{n} players')}` : 'Proxy · off'}</text>
          </g>
          {members.map((m, i) => {
            const x = info(m.id); const c = count(x);
            return (
              <g key={m.id} transform={`translate(420 ${10 + i * rowH})`}>
                <rect width="200" height="44" rx="9" className={`mc-net-node ${c != null ? 'on' : ''}`} />
                <text x="12" y="19" className="mc-net-title">{m.name}{i === 0 ? ' ★' : ''}</text>
                <text x="12" y="35" className="mc-net-sub">{c != null ? `/server ${m.key} · ${pl(c, '{n} player', '{n} players')}` : `/server ${m.key} · ${T('off')}`}</text>
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
        <div className="small">CurseForge requires its own API key. You get it for free at <button className="link-btn" onClick={() => openExternal('https://console.curseforge.com/')}>console.curseforge.com</button> („API keys“).</div>
        <div className="row">
          <input className="input grow mono" type="password" aria-label="CurseForge API key" placeholder="$2a$10$…" value={key} onChange={(e) => setKey(e.target.value)} />
          <Btn className="sm primary" busy={busy} disabled={!key.trim()} onClick={async () => { setBusy(true); try { await put('/mc/curseforge/key', { key }); toast.success('Key saved'); st.reload(); } catch (e) { toast.error(e.message); } setBusy(false); }}>Save</Btn>
        </div>
        <InfoTip>The key is stored encrypted and only sent to CurseForge.</InfoTip>
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
        <div className="input-icon grow"><Search /><input className="input sm" aria-label="Search CurseForge modpacks" placeholder="Search modpacks, e.g. All the Mods, RLCraft …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn className="sm" busy={busy} onClick={() => search()}>Search</Btn>
      </form>
      <div className="ver-list" style={{ maxHeight: 260 }}>
        {!res ? <div className="ver-item muted">Loading modpacks …</div> : res.hits.length === 0 ? <div className="ver-item muted">No matches</div> : res.hits.map((h) => (
          <div key={h.id} className={`ver-item ${value && value.projectId === h.id ? 'active' : ''}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') pick(h); }} onClick={() => pick(h)} style={{ alignItems: 'center' }}>
            <LazyImg src={h.icon} style={{ width: 28, height: 28, borderRadius: 6 }} fallback={<Package size={20} />} />
            <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{h.title}</div><div className="tiny muted ellipsis">{h.description}</div></div>
            <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{h.loaders.join(' · ')} · {h.versions[0] || ''} · {(h.downloads / 1000).toFixed(0)}k</span>
          </div>
        ))}
      </div>
      {detail && (detail.loading ? <div className="small muted">Loading “{detail.title}“ …</div> : (
        <InfoTip title={`${detail.title} · ${detail.number}`}>Minecraft {detail.mc || '?'} · {detail.loader || '?'}{detail.size ? ` · package ${fmtBytes(detail.size)}` : ''}. Hostwerk installs the loader and downloads all mods; mods whose author forbids third-party downloads are listed for manual download.</InfoTip>
      ))}
    </div>
  );
}
