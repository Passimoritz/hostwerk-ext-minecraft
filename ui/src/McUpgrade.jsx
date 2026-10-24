import { useState } from 'react';
import { ShieldCheck, FlaskConical, ArrowUpCircle, CheckCircle2, XCircle, HelpCircle, Link2, RefreshCw, Trash2, Plus, Code2, ExternalLink, ArrowRight, Unlink, FolderSearch, FolderOpen } from 'lucide-react';
import { post, put, del, useApi, waitJob, fmtDate, fmtBytes, openExternal } from '@hostwerk/api';
import { Btn, Callout, Loading, Modal, Field, toast, confirmDialog, InfoTip } from '@hostwerk/ui';
import { AiHint } from '@hostwerk/kit';
import { t as T, pl } from '@hostwerk/i18n';

/* ---------- Sicherer Versionssprung (Plugin-Prüfung + Probelauf auf Kopie) ---------- */
const ST = { ok: [CheckCircle2, 'c-ok', 'fits'], update: [ArrowUpCircle, 'c-warn', 'update needed'], unknown: [HelpCircle, 'muted', 'unknown'], none: [XCircle, 'c-err', 'no version'] };

export function SafeUpgradeCard({ s, type, version }) {
  const last = useApi(`/mc/servers/${s.id}/safe-upgrade`, [], { live: false });
  const hist = useApi(`/mc/servers/${s.id}/safe-upgrade/history`, [], { live: false });
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(null);
  const [updatePlugins, setUpdatePlugins] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const target = version && (version !== s.version || type !== s.type) ? version : null;
  const checkVersion = target || s.version;
  const doCheck = async () => { setBusy('check'); try { setCheck(await post(`/mc/servers/${s.id}/safe-upgrade/check`, { version: checkVersion, type })); } catch (e) { toast.error(e.message); } setBusy(null); };
  const run = async (apply) => {
    if (apply && !(await confirmDialog({ title: `Switch to ${version}?`, text: T(updatePlugins ? 'First a trial run on a copy (own port, {name} keeps running). If it passes, the server is stopped, backed up, switched over, matching plugin updates are applied and it is started again.' : 'First a trial run on a copy (own port, {name} keeps running). If it passes, the server is stopped, backed up, switched over and started again.', { name: s.name }), confirm: 'Safe upgrade' }))) return;
    setBusy(apply ? 'apply' : 'trial');
    try {
      const r = await post(`/mc/servers/${s.id}/safe-upgrade`, { version, type, updatePlugins, apply });
      toast(apply ? 'Dry run running – then it will be applied …' : 'Trial run on a copy in progress …');
      const j = await waitJob(r.job); last.setData(j.result); hist.reload();
      toast[j.result.ok ? 'success' : 'warn'](j.result.applied ? T(`Applied: ${j.result.to}`) : j.result.ok ? T('Dry run passed – you can apply it') : T('Dry run failed – details below'));
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const r = last.data;
  const counts = check ? check.plugins.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {}) : null;
  const rows = check ? check.plugins.filter((p) => !onlyProblems || p.status !== 'ok') : [];
  const older = (hist.data || []).filter((x) => !r || x.at !== r.at);
  return (
    <div className="card mc-safe">
      <div className="card-head"><ShieldCheck size={16} /><h3>Safe upgrade</h3>
        <InfoTip title="How it works">Hostwerk checks whether all plugins/mods support the target version, starts the new version on a <b>copy</b> (own port – your server keeps running) and only applies it once everything starts. A backup is made first.</InfoTip>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="mc-safe-path">
          <div className="mc-safe-ver"><span className="tiny muted">Now</span><b>{s.typeLabel} {s.version}</b></div>
          <ArrowRight size={18} className="muted" />
          {target
            ? <div className="mc-safe-ver to"><span className="tiny muted">Target</span><b>{type === s.type ? s.typeLabel : type} {target}</b></div>
            : <div className="mc-safe-ver ok"><span className="tiny muted">Target</span><b><CheckCircle2 size={14} /> current</b></div>}
        </div>
        {!target && <div className="small muted">You're already using the selected version. Pick another one on the left under “Version” – or check here whether all plugins for {s.version} are approved and have updates.</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Btn className="sm" icon={ShieldCheck} busy={busy === 'check'} onClick={doCheck}>{target ? 'Check plugins' : `Check plugins for ${s.version}`}</Btn>
          {target && <Btn className="sm" icon={FlaskConical} busy={busy === 'trial'} disabled={!!busy} onClick={() => run(false)}>Trial run only</Btn>}
          {target && <Btn className="sm primary" icon={ArrowUpCircle} busy={busy === 'apply'} disabled={!!busy} onClick={() => run(true)}>Trial run + apply</Btn>}
        </div>
        {target && <label className="check small"><input type="checkbox" checked={updatePlugins} onChange={(e) => setUpdatePlugins(e.target.checked)} />Apply matching plugin updates right away</label>}
        {check && (
          <div className="mc-safe-res">
            <div className="row-tight" style={{ flexWrap: 'wrap', gap: 6 }}>
              <b className="small">{check.summary}</b>
              {Object.entries(ST).map(([k, [I, cls, l]]) => counts[k] ? <span key={k} className="badge"><I size={11} className={cls} /> {counts[k]} {l}</span> : null)}
              <label className="check tiny right"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />only problems</label>
            </div>
            <div className="mc-safe-table">
              {rows.length === 0 ? <div className="tiny muted">No problems – all plugins fit.</div> : rows.map((p) => { const [I, cls, l] = ST[p.status] || ST.unknown; return (
                <div key={p.file} className="mc-safe-row"><I size={13} className={cls} /><b className="ellipsis">{p.name}</b><span className="muted tiny">{p.current || ''}{p.latest ? <> <ArrowRight size={10} /> {p.latest}</> : ''}</span><span className={`tiny ${cls}`}>{l}</span>{p.note && <span className="tiny muted ellipsis" title={p.note}>{p.note}</span>}</div>
              ); })}
            </div>
          </div>
        )}
        {r && (
          <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div className="row-tight small">{r.ok ? <CheckCircle2 size={14} className="c-ok" /> : <XCircle size={14} className="c-err" />}<b>{r.from} → {r.to}</b><span className="muted">· {fmtDate(r.at)}{r.applied ? ' · applied' : ''}</span></div>
            {r.check && <div className="tiny muted">Plugins: {r.check.summary}</div>}
            {r.trial && <div className="tiny muted">Trial run: {r.trial.ok ? `ready after ${r.trial.doneSec} s` : r.trial.crashed ? 'Crash at start' : r.trial.timeout ? 'did not become ready (5 min)' : `Plugins do not load: ${r.trial.failedPlugins.join(', ')}`}{r.trial.errors.length ? ` · ${r.trial.errors.length} error lines` : ''}</div>}
            {r.trial && r.trial.errors.length > 0 && <details><summary className="tiny">Error lines</summary><pre className="tiny" style={{ maxHeight: 160, overflow: 'auto' }}>{r.trial.errors.join('\n')}</pre></details>}
            {r.applied && <div className="tiny muted">Saved beforehand as backup “vor-versionssprung” – you can go back under Worlds → Backups.</div>}
            {!r.ok && <AiHint item="upgrade" title="AI assesses the jump" input={`${r.from} → ${r.to}\nPlugins: ${r.check ? r.check.summary : ''}\nTrial run: ${r.trial ? (r.trial.ok ? 'passed' : 'failed') : '-'}\n${r.trial ? r.trial.errors.slice(0, 10).join('\n') : ''}`} />}
          </div>
        )}
        {older.length > 0 && (
          <details><summary className="tiny muted">Earlier runs ({older.length})</summary>
            <div className="stack" style={{ gap: 2, marginTop: 4 }}>{older.map((x) => <div key={x.at} className="row-tight tiny">{x.ok ? <CheckCircle2 size={12} className="c-ok" /> : <XCircle size={12} className="c-err" />}<b>{x.from} → {x.to}</b><span className="muted">{fmtDate(x.at)}{x.applied ? ' · applied' : ''}</span></div>)}</div>
          </details>
        )}
      </div>
    </div>
  );
}

/* ---------- Plugin-Quellen (GitHub, SpigotMC, Jenkins, Link) ---------- */
export function PluginSourcesCard({ s, onChanged }) {
  const d = useApi(`/mc/servers/${s.id}/plugins/sources`, [], { live: false, poll: true });
  const [busy, setBusy] = useState(null);
  const [link, setLink] = useState(null);
  if (!d.data) return <Loading />;
  const { linked, suggestions } = d.data;
  const doLink = async (file, url) => { try { await put(`/mc/servers/${s.id}/plugins/source`, { file, url }); toast.success('Source linked – updates are checked from now on'); d.reload(); setLink(null); onChanged && onChanged(); } catch (e) { toast.error(e.message); } };
  const check = async () => { setBusy('check'); try { const r = await post(`/mc/servers/${s.id}/plugins/sources/check`); const n = r.filter((x) => x.update).length; toast[n ? 'warn' : 'success'](n ? T(`${pl(n, '{n} update', '{n} updates')} from linked sources`) : T('Linked plugins are up to date')); d.reload(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const update = async (file) => { setBusy(file); try { const r = await post(`/mc/servers/${s.id}/plugins/sources/update`, { file }); const j = await waitJob(r.job); toast.success(`${j.result.file} → ${j.result.version}${j.result.mode === 'queued' ? ` – ${T('applied at the next stop or restart')}` : j.result.mode === 'hot' ? ` – ${T('swapped live, without restart')}` : ''}`); d.reload(); onChanged && onChanged(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const SRC = { github: 'GitHub', spigot: 'SpigotMC', jenkins: 'Jenkins', url: 'Link', project: T('Own project'), hostwerk: T('From Hostwerk') };
  const AUTO = { project: T('Project folder found on this PC – new builds (target/, build/libs/) are offered as an update'), hostwerk: T('Part of Hostwerk and kept up to date with Hostwerk') };
  const rescan = async () => { setBusy('scan'); try { d.setData(await post(`/mc/servers/${s.id}/plugins/sources/rescan`)); toast.success('Project folders searched again'); onChanged && onChanged(); } catch (e) { toast.error(e.message); } setBusy(null); };
  return (
    <div className="card">
      <div className="card-head"><Link2 size={16} /><h3>More sources</h3><span className="small muted">Your projects, GitHub, SpigotMC, Jenkins, link</span>
        <div className="right row-tight"><Btn className="xs ghost" icon={FolderSearch} busy={busy === 'scan'} title="Search for your own plugin projects on this PC again (otherwise runs every 6 hours by itself)" onClick={rescan}>Find projects</Btn>{linked.length > 0 && <Btn className="xs ghost" icon={RefreshCw} busy={busy === 'check'} onClick={check}>Check</Btn>}<Btn className="xs" icon={Plus} onClick={() => setLink({ file: '', url: '' })}>Link</Btn></div>
      </div>
      <div className="card-body stack" style={{ gap: 8 }}>
        <div className="small muted">Plugins that don't come from Modrinth or Hangar get a source here – Hostwerk then checks them for new versions too and installs them with one click. Hostwerk links your own projects on this PC and the Hostwerk bridge by itself.</div>
        {suggestions.length > 0 && <Callout kind="info" dismissible={false}><div className="small">Detected from plugin.yml:</div>{suggestions.map((x) => <div key={x.file} className="row-tight small" style={{ marginTop: 4 }}><Code2 size={13} /><b>{x.name}</b><span className="muted ellipsis">{x.label}</span><Btn className="xs" onClick={() => doLink(x.file, x.url)}>Link</Btn></div>)}</Callout>}
        {linked.length === 0 && suggestions.length === 0 && <div className="small muted">Nothing linked yet.</div>}
        {linked.map((x) => (
          <div key={x.file} className="row-tight small">
            <b className="ellipsis" style={x.paused ? { opacity: 0.6 } : undefined}>{x.name}</b><span className={`src-chip src-${x.source}`}>{SRC[x.source]}</span>{x.auto && <span className="tiny muted" title={AUTO[x.source] || 'Detected from plugin.yml and linked automatically'}>automatic</span>}{x.dir && <span className="tiny muted mono ellipsis" style={{ maxWidth: 220 }} title={x.dir}>{x.dir.split(/[\\/]/).slice(-1)[0]}</span>}{x.paused && <span className="badge" title="The source stays saved – Hostwerk just does not check for updates">unlinked</span>}
            {x.size != null && <span className="tiny muted">{fmtBytes(x.size)}</span>}
            <span className="muted">{x.version || '?'}{x.check && x.check.latest && x.check.update ? <> <ArrowRight size={11} /> <b className="c-warn">{x.check.latest}</b></> : x.check && !x.check.error ? ' · up to date' : ''}{x.check && x.check.error ? ` · ${x.check.error}` : ''}</span>
            <div className="right row-tight">
              {x.check && x.check.update && (x.check.external ? <Btn className="xs" icon={ExternalLink} onClick={() => openExternal(x.check.page)}>Vendor page</Btn> : <Btn className="xs" icon={ArrowUpCircle} busy={busy === x.file} onClick={() => update(x.file)}>Update</Btn>)}
              {x.page && <button className="btn ghost xs icon" title={`Open ${x.label} page`} onClick={() => openExternal(x.page)}><ExternalLink /></button>}
              {x.dir && <button className="btn ghost xs icon" title={`Open project folder: ${x.dir}`} onClick={() => post(`/mc/servers/${s.id}/plugins/source/open`, { file: x.file }).catch((e) => toast.error(e.message))}><FolderOpen /></button>}
              {x.paused
                ? <button className="btn ghost xs" title="Link again – Hostwerk checks for updates again" onClick={async () => { try { await post(`/mc/servers/${s.id}/plugins/source/resume`, { file: x.file }); toast.success(`${x.name} linked again`); d.reload(); onChanged && onChanged(); } catch (e) { toast.error(e.message); } }}><Link2 size={12} /> Link again</button>
                : <button className="btn ghost xs icon" title="Unlink – no update checks for now; the source stays saved" onClick={async () => { await del(`/mc/servers/${s.id}/plugins/source?file=${encodeURIComponent(x.file)}`); toast.success(`${x.name} unlinked – the source stays in the list`); d.reload(); onChanged && onChanged(); }}><Unlink /></button>}
              <button className="btn ghost xs icon danger" title="Delete plugin" onClick={async () => {
                const r = await confirmDialog({ title: `Delete ${x.name}?`, text: 'The plugin file is removed. The server should restart afterwards.', confirm: 'Delete', danger: true, checkbox: { label: T('Also delete the plugin’s settings folder'), checked: false } });
                if (!r || !r.ok) return;
                try { await del(`/mc/servers/${s.id}/plugins/${encodeURIComponent(x.file)}${r.checked ? `?config=${encodeURIComponent(x.name)}` : ''}`); toast.success(`${x.name} deleted`); d.reload(); onChanged && onChanged(); } catch (e) { toast.error(e.message); }
              }}><Trash2 /></button>
            </div>
          </div>
        ))}
      </div>
      {link && (
        <Modal title="Link plugin with a source" onClose={() => setLink(null)} footer={<><Btn onClick={() => setLink(null)}>Cancel</Btn><Btn className="primary" disabled={!link.file || !link.url} onClick={() => doLink(link.file, link.url)}>Link</Btn></>}>
          <div className="stack">
            <Field label="Plugin file"><PluginPicker s={s} value={link.file} onChange={(v) => setLink({ ...link, file: v })} /></Field>
            <Field label="Source" hint="GitHub repository (github.com/name/project), SpigotMC page or ID, Jenkins job (…/job/NAME) or a direct .jar link."><input className="input mono" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://github.com/…" autoFocus /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PluginPicker({ s, value, onChange }) {
  const list = useApi(`/mc/servers/${s.id}/plugins`, [], { live: false, poll: true });
  if (!list.data) return <Loading />;
  return <select className="select" value={value} onChange={(e) => onChange(e.target.value)}><option value="">choose …</option>{list.data.map((p) => <option key={p.file} value={p.file}>{p.name} ({p.file})</option>)}</select>;
}
