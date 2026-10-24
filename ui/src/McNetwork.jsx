import { useState } from 'react';
import { Network as NetIcon, ArrowUp, ArrowDown, Save, Plus, Package, Download, RefreshCw, ArrowUpCircle, Info, Copy } from 'lucide-react';
import { get, post, useApi, useStore, waitJob, fmtDate } from '@hostwerk/api';
import { NetworkGraph } from './McTools';
import { Btn, Switch, Loading, Callout, Empty, toast, confirmDialog } from '@hostwerk/ui';
import { TYPE_COLORS } from './Minecraft';
import { AiHint } from '@hostwerk/kit';

const COMPAT_TEXT = { paper: 'Weiterleitung über paper-global.yml', fabric: 'Weiterleitung über die Mod FabricProxy-Lite', forge: 'Weiterleitung über die Mod Proxy Compatible Forge' };

/* ---------- Velocity: welche Server gehören zum Netzwerk ---------- */
export function NetworkTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/network`);
  const servers = useStore((x) => x.overview.minecraft);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!st.data) return <Loading />;
  // Bearbeitungsstand: Mitglieder in Reihenfolge (erster = Einstieg/Lobby), danach die übrigen
  const list = rows || (() => {
    const c = st.data.candidates;
    const order = st.data.try || [];
    const members = c.filter((x) => x.member).sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
    return [...members, ...c.filter((x) => !x.member)].map((x) => ({ ...x, on: x.member }));
  })();
  const edit = (fn) => setRows(fn(list.map((x) => ({ ...x }))));
  const move = (i, d) => edit((l) => { const j = i + d; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; });
  const on = list.filter((x) => x.on);
  const dupe = on.find((x, i) => on.findIndex((y) => y.key === x.key) !== i);
  const save = async () => {
    if (on.some((x) => !x.compat) && !(await confirmDialog({ title: 'Nicht jeder Server passt', text: 'Vanilla und Spigot können die sichere Velocity-Weiterleitung nicht. Diese Server werden zwar eingetragen, Spieler kommen dort aber evtl. nicht hinein.', confirm: 'Trotzdem speichern' }))) return;
    setBusy(true);
    try {
      const r = await post(`/mc/servers/${s.id}/network`, { members: on.map((x) => ({ id: x.id, key: x.key })) });
      await waitJob(r.job);
      toast.success('Netzwerk gespeichert – laufende Server wurden neu gestartet.');
      setRows(null); st.reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const addr = `localhost:${st.data.port}`;
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><NetIcon size={16} /><h3>Server im Netzwerk</h3><span className="badge">{on.length}</span>
          <div className="right row-tight">
            {!list.some((x) => x.on && x.key === 'lobby') && <Btn className="sm" icon={Plus} busy={busy === 'lobby'} onClick={async () => { setBusy('lobby'); try { const r = await post(`/mc/servers/${s.id}/network/lobby`, {}); await waitJob(r.job); toast.success('Lobby angelegt und als Einstieg eingetragen'); setRows(null); st.reload(); } catch (e) { toast.error(e.message); } setBusy(false); }}>Lobby anlegen</Btn>}
            <Btn className="sm primary" icon={Save} busy={busy === true} disabled={!rows || !!dupe} onClick={save}>Speichern</Btn>
          </div>
        </div>
        {list.length === 0 ? <Empty icon={NetIcon} title="Noch keine anderen Server" text="Lege zuerst Server an (z. B. eine Lobby und eine Survival-Welt), die Velocity verbinden soll." /> : list.map((x, i) => (
          <div key={x.id} className="list-item" style={{ opacity: x.on ? 1 : 0.6 }}>
            <Switch checked={x.on} onChange={(v) => edit((l) => { l[i].on = v; return l; })} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="bold">{x.name} {x.on && on[0] && on[0].id === x.id && <span className="badge ok" style={{ marginLeft: 6 }}>Einstieg</span>}</div>
              <div className="small muted"><span style={{ color: TYPE_COLORS[x.type], fontWeight: 600 }}>{x.type}</span> {x.version} · Port {x.port}{x.running ? ' · läuft' : ''}</div>
              {x.on && !x.compat && <div className="small" style={{ color: 'var(--warn-text)' }}>Dieser Servertyp unterstützt die sichere Weiterleitung nicht von selbst.</div>}
            </div>
            {x.on && <input className="input mono" style={{ width: 130 }} value={x.key} title="Name für /server" onChange={(e) => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''); edit((l) => { l[i].key = v; return l; }); }} />}
            <Btn className="ghost xs icon" icon={ArrowUp} title="Nach oben" disabled={i === 0} onClick={() => move(i, -1)} />
            <Btn className="ghost xs icon" icon={ArrowDown} title="Nach unten" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
          </div>
        ))}
        {dupe && <div className="card-body"><Callout kind="warn">Der Name „{dupe.key}“ ist doppelt vergeben.</Callout></div>}
      </div>
      <div className="stack">
        <NetworkGraph proxy={s} servers={servers} members={(() => { const order = st.data.try || []; return st.data.candidates.filter((x) => x.member).sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99)); })()} />
        <div className="card">
          <div className="card-head"><Info size={16} /><h3>So funktioniert's</h3></div>
          <div className="card-body stack small">
            <div>Spieler verbinden sich mit <b className="mono">{addr}</b> (im Heimnetz mit der IP dieses PCs, von außen über „Livebetrieb“) und landen auf dem <b>ersten</b> Server der Liste.</div>
            <div>Gewechselt wird im Spiel mit <code>/server name</code> – z. B. <code>/server {(on[1] || on[0] || { key: 'survival' }).key}</code>.</div>
            <div>Hostwerk richtet die Weiterleitung automatisch ein: Die Server lauschen danach nur noch auf diesem PC (127.0.0.1) und lassen nur den Proxy herein. Nimmst du einen Server wieder heraus, stellt Hostwerk seine alten Werte wieder her.</div>
            {on.map((x) => x.compat && <div key={x.id} className="muted">• {x.name}: {COMPAT_TEXT[x.compat]}</div>)}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><NetIcon size={16} /><h3>Status</h3></div>
          <div className="card-body stack small">
            <div className="row"><span className="muted">Konfiguration</span><b>{st.data.configured ? 'velocity.toml vorhanden' : 'wird beim ersten Speichern angelegt'}</b></div>
            {st.data.mode && <div className="row"><span className="muted">Weiterleitung</span><b>{st.data.mode === 'modern' ? 'modern (sicher)' : st.data.mode}</b></div>}
            <div className="row"><span className="muted">Geheimer Schlüssel</span><b>{st.data.secret ? 'angelegt' : '–'}</b></div>
            <div className="row-tight"><Btn className="sm ghost" icon={Copy} onClick={() => { navigator.clipboard.writeText(addr); toast.success('Adresse kopiert'); }}>Adresse kopieren</Btn></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Client-Paket (.mrpack) für Mitspieler ---------- */
export function ClientPackCard({ s }) {
  const [a, setA] = useState(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(false);
  const analyze = async () => { setBusy(true); try { setA(await get(`/mc/servers/${s.id}/client-pack`)); } catch (e) { toast.error(e.message); } setBusy(false); };
  const inc = a ? a.mods.filter((m) => m.include) : [];
  return (
    <div className="card">
      <div className="card-head"><Package size={16} /><h3>Client-Paket für Spieler</h3>
        <div className="right"><Btn className="sm ghost" icon={RefreshCw} busy={busy} onClick={analyze}>{a ? 'Neu prüfen' : 'Mods prüfen'}</Btn></div>
      </div>
      <div className="card-body stack">
        <div className="small muted">Erstellt ein Modpack (.mrpack) mit genau den Mods, die deine Mitspieler brauchen. Importieren geht in der Modrinth-App, im Prism Launcher oder ATLauncher mit einem Klick.</div>
        {a && <>
          <div className="row-tight small"><span className="badge ok">{inc.length} kommen ins Paket</span><span className="badge">{a.mods.length - inc.length} nur Server</span></div>
          <div className="stack" style={{ gap: 4, maxHeight: 220, overflow: 'auto' }}>
            {a.mods.map((m) => (
              <div key={m.file} className="row small" style={{ opacity: m.include ? 1 : 0.55 }}>
                <span className="grow ellipsis">{m.include ? '✓' : '–'} {m.name}</span>
                <span className="muted tiny">{m.note || (m.source === 'modrinth' ? 'Modrinth' : '')}</span>
              </div>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={config} onChange={(e) => setConfig(e.target.checked)} /><span>Mod-Einstellungen (config/) mitgeben – ohne Dateien mit Schlüsseln oder Passwörtern</span></label>
          <a className="btn primary" href={`/api/mc/servers/${s.id}/client-pack/download${config ? '?config=1' : ''}`}><Download size={14} />Client-Paket herunterladen</a>
          <div className="tiny muted">Modrinth-App: „+“ → „Aus Datei importieren“. Prism Launcher: „Instanz hinzufügen“ → „Importieren“. Danach den Server mit der Adresse verbinden.</div>
        </>}
      </div>
    </div>
  );
}

/* ---------- Modpack: Updates prüfen und einspielen ---------- */
export function ModpackCard({ s }) {
  const [u, setU] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null);
  const [open, setOpen] = useState(null);
  const check = async () => {
    setBusy(true);
    try { const r = await get(`/mc/servers/${s.id}/modpack/updates`); setU(r); setPick(r.latest && r.latest.id); if (!r.versions.length) toast.success('Das Modpack ist aktuell.'); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const v = u && u.versions.find((x) => x.id === pick);
  const run = async () => {
    if (!v) return;
    const ok = await confirmDialog({
      title: `Auf ${v.number} aktualisieren?`,
      text: `${v.mcChange ? `Achtung: Die neue Version nutzt Minecraft ${v.mc} statt ${s.version}. Ein Wechsel auf eine neuere Minecraft-Version lässt sich nicht rückgängig machen – außer über die Sicherung. ` : ''}Hostwerk stoppt den Server, legt eine Sicherung an, tauscht die Modpack-Dateien (deine eigenen Mods und die Welt bleiben) und startet ihn wieder.`,
      confirm: 'Aktualisieren', danger: v.mcChange,
    });
    if (!ok) return;
    setBusy(true);
    try { const r = await post(`/mc/servers/${s.id}/modpack/update`, { versionId: v.id }); const j = await waitJob(r.job); toast.success(`Modpack auf ${j.result.version} aktualisiert`); setU(null); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="card-head"><Package size={16} /><h3>Modpack</h3><span className="small muted">{s.modpack.name}</span>
        <div className="right"><Btn className="sm ghost" icon={RefreshCw} busy={busy && !u} onClick={check}>Updates prüfen</Btn></div>
      </div>
      <div className="card-body stack">
        <div className="row"><span className="muted">Installiert:</span><b>{s.modpack.version}</b><span className="badge">Minecraft {s.version}</span></div>
        {u && u.versions.length === 0 && <div className="small muted">Keine neuere Version gefunden.</div>}
        {u && u.versions.length > 0 && <>
          <div className="stack" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
            {u.versions.map((x) => (
              <div key={x.id}>
                <label className="check small" style={{ alignItems: 'center' }}>
                  <input type="radio" name="mpv" checked={pick === x.id} onChange={() => setPick(x.id)} />
                  <span className="grow"><b>{x.number}</b> <span className="muted">{fmtDate(x.date)}</span>{x.type !== 'release' && <span className="badge" style={{ marginLeft: 6 }}>{x.type}</span>}{x.mcChange && <span className="badge warn" style={{ marginLeft: 6 }}>Minecraft {x.mc}</span>}</span>
                  {x.changelog && <button className="btn ghost xs" onClick={(e) => { e.preventDefault(); setOpen(open === x.id ? null : x.id); }}>Änderungen</button>}
                </label>
                {open === x.id && <pre className="small muted" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 8px 24px', maxHeight: 160, overflow: 'auto' }}>{x.changelog}</pre>}
              </div>
            ))}
          </div>
          {v && v.changelog && <AiHint item="modpack" title="KI-Zusammenfassung" input={`Modpack ${s.modpack.name}: ${s.modpack.version} → ${v.number}${v.mcChange ? ` (Minecraft ${s.version} → ${v.mc})` : ''}\n\n${v.changelog}`} />}
          {v && v.mcChange && <Callout kind="warn">Diese Version wechselt auf Minecraft {v.mc}. Spieler müssen danach ebenfalls das neue Modpack nutzen.</Callout>}
          <Btn className="primary" icon={ArrowUpCircle} busy={busy} disabled={!v} onClick={run}>{v ? `Auf ${v.number} aktualisieren` : 'Version wählen'}</Btn>
          <div className="tiny muted">Vorher wird automatisch eine Sicherung angelegt (Dateien → Sicherungen).</div>
        </>}
      </div>
    </div>
  );
}
