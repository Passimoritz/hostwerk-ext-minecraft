import { useState } from 'react';
import { ShieldCheck, FlaskConical, ArrowUpCircle, CheckCircle2, XCircle, HelpCircle, Link2, RefreshCw, Trash2, Plus, Code2, ExternalLink, ArrowRight, Unlink, FolderSearch, FolderOpen } from 'lucide-react';
import { post, put, del, useApi, waitJob, fmtDate, fmtBytes, openExternal } from '@hostwerk/api';
import { Btn, Callout, Loading, Modal, Field, toast, confirmDialog, InfoTip } from '@hostwerk/ui';
import { AiHint } from '@hostwerk/kit';
import { pl } from '@hostwerk/kit';

/* ---------- Sicherer Versionssprung (Plugin-Prüfung + Probelauf auf Kopie) ---------- */
const ST = { ok: [CheckCircle2, 'c-ok', 'passt'], update: [ArrowUpCircle, 'c-warn', 'Update nötig'], unknown: [HelpCircle, 'muted', 'unbekannt'], none: [XCircle, 'c-err', 'keine Version'] };

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
    if (apply && !(await confirmDialog({ title: `Auf ${version} wechseln?`, text: `Erst Probelauf auf einer Kopie (eigener Port, ${s.name} läuft weiter). Besteht er, wird der Server gestoppt, gesichert, umgestellt${updatePlugins ? ', passende Plugin-Updates eingespielt' : ''} und wieder gestartet.`, confirm: 'Sicher aktualisieren' }))) return;
    setBusy(apply ? 'apply' : 'trial');
    try {
      const r = await post(`/mc/servers/${s.id}/safe-upgrade`, { version, type, updatePlugins, apply });
      toast(apply ? 'Probelauf läuft – danach wird eingespielt …' : 'Probelauf auf einer Kopie läuft …');
      const j = await waitJob(r.job); last.setData(j.result); hist.reload();
      toast[j.result.ok ? 'success' : 'warn'](j.result.applied ? `Eingespielt: ${j.result.to}` : j.result.ok ? 'Probelauf bestanden – du kannst einspielen' : 'Probelauf nicht bestanden – Details unten');
    } catch (e) { toast.error(e.message); }
    setBusy(null);
  };
  const r = last.data;
  const counts = check ? check.plugins.reduce((m, p) => ({ ...m, [p.status]: (m[p.status] || 0) + 1 }), {}) : null;
  const rows = check ? check.plugins.filter((p) => !onlyProblems || p.status !== 'ok') : [];
  const older = (hist.data || []).filter((x) => !r || x.at !== r.at);
  return (
    <div className="card mc-safe">
      <div className="card-head"><ShieldCheck size={16} /><h3>Sicher aktualisieren</h3>
        <InfoTip title="So funktioniert es">Hostwerk prüft, ob alle Plugins/Mods für die Zielversion freigegeben sind, startet die neue Version auf einer <b>Kopie</b> (eigener Port – dein Server läuft weiter) und spielt sie erst ein, wenn alles startet. Vorher wird eine Sicherung angelegt.</InfoTip>
      </div>
      <div className="card-body stack" style={{ gap: 12 }}>
        <div className="mc-safe-path">
          <div className="mc-safe-ver"><span className="tiny muted">Jetzt</span><b>{s.typeLabel} {s.version}</b></div>
          <ArrowRight size={18} className="muted" />
          {target
            ? <div className="mc-safe-ver to"><span className="tiny muted">Ziel</span><b>{type === s.type ? s.typeLabel : type} {target}</b></div>
            : <div className="mc-safe-ver ok"><span className="tiny muted">Ziel</span><b><CheckCircle2 size={14} /> aktuell</b></div>}
        </div>
        {!target && <div className="small muted">Du nutzt bereits die gewählte Version. Wähle links unter „Version“ eine andere – oder prüfe hier, ob alle Plugins für {s.version} freigegeben sind und Updates haben.</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Btn className="sm" icon={ShieldCheck} busy={busy === 'check'} onClick={doCheck}>{target ? 'Plugins prüfen' : `Plugins für ${s.version} prüfen`}</Btn>
          {target && <Btn className="sm" icon={FlaskConical} busy={busy === 'trial'} disabled={!!busy} onClick={() => run(false)}>Nur Probelauf</Btn>}
          {target && <Btn className="sm primary" icon={ArrowUpCircle} busy={busy === 'apply'} disabled={!!busy} onClick={() => run(true)}>Probelauf + einspielen</Btn>}
        </div>
        {target && <label className="check small"><input type="checkbox" checked={updatePlugins} onChange={(e) => setUpdatePlugins(e.target.checked)} />Passende Plugin-Updates gleich mit einspielen</label>}
        {check && (
          <div className="mc-safe-res">
            <div className="row-tight" style={{ flexWrap: 'wrap', gap: 6 }}>
              <b className="small">{check.summary}</b>
              {Object.entries(ST).map(([k, [I, cls, l]]) => counts[k] ? <span key={k} className="badge"><I size={11} className={cls} /> {counts[k]} {l}</span> : null)}
              <label className="check tiny right"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />nur Probleme</label>
            </div>
            <div className="mc-safe-table">
              {rows.length === 0 ? <div className="tiny muted">Keine Probleme – alle Plugins passen.</div> : rows.map((p) => { const [I, cls, l] = ST[p.status] || ST.unknown; return (
                <div key={p.file} className="mc-safe-row"><I size={13} className={cls} /><b className="ellipsis">{p.name}</b><span className="muted tiny">{p.current || ''}{p.latest ? <> <ArrowRight size={10} /> {p.latest}</> : ''}</span><span className={`tiny ${cls}`}>{l}</span>{p.note && <span className="tiny muted ellipsis" title={p.note}>{p.note}</span>}</div>
              ); })}
            </div>
          </div>
        )}
        {r && (
          <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
            <div className="row-tight small">{r.ok ? <CheckCircle2 size={14} className="c-ok" /> : <XCircle size={14} className="c-err" />}<b>{r.from} → {r.to}</b><span className="muted">· {fmtDate(r.at)}{r.applied ? ' · eingespielt' : ''}</span></div>
            {r.check && <div className="tiny muted">Plugins: {r.check.summary}</div>}
            {r.trial && <div className="tiny muted">Probelauf: {r.trial.ok ? `bereit nach ${r.trial.doneSec} s` : r.trial.crashed ? 'Absturz beim Start' : r.trial.timeout ? 'nicht bereit geworden (5 Min.)' : `Plugins laden nicht: ${r.trial.failedPlugins.join(', ')}`}{r.trial.errors.length ? ` · ${r.trial.errors.length} Fehlerzeilen` : ''}</div>}
            {r.trial && r.trial.errors.length > 0 && <details><summary className="tiny">Fehlerzeilen</summary><pre className="tiny" style={{ maxHeight: 160, overflow: 'auto' }}>{r.trial.errors.join('\n')}</pre></details>}
            {r.applied && <div className="tiny muted">Vorher gesichert als Sicherung „vor-versionssprung“ – zurück geht es unter Welten → Sicherungen.</div>}
            {!r.ok && <AiHint item="upgrade" title="KI bewertet den Sprung" input={`${r.from} → ${r.to}\nPlugins: ${r.check ? r.check.summary : ''}\nProbelauf: ${r.trial ? (r.trial.ok ? 'bestanden' : 'gescheitert') : '-'}\n${r.trial ? r.trial.errors.slice(0, 10).join('\n') : ''}`} />}
          </div>
        )}
        {older.length > 0 && (
          <details><summary className="tiny muted">Frühere Läufe ({older.length})</summary>
            <div className="stack" style={{ gap: 2, marginTop: 4 }}>{older.map((x) => <div key={x.at} className="row-tight tiny">{x.ok ? <CheckCircle2 size={12} className="c-ok" /> : <XCircle size={12} className="c-err" />}<b>{x.from} → {x.to}</b><span className="muted">{fmtDate(x.at)}{x.applied ? ' · eingespielt' : ''}</span></div>)}</div>
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
  const doLink = async (file, url) => { try { await put(`/mc/servers/${s.id}/plugins/source`, { file, url }); toast.success('Quelle verknüpft – Updates werden ab jetzt geprüft'); d.reload(); setLink(null); onChanged && onChanged(); } catch (e) { toast.error(e.message); } };
  const check = async () => { setBusy('check'); try { const r = await post(`/mc/servers/${s.id}/plugins/sources/check`); const n = r.filter((x) => x.update).length; toast[n ? 'warn' : 'success'](n ? `${pl(n, 'Update', 'Updates')} bei verknüpften Quellen` : 'Verknüpfte Plugins sind aktuell'); d.reload(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const update = async (file) => { setBusy(file); try { const r = await post(`/mc/servers/${s.id}/plugins/sources/update`, { file }); const j = await waitJob(r.job); toast.success(`${j.result.file} → ${j.result.version}${j.result.mode === 'queued' ? ' – wird beim nächsten Stopp oder Neustart eingespielt' : j.result.mode === 'hot' ? ' – live ausgetauscht, ohne Neustart' : ''}`); d.reload(); onChanged && onChanged(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const SRC = { github: 'GitHub', spigot: 'SpigotMC', jenkins: 'Jenkins', url: 'Link', project: 'Eigenes Projekt', hostwerk: 'Von Hostwerk' };
  const AUTO = { project: 'Projektordner auf diesem PC erkannt – neue Builds (target/, build/libs/) werden als Update angeboten', hostwerk: 'Gehört zu Hostwerk und wird mit Hostwerk aktuell gehalten' };
  const rescan = async () => { setBusy('scan'); try { d.setData(await post(`/mc/servers/${s.id}/plugins/sources/rescan`)); toast.success('Projektordner neu durchsucht'); onChanged && onChanged(); } catch (e) { toast.error(e.message); } setBusy(null); };
  return (
    <div className="card">
      <div className="card-head"><Link2 size={16} /><h3>Weitere Quellen</h3><span className="small muted">Eigene Projekte, GitHub, SpigotMC, Jenkins, Link</span>
        <div className="right row-tight"><Btn className="xs ghost" icon={FolderSearch} busy={busy === 'scan'} title="Eigene Plugin-Projekte auf diesem PC neu suchen (läuft sonst alle 6 Stunden von selbst)" onClick={rescan}>Projekte suchen</Btn>{linked.length > 0 && <Btn className="xs ghost" icon={RefreshCw} busy={busy === 'check'} onClick={check}>Prüfen</Btn>}<Btn className="xs" icon={Plus} onClick={() => setLink({ file: '', url: '' })}>Verknüpfen</Btn></div>
      </div>
      <div className="card-body stack" style={{ gap: 8 }}>
        <div className="small muted">Plugins, die nicht von Modrinth oder Hangar kommen, bekommen hier eine Quelle – danach prüft Hostwerk auch für sie, ob eine neue Version vorliegt, und spielt sie per Klick ein. Eigene Projekte auf diesem PC und die Hostwerk-Bridge verknüpft Hostwerk von selbst.</div>
        {suggestions.length > 0 && <Callout kind="info" dismissible={false}><div className="small">Erkannt aus der plugin.yml:</div>{suggestions.map((x) => <div key={x.file} className="row-tight small" style={{ marginTop: 4 }}><Code2 size={13} /><b>{x.name}</b><span className="muted ellipsis">{x.label}</span><Btn className="xs" onClick={() => doLink(x.file, x.url)}>Verknüpfen</Btn></div>)}</Callout>}
        {linked.length === 0 && suggestions.length === 0 && <div className="small muted">Noch nichts verknüpft.</div>}
        {linked.map((x) => (
          <div key={x.file} className="row-tight small">
            <b className="ellipsis" style={x.paused ? { opacity: 0.6 } : undefined}>{x.name}</b><span className={`src-chip src-${x.source}`}>{SRC[x.source]}</span>{x.auto && <span className="tiny muted" title={AUTO[x.source] || 'Aus der plugin.yml erkannt und automatisch verknüpft'}>automatisch</span>}{x.dir && <span className="tiny muted mono ellipsis" style={{ maxWidth: 220 }} title={x.dir}>{x.dir.split(/[\\/]/).slice(-1)[0]}</span>}{x.paused && <span className="badge" title="Die Quelle bleibt gespeichert – Hostwerk prüft nur keine Updates">entkoppelt</span>}
            {x.size != null && <span className="tiny muted">{fmtBytes(x.size)}</span>}
            <span className="muted">{x.version || '?'}{x.check && x.check.latest && x.check.update ? <> <ArrowRight size={11} /> <b className="c-warn">{x.check.latest}</b></> : x.check && !x.check.error ? ' · aktuell' : ''}{x.check && x.check.error ? ` · ${x.check.error}` : ''}</span>
            <div className="right row-tight">
              {x.check && x.check.update && (x.check.external ? <Btn className="xs" icon={ExternalLink} onClick={() => openExternal(x.check.page)}>Herstellerseite</Btn> : <Btn className="xs" icon={ArrowUpCircle} busy={busy === x.file} onClick={() => update(x.file)}>Aktualisieren</Btn>)}
              {x.page && <button className="btn ghost xs icon" title={`${x.label}-Seite öffnen`} onClick={() => openExternal(x.page)}><ExternalLink /></button>}
              {x.dir && <button className="btn ghost xs icon" title={`Projektordner öffnen: ${x.dir}`} onClick={() => post(`/mc/servers/${s.id}/plugins/source/open`, { file: x.file }).catch((e) => toast.error(e.message))}><FolderOpen /></button>}
              {x.paused
                ? <button className="btn ghost xs" title="Wieder verknüpfen – Hostwerk prüft wieder Updates" onClick={async () => { try { await post(`/mc/servers/${s.id}/plugins/source/resume`, { file: x.file }); toast.success(`${x.name} wieder verknüpft`); d.reload(); onChanged && onChanged(); } catch (e) { toast.error(e.message); } }}><Link2 size={12} /> Wieder verknüpfen</button>
                : <button className="btn ghost xs icon" title="Entkoppeln – vorübergehend keine Update-Prüfung; die Quelle bleibt gespeichert" onClick={async () => { await del(`/mc/servers/${s.id}/plugins/source?file=${encodeURIComponent(x.file)}`); toast.success(`${x.name} entkoppelt – die Quelle bleibt in der Liste`); d.reload(); onChanged && onChanged(); }}><Unlink /></button>}
              <button className="btn ghost xs icon danger" title="Plugin löschen" onClick={async () => {
                const r = await confirmDialog({ title: `${x.name} löschen?`, text: 'Die Plugin-Datei wird entfernt. Der Server sollte danach neu starten.', confirm: 'Löschen', danger: true, checkbox: { label: 'Auch den Einstellungs-Ordner des Plugins löschen', checked: false } });
                if (!r || !r.ok) return;
                try { await del(`/mc/servers/${s.id}/plugins/${encodeURIComponent(x.file)}${r.checked ? `?config=${encodeURIComponent(x.name)}` : ''}`); toast.success(`${x.name} gelöscht`); d.reload(); onChanged && onChanged(); } catch (e) { toast.error(e.message); }
              }}><Trash2 /></button>
            </div>
          </div>
        ))}
      </div>
      {link && (
        <Modal title="Plugin mit Quelle verknüpfen" onClose={() => setLink(null)} footer={<><Btn onClick={() => setLink(null)}>Abbrechen</Btn><Btn className="primary" disabled={!link.file || !link.url} onClick={() => doLink(link.file, link.url)}>Verknüpfen</Btn></>}>
          <div className="stack">
            <Field label="Plugin-Datei"><PluginPicker s={s} value={link.file} onChange={(v) => setLink({ ...link, file: v })} /></Field>
            <Field label="Quelle" hint="GitHub-Repository (github.com/name/projekt), SpigotMC-Seite oder -ID, Jenkins-Job (…/job/NAME) oder direkter .jar-Link."><input className="input mono" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://github.com/…" autoFocus /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PluginPicker({ s, value, onChange }) {
  const list = useApi(`/mc/servers/${s.id}/plugins`, [], { live: false, poll: true });
  if (!list.data) return <Loading />;
  return <select className="select" value={value} onChange={(e) => onChange(e.target.value)}><option value="">wählen …</option>{list.data.map((p) => <option key={p.file} value={p.file}>{p.name} ({p.file})</option>)}</select>;
}
