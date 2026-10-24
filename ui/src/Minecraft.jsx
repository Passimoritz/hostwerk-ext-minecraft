import { useEffect, useMemo, useState } from 'react';
import { locale } from '@hostwerk/kit';
import { useNew } from '@hostwerk/kit';
import { Box, Plus, Users, Upload, Check, Search, Info, FolderInput } from 'lucide-react';
import { useStore, get, post, api, fmtBytes, waitJob, mcCount } from '@hostwerk/api';
import { CurseForgePicker } from './McTools';
import { Btn, Modal, Field, Empty, StatusPill, Callout, DropZone, Switch, toast, InfoTip, Tabs, Seg } from '@hostwerk/ui';
import { ServiceButtons, ProcStats } from '@hostwerk/kit';
import { useImportState, ImportIntro, noImportTab } from '@hostwerk/kit';
import { Adopt } from '@hostwerk/kit';
import { FavMark, FavButton, favSort, favMenuItem } from '@hostwerk/kit';
import { McText } from './MinecraftExtras';
import { AddTile } from '@hostwerk/kit';
import { serviceMenu } from '@hostwerk/kit';
import { SvcImage, LazyImg, PlayerHead } from '@hostwerk/kit';
import { CompareButton, NotesButton, PickInfo } from '@hostwerk/kit';
import { removeMc, Keep } from '@hostwerk/kit';
import { Advisor, Choices, Step, Summary } from '@hostwerk/kit';
import { useAreaTabs } from '@hostwerk/kit';
import { OverrideSlot } from '@hostwerk/kit';
import { BedrockCreateFields, BedrockPickInfo, isBedrock } from './McBedrock';
import { t as T } from '@hostwerk/i18n';

export const TYPE_COLORS = { paper: '#3b82f6', purpur: '#a855f7', spigot: '#f59e0b', vanilla: '#22c55e', folia: '#14b8a6', fabric: '#c9a66b', neoforge: '#f97316', forge: '#818cf8', modpack: '#ec4899', velocity: '#0ea5e9', bedrock: '#65a30d', custom: '#64748b' };
const NO_VERSIONS = ['custom', 'modpack'];
const LOADER_LABEL = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge', quilt: 'Quilt' };

/** Modpack von Modrinth wählen: Suche, Treffer mit Loader/Versionen, Details der neuesten Version. */
function ModpackPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const search = async (query = q) => { setBusy(true); try { setRes(await get(`/mc/modpacks?q=${encodeURIComponent(query)}`)); } catch (e) { toast.error(e.message); setRes({ hits: [] }); } setBusy(false); };
  useEffect(() => { search(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (h) => {
    setDetail({ loading: true, title: h.title });
    try { const d = await get(`/mc/modpacks/${h.id}`); setDetail({ ...d, title: h.title, icon: h.icon }); onPick({ projectId: h.id, versionId: d.id, name: h.title, mc: d.mc, loader: d.loader, java: d.java }); } catch (e) { toast.error(e.message); setDetail(null); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div className="input-icon grow"><Search /><input className="input sm" placeholder="Search modpacks, e.g. Create, Cobblemon, Better MC …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn className="sm" busy={busy} onClick={() => search()}>Search</Btn>
      </form>
      <div className="ver-list" style={{ maxHeight: 260 }}>
        {!res ? <div className="ver-item muted">Loading modpacks …</div> : res.hits.length === 0 ? <div className="ver-item muted">No matches</div> : res.hits.map((h) => (
          <div key={h.id} className={`ver-item ${value && value.projectId === h.id ? 'active' : ''}`} onClick={() => pick(h)} style={{ alignItems: 'center' }}>
            <LazyImg src={h.icon} style={{ width: 28, height: 28, borderRadius: 6 }} fallback={<Box size={20} />} />
            <div className="grow" style={{ minWidth: 0 }}><div className="bold ellipsis">{h.title}</div><div className="tiny muted ellipsis">{h.description}</div></div>
            <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{h.loaders.map((l) => LOADER_LABEL[l] || l).join(' · ')} · {h.versions[0] || ''} · {(h.downloads / 1000).toFixed(0)}k</span>
          </div>
        ))}
      </div>
      {detail && (detail.loading ? <div className="small muted">Loading “{detail.title}“ …</div> : (
        <InfoTip title={`${detail.title} · ${detail.number}`}>Minecraft {detail.mc} · {LOADER_LABEL[detail.loader] || detail.loader} · Java {detail.java}{detail.size ? ` · package ${fmtBytes(detail.size)}` : ''}. Hostwerk installs the loader in the matching version and downloads all server mods; mods that only run in the game are left out.</InfoTip>
      ))}
    </div>
  );
}

export function VersionPicker({ type, value, onChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [pre, setPre] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (NO_VERSIONS.includes(type)) return;
    setData(null); setErr(null);
    get(`/mc/versions/${type}`).then((d) => { setData(d); if (!value || !d.versions.some((v) => v.id === value)) onChange(d.latest); }).catch((e) => setErr(e.message));
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  if (NO_VERSIONS.includes(type)) return null;
  if (err) return <Callout kind="err">Versions could not be loaded: {err}</Callout>;
  if (!data) return <div className="muted small">Loading versions …</div>;
  const list = data.versions.filter((v) => (pre || v.stable || v.id === data.latest) && (!q || v.id.includes(q)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <div className="input-icon grow"><Search /><input className="input sm" placeholder="Search version …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="check small"><input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />{type === 'vanilla' ? 'Snapshots' : 'Pre-releases'} show</label>
      </div>
      <div className="ver-list">
        {list.map((v) => (
          <div key={v.id} className={`ver-item ${value === v.id ? 'active' : ''}`} onClick={() => onChange(v.id)}>
            {value === v.id ? <Check size={14} style={{ color: 'var(--accent-text)' }} /> : <span style={{ width: 14 }} />}
            <span className="mono">{v.id}</span>
            {v.id === data.latest && <span className="badge ok">Latest</span>}
            {!v.stable && <span className="badge warn">Pre-release</span>}
            {v.date && <span className="tiny muted right">{new Date(v.date).toLocaleDateString(locale())}</span>}
          </div>
        ))}
        {list.length === 0 && <div className="ver-item muted">No matches</div>}
      </div>
    </div>
  );
}

export function CreateServer({ onClose }) {
  const [types, setTypes] = useState([]);
  const [sys, setSys] = useState(null);
  const [f, setF] = useState({ name: T('My server'), type: 'paper', version: '', memMax: 4096, port: '', eula: false, gamemode: 'survival', difficulty: 'normal', maxPlayers: 20, onlineMode: true, seed: '', nightlyBackup: true });
  const [java, setJava] = useState(null);
  const [upload, setUpload] = useState(null);
  const [step, setStep] = useState(1);
  useEffect(() => { get('/mc/types').then(setTypes); get('/mc/system').then(setSys); }, []);
  useEffect(() => { if (f.version && !NO_VERSIONS.includes(f.type) && f.type !== 'bedrock') get(`/mc/java-for/${encodeURIComponent(f.version)}`).then((r) => setJava(r.major)).catch(() => setJava(null)); }, [f.version, f.type]);
  const set = (p) => setF({ ...f, ...p });
  const maxMem = sys ? Math.floor(sys.totalMem / 1024 / 1024 / 1024) * 1024 : 16384;

  const uploadJar = async (files) => {
    const fd = new FormData(); fd.append('file', files[0]);
    try { setUpload({ busy: true, name: files[0].name }); setUpload(await api('POST', '/mc/upload-jar', fd)); } catch (e) { toast.error(e.message); setUpload(null); }
  };

  const create = async () => {
    const r = await post('/mc/servers', { ...f, uploadId: upload && upload.uploadId, port: f.port || undefined, javaMajor: f.type === 'custom' ? f.javaMajor || 25 : undefined, modpack: f.type === 'modpack' ? f.modpack : undefined, version: f.type === 'modpack' ? undefined : f.version });
    onClose();
    toast('Creating server – download running in the background …');
    try { const j = await waitJob(r.job); toast.done(T(`Minecraft server “${f.name || j.result.id}” is set up and ready.`), { label: T('Go to server'), href: `/mc/${j.result.id}` }); } catch { /* Fehler zeigt die Jobanzeige */ }
  };

  const canNext = f.name && (f.type === 'custom' ? upload && upload.uploadId : f.type === 'modpack' ? !!f.modpack : f.version);
  const MC_TAGS = { paper: [T('Recommended'), 'Plugins'], purpur: ['Plugins', T('Many options')], vanilla: ['Original'], spigot: ['Plugins'], folia: [T('Very many players')], fabric: ['Mods', T('Easy')], neoforge: ['Mods', 'Create & Co.'], forge: ['Mods', T('Older')], velocity: [T('Network')], bedrock: [T('Phone & console'), T('Without Java')], modpack: [T('One click')], custom: [T('Pro')] };
  const options = types.map((t) => ({ id: t.id, label: t.label, color: TYPE_COLORS[t.id], desc: t.description, tags: MC_TAGS[t.id] || [] }));
  const tLabel = (types.find((t) => t.id === f.type) || {}).label;
  return (
    <Modal title="New Minecraft server" subtitle={step === 1 ? 'Step 1 of 2 – software & version' : 'Step 2 of 2 – settings'} size="wide" onClose={onClose}
      footer={step === 1
        ? <><Summary items={[tLabel && `${tLabel}${f.type === 'modpack' ? (f.modpack ? ` · ${f.modpack.name}` : '') : f.version ? ` ${f.version}` : ''}`, f.name && `„${f.name}“`]} /><Btn onClick={onClose}>Cancel</Btn><Btn className="primary" disabled={!canNext} onClick={() => setStep(2)}>Next</Btn></>
        : <><Btn onClick={() => setStep(1)}>Back</Btn><Btn className="grad" icon={Check} disabled={!f.eula && f.type !== 'velocity'} onClick={create}>Create server</Btn></>}>
      {step === 1 ? (
        <div className="stack create-dialog">
          <Advisor kind="mc" options={options} placeholder="e.g. “Survival with friends, about 8 people” or “Play Create mods”" onApply={(r) => set({ type: r.pick, version: '', ...(r.values && r.values.name ? { name: r.values.name } : {}), ...(r.values && r.values.maxPlayers ? { maxPlayers: r.values.maxPlayers } : {}), ...(r.values && r.values.ramMB ? { memMax: r.values.ramMB } : {}) })} />
          <Step n="1" title="Name">
            <input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Step>
          <Step n="2" title="Which server software?" hint="Play with friends and use plugins: Paper. Mods: NeoForge or Fabric." right={<CompareButton kind="mc" current={f.type} onPick={(t) => set({ type: t, version: '' })} />}>
            <Choices options={options} value={f.type} onChange={(id) => set({ type: id, version: '' })} compact />
            <PickInfo kind="mc" id={f.type} />
          </Step>
          <Step n="3" title={f.type === 'custom' ? 'Server-JAR' : f.type === 'modpack' ? 'Modpack' : 'Version'}>
          {f.type === 'custom' ? (
            <>
              <DropZone accept=".jar" onFiles={uploadJar}>
                <Upload size={26} />
                <div className="bold" style={{ marginTop: 6 }}>{upload ? (upload.busy ? `Uploading ${upload.name} …` : `✓ ${upload.name} (${fmtBytes(upload.size)})`) : 'Choose a server JAR or drag it here'}</div>
                <div className="small">e.g. Fabric server launcher, Folia or your own build</div>
              </DropZone>
              <div className="form-grid">
                <Field label="Version (display)"><input className="input" placeholder="z. B. 1.21.4" value={f.version} onChange={(e) => set({ version: e.target.value })} /></Field>
                <Field label="Java version"><select className="select" value={f.javaMajor || 25} onChange={(e) => set({ javaMajor: Number(e.target.value) })}>{[25, 21, 17, 11, 8].map((j) => <option key={j} value={j}>Java {j}</option>)}</select></Field>
              </div>
            </>
          ) : f.type === 'modpack' ? (
            <div className="stack" style={{ gap: 8 }}>
              <Seg value={f.packSource || 'modrinth'} onChange={(v) => set({ packSource: v, modpack: null })} options={[{ id: 'modrinth', label: 'Modrinth' }, { id: 'curseforge', label: 'CurseForge' }]} />
              {(f.packSource || 'modrinth') === 'modrinth'
                ? <ModpackPicker value={f.modpack} onPick={(m) => set({ modpack: m, name: f.name === T('My server') ? m.name : f.name, memMax: Math.max(f.memMax, 6144) })} />
                : <CurseForgePicker value={f.modpack} onPick={(m) => set({ modpack: m, name: f.name === T('My server') ? m.name : f.name, memMax: Math.max(f.memMax, 6144) })} />}
            </div>
          ) : (
            <>
              <VersionPicker type={f.type} value={f.version} onChange={(v) => set({ version: v })} />
              {f.version && f.type !== 'bedrock' && <div className="row-tight info-row"><NotesButton product="minecraft" version={f.version} label={`Minecraft ${f.version}: what's new`} />{['paper', 'purpur'].includes(f.type) && <NotesButton product={f.type} version={f.version} label={`Latest ${f.type === 'paper' ? 'Paper' : 'Purpur'} builds`} />}</div>}
            </>
          )}
          </Step>
          {f.type === 'spigot' && <InfoTip>Spigot is built on your PC with the official BuildTools. The first time takes 5–10 minutes.</InfoTip>}
          {['neoforge', 'forge'].includes(f.type) && <InfoTip>Hostwerk downloads the official {f.type === 'forge' ? 'Forge' : 'NeoForge'}installer and sets up the server – this takes 1–3 minutes. You’ll find mods in the marketplace afterwards.</InfoTip>}
          {f.type === 'velocity' && <InfoTip>Velocity is a proxy: players connect to it and switch with <code>/server name</code> between your servers (e.g. lobby, survival, minigames). You then choose which servers belong to it in the “Network” tab – Hostwerk sets up forwarding automatically.</InfoTip>}
          {f.type === 'bedrock' && <BedrockPickInfo />}
          {f.type === 'fabric' && <InfoTip>Hostwerk adds Fabric API right away (almost all Fabric mods need it). You’ll find more mods in the marketplace afterwards.</InfoTip>}
          {(f.type === 'modpack' ? f.modpack && f.modpack.java : java && f.type !== 'custom' && f.type !== 'bedrock') && <div className="small muted row-tight"><Info size={13} /> Requires Java {f.type === 'modpack' ? f.modpack.java : java} – downloaded automatically when needed.</div>}
        </div>
      ) : (
        <div className="stack">
          {f.type === 'bedrock' ? <BedrockCreateFields f={f} set={set} /> : <>
          <Field label={`Memory: ${(f.memMax / 1024).toFixed(1).replace('.', ',')} GB`} hint={sys ? `Your PC has ${fmtBytes(sys.totalMem)} RAM. Recommended: ${['modpack', 'neoforge', 'forge'].includes(f.type) ? 'modpacks and big mods 6–10 GB' : '4–8 GB'}.` : ''}>
            <input className="range" type="range" min={1024} max={Math.max(2048, Math.min(maxMem, 32768))} step={512} value={f.memMax} onChange={(e) => set({ memMax: Number(e.target.value) })} />
          </Field>
          {f.type === 'velocity' ? (
            <div className="form-grid">
              <Field label="Port" hint="Empty = automatic (from 25565). Players enter this port."><input className="input mono" type="number" placeholder="25565" value={f.port} onChange={(e) => set({ port: e.target.value })} /></Field>
            </div>
          ) : <>
          <div className="form-grid">
            <Field label="Port" hint="Empty = automatic (from 25565)"><input className="input mono" type="number" placeholder="25565" value={f.port} onChange={(e) => set({ port: e.target.value })} /></Field>
            <Field label="Max. players"><input className="input" type="number" value={f.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} /></Field>
            <Field label="Game mode"><select className="select" value={f.gamemode} onChange={(e) => set({ gamemode: e.target.value })}><option value="survival">Survival</option><option value="creative">Creative</option><option value="adventure">Adventure</option><option value="spectator">Spectator</option></select></Field>
            <Field label="Difficulty"><select className="select" value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value })}><option value="peaceful">Peaceful</option><option value="easy">Simple</option><option value="normal">Normal</option><option value="hard">Hard</option></select></Field>
            <Field label="World seed (optional)" className="span-2"><input className="input mono" value={f.seed} onChange={(e) => set({ seed: e.target.value })} /></Field>
          </div>
          <div className="setting-row" style={{ paddingTop: 0 }}>
            <div className="txt"><b>Online mode</b><span>Only players with a purchased Minecraft account. Turn off only for LAN tests.</span></div>
            <Switch checked={f.onlineMode} onChange={(v) => set({ onlineMode: v })} />
          </div>
          <div className="setting-row" style={{ paddingTop: 0 }}>
            <div className="txt"><b>Back up every night</b><span>A backup at 3 am, the last 7 stay. Hostwerk catches up on missed nights.</span></div>
            <Switch checked={f.nightlyBackup} onChange={(v) => set({ nightlyBackup: v })} />
          </div>
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={f.eula} onChange={(e) => set({ eula: e.target.checked })} style={{ marginTop: 3 }} />
            <span>I accept the <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft End User License Agreement (EULA)</a>. Without consent no Minecraft server starts.</span>
          </label>
          </>}
          </>}
        </div>
      )}
    </Modal>
  );
}

function ServerIcon({ s }) {
  return <SvcImage kind="mc" id={s.id} name={s.name} className="mc-list-icon" fallback={<div className="svc-icon mc"><Box /></div>} />;
}

export default function Minecraft({ tab }) {
  const o = useStore((s) => s.overview);
  const imp = useImportState('mc');
  const [create, setCreate] = useState(false);
  useEffect(() => { const h = () => setCreate(true); window.addEventListener('hw:new-mc', h); return () => window.removeEventListener('hw:new-mc', h); }, []);
  useNew('mc', () => setCreate(true));
  const servers = o.minecraft;
  const xTabs = useAreaTabs('minecraft'); // Reiter von Erweiterungen (SDK 2.8): #/mc/x-<erweiterung>-<reiter>
  const xCur = xTabs.find((x) => x.id === tab);
  const totalPlayers = useMemo(() => servers.reduce((n, s) => n + mcCount(s), 0), [servers]);
  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1><Box size={22} /> Minecraft servers</h1>
          <p>Paper, Purpur, Folia, Spigot, Vanilla, mod servers (Fabric, NeoForge, Forge), ready modpacks and Bedrock – with console, marketplace, editor and backups.</p>
        </div>
        <div className="actions">
          {totalPlayers > 0 && <span className="pill info"><Users size={13} /> {totalPlayers} Players online</span>}
          <Btn className="grad" icon={Plus} onClick={() => setCreate(true)}>New server</Btn>
        </div>
      </div>
      <Tabs value={xCur ? xCur.id : tab === 'import' ? 'import' : 'servers'} onChange={(t) => { location.hash = t.startsWith('x-') ? `/mc/${t}` : t === 'import' ? '/mc/import' : '/mc'; }} tabs={[{ id: 'servers', label: 'Server', icon: Box, badge: servers.length }, { id: 'import', label: 'Import', icon: FolderInput, disabled: imp.available === false, title: imp.available === false ? T('No Minecraft server outside Hostwerk was found on this PC.') : T('Take over existing Minecraft servers (own folders, start scripts)') }, ...xTabs.map(({ id: xid, label, icon }) => ({ id: xid, label, icon }))]} />
      {xCur ? xCur.render() : tab === 'import' ? <div className="stack"><ImportIntro kind="mc" /><Adopt kind="mc" /></div> : servers.length === 0 ? (
        <OverrideSlot name="minecraft.empty"><div className="card"><Empty icon={Box} title="No Minecraft server yet" text="Create your first server. Hostwerk downloads the right server software and Java automatically."><Btn className="grad" icon={Plus} onClick={() => setCreate(true)}>Create server</Btn></Empty></div></OverrideSlot>
      ) : (
        <div className="grid grid-auto">
          {favSort('mc', servers).map((s) => {
            const players = (s.proc.extra && s.proc.extra.players) || [];
            const loading = s.proc.state === 'running' && !s.proc.extra.ready;
            return (
              <div key={s.id} className={`card svc-card mc-card ${s.proc.state}`} onClick={() => { location.hash = `/mc/${s.id}`; }} onContextMenu={(e) => serviceMenu(e, { icon: { kind: 'mc', id: s.id }, move: { kind: 'mc', id: s.id }, name: s.name, state: s.proc.state, base: `/mc/servers/${s.id}`, href: `#/mc/${s.id}`, dir: s.dir, copy: [[T('Copy address'), `localhost:${s.port}`]], remove: () => removeMc(s), removeLabel: T('Delete …') })}>
                <div className="svc-top">
                  <ServerIcon s={s} />
                  <FavMark kind="mc" id={s.id} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="svc-title ellipsis"><Keep>{s.name}</Keep></div>
                    <div className="small muted"><span style={{ color: `color-mix(in srgb, ${TYPE_COLORS[s.type] || 'var(--text)'} 65%, var(--text))`, fontWeight: 600 }}>{s.typeLabel}</span> {s.version}{s.build ? ` #${s.build}` : ''}{s.updates && (s.updates.modpack || s.updates.addons > 0) && <span className="badge warn" style={{ marginLeft: 6 }} title={[s.updates.modpack && `Modpack ${s.updates.modpack.number}`, ...(s.updates.names || [])].filter(Boolean).join('\n')}>Updates</span>}</div>
                  </div>
                  <StatusPill state={s.proc.state} label={loading ? 'Loading …' : undefined} />
                </div>
                {(s.proc.extra.liveMotd || s.motd) && <div className="mc-motd small ellipsis"><McText text={s.proc.extra.liveMotd || s.motd} /></div>}
                {players.length > 0 && <div className="mc-heads">{players.slice(0, 8).map((p) => <PlayerHead key={p} name={p} size={22} title={p} />)}{players.length > 8 && <span className="tiny muted">+{players.length - 8}</span>}</div>}
                <div className="svc-meta">
                  <div><div className="k">Address</div><div className="v mono small">localhost:{s.port}</div></div>
                  <div><div className="k">Players</div><div className="v">{s.proc.state === 'running' ? `${players.length}${s.maxPlayers ? ' / ' + s.maxPlayers : ''}` : '–'}</div></div>
                  {isBedrock(s) ? <div><div className="k">Port</div><div className="v">{T(`${s.port} UDP`)}</div></div> : <div><div className="k">RAM</div><div className="v">{(s.memMax / 1024).toFixed(1).replace('.', ',')} GB</div></div>}
                  {s.proc.extra.tps != null && s.proc.state === 'running' && <div><div className="k">TPS</div><div className="v" style={{ color: s.proc.extra.tps >= 19.5 ? 'var(--ok)' : 'var(--warn)' }}>{s.proc.extra.tps}</div></div>}
                </div>
                <ProcStats proc={s.proc} svc={`mc:${s.id}`} compact />
                <div className="svc-actions" onClick={(e) => e.stopPropagation()}>
                  <ServiceButtons base={`/mc/servers/${s.id}`} state={s.proc.state} size="sm" />
                </div>
              </div>
            );
          })}
          <AddTile onClick={() => setCreate(true)} title="Another Minecraft server" text="Own world, own port – Hostwerk downloads Java and the server software" chips={[{ label: 'Paper', color: TYPE_COLORS.paper }, { label: 'Purpur', color: TYPE_COLORS.purpur }, { label: 'Vanilla', color: TYPE_COLORS.vanilla }, { label: 'Fabric', color: TYPE_COLORS.fabric }, { label: 'Modpacks', color: TYPE_COLORS.modpack }, { label: 'Velocity', color: TYPE_COLORS.velocity }, { label: 'Bedrock', color: TYPE_COLORS.bedrock }]} />
        </div>
      )}
      {create && <CreateServer onClose={() => setCreate(false)} />}
    </div>
  );
}
