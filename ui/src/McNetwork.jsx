import { useState } from 'react';
import { Network as NetIcon, ArrowUp, ArrowDown, Save, Plus, Package, Download, RefreshCw, ArrowUpCircle, Info, Copy } from 'lucide-react';
import { get, post, useApi, useStore, waitJob, fmtDate } from '@hostwerk/api';
import { NetworkGraph } from './McTools';
import { Btn, Switch, Loading, Callout, Empty, toast, confirmDialog } from '@hostwerk/ui';
import { TYPE_COLORS, mcServers } from './Minecraft';
import { AiHint } from '@hostwerk/kit';
import { t as T } from '@hostwerk/i18n';

const COMPAT_TEXT = { paper: 'Forwarding via paper-global.yml', fabric: 'Forwarding via the FabricProxy-Lite mod', forge: 'Forwarding via the Proxy Compatible Forge mod' };

/* ---------- Velocity: welche Server gehören zum Netzwerk ---------- */
export function NetworkTab({ s }) {
  const st = useApi(`/mc/servers/${s.id}/network`);
  const servers = useStore((x) => mcServers(x.overview));
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
    if (on.some((x) => !x.compat) && !(await confirmDialog({ title: 'Not every server fits', text: 'Vanilla and Spigot can\'t do secure Velocity forwarding. These servers will be added, but players may not get in.', confirm: 'Save anyway' }))) return;
    setBusy(true);
    try {
      const r = await post(`/mc/servers/${s.id}/network`, { members: on.map((x) => ({ id: x.id, key: x.key })) });
      await waitJob(r.job);
      toast.success('Network saved – running servers were restarted.');
      setRows(null); st.reload();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const addr = `localhost:${st.data.port}`;
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><NetIcon size={16} /><h3>Servers in the network</h3><span className="badge">{on.length}</span>
          <div className="right row-tight">
            {!list.some((x) => x.on && x.key === 'lobby') && <Btn className="sm" icon={Plus} busy={busy === 'lobby'} onClick={async () => { setBusy('lobby'); try { const r = await post(`/mc/servers/${s.id}/network/lobby`, {}); await waitJob(r.job); toast.success('Lobby created and set as entry point'); setRows(null); st.reload(); } catch (e) { toast.error(e.message); } setBusy(false); }}>Create lobby</Btn>}
            <Btn className="sm primary" icon={Save} busy={busy === true} disabled={!rows || !!dupe} onClick={save}>Save</Btn>
          </div>
        </div>
        {list.length === 0 ? <Empty icon={NetIcon} title="No other servers yet" text="First create servers (e.g. a lobby and a survival world) for Velocity to connect." /> : list.map((x, i) => (
          <div key={x.id} className="list-item" style={{ opacity: x.on ? 1 : 0.6 }}>
            <Switch checked={x.on} onChange={(v) => edit((l) => { l[i].on = v; return l; })} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="bold">{x.name} {x.on && on[0] && on[0].id === x.id && <span className="badge ok" style={{ marginLeft: 6 }}>Entry</span>}</div>
              <div className="small muted"><span style={{ color: TYPE_COLORS[x.type], fontWeight: 600 }}>{x.type}</span> {x.version} · Port {x.port}{x.running ? ' · running' : ''}</div>
              {x.on && !x.compat && <div className="small" style={{ color: 'var(--warn-text)' }}>This server type doesn't support secure forwarding on its own.</div>}
            </div>
            {x.on && <input className="input mono" style={{ width: 130 }} value={x.key} title="Name for /server" onChange={(e) => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''); edit((l) => { l[i].key = v; return l; }); }} />}
            <Btn className="ghost xs icon" icon={ArrowUp} title="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
            <Btn className="ghost xs icon" icon={ArrowDown} title="Scroll down" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
          </div>
        ))}
        {dupe && <div className="card-body"><Callout kind="warn">The name “{dupe.key}” is used twice.</Callout></div>}
      </div>
      <div className="stack">
        <NetworkGraph proxy={s} servers={servers} members={(() => { const order = st.data.try || []; return st.data.candidates.filter((x) => x.member).sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99)); })()} />
        <div className="card">
          <div className="card-head"><Info size={16} /><h3>How it works</h3></div>
          <div className="card-body stack small">
            <div>Players connect to <b className="mono">{addr}</b> (in your home network via this PC's IP, from outside via “Live operation”) and land on the <b>first</b> server in the list.</div>
            <div>Switch in-game with <code>/server name</code> – z. B. <code>/server {(on[1] || on[0] || { key: 'survival' }).key}</code>.</div>
            <div>Hostwerk sets up forwarding automatically: the servers then only listen on this PC (127.0.0.1) and only let the proxy in. If you remove a server again, Hostwerk restores its previous values.</div>
            {on.map((x) => x.compat && <div key={x.id} className="muted">• {x.name}: {COMPAT_TEXT[x.compat]}</div>)}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><NetIcon size={16} /><h3>Status</h3></div>
          <div className="card-body stack small">
            <div className="row"><span className="muted">Configuration</span><b>{st.data.configured ? 'velocity.toml present' : 'created on first save'}</b></div>
            {st.data.mode && <div className="row"><span className="muted">Forwarding</span><b>{st.data.mode === 'modern' ? 'modern (secure)' : st.data.mode}</b></div>}
            <div className="row"><span className="muted">Secret key</span><b>{st.data.secret ? 'created' : '–'}</b></div>
            <div className="row-tight"><Btn className="sm ghost" icon={Copy} onClick={() => { navigator.clipboard.writeText(addr); toast.success('Address copied'); }}>Copy address</Btn></div>
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
      <div className="card-head"><Package size={16} /><h3>Client pack for players</h3>
        <div className="right"><Btn className="sm ghost" icon={RefreshCw} busy={busy} onClick={analyze}>{a ? 'Check again' : 'Check mods'}</Btn></div>
      </div>
      <div className="card-body stack">
        <div className="small muted">Creates a modpack (.mrpack) with exactly the mods your fellow players need. Import it with one click in the Modrinth app, Prism Launcher or ATLauncher.</div>
        {a && <>
          <div className="row-tight small"><span className="badge ok">{inc.length} go into the pack</span><span className="badge">{a.mods.length - inc.length} server only</span></div>
          <div className="stack" style={{ gap: 4, maxHeight: 220, overflow: 'auto' }}>
            {a.mods.map((m) => (
              <div key={m.file} className="row small" style={{ opacity: m.include ? 1 : 0.55 }}>
                <span className="grow ellipsis">{m.include ? '✓' : '–'} {m.name}</span>
                <span className="muted tiny">{m.note || (m.source === 'modrinth' ? 'Modrinth' : '')}</span>
              </div>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={config} onChange={(e) => setConfig(e.target.checked)} /><span>Include mod settings (config/) – without files containing keys or passwords</span></label>
          <a className="btn primary" href={`/api/mc/servers/${s.id}/client-pack/download${config ? '?config=1' : ''}`}><Download size={14} />Download client pack</a>
          <div className="tiny muted">Modrinth app: “+” → “Import from file”. Prism Launcher: “Add instance” → “Import”. Then connect to the server with the address.</div>
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
    try { const r = await get(`/mc/servers/${s.id}/modpack/updates`); setU(r); setPick(r.latest && r.latest.id); if (!r.versions.length) toast.success('The modpack is up to date.'); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const v = u && u.versions.find((x) => x.id === pick);
  const run = async () => {
    if (!v) return;
    const ok = await confirmDialog({
      title: `Update to ${v.number}?`,
      text: `${v.mcChange ? `${T('Caution: the new version uses Minecraft {mc} instead of {old}. Switching to a newer Minecraft version cannot be undone – except through the backup.', { mc: v.mc, old: s.version })} ` : ''}${T('Hostwerk stops the server, makes a backup, swaps the modpack files (your own mods and the world stay) and starts it again.')}`,
      confirm: 'Update', danger: v.mcChange,
    });
    if (!ok) return;
    setBusy(true);
    try { const r = await post(`/mc/servers/${s.id}/modpack/update`, { versionId: v.id }); const j = await waitJob(r.job); toast.success(`Modpack updated to ${j.result.version}`); setU(null); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="card-head"><Package size={16} /><h3>Modpack</h3><span className="small muted">{s.modpack.name}</span>
        <div className="right"><Btn className="sm ghost" icon={RefreshCw} busy={busy && !u} onClick={check}>Check for updates</Btn></div>
      </div>
      <div className="card-body stack">
        <div className="row"><span className="muted">Installed:</span><b>{s.modpack.version}</b><span className="badge">Minecraft {s.version}</span></div>
        {u && u.versions.length === 0 && <div className="small muted">No newer version found.</div>}
        {u && u.versions.length > 0 && <>
          <div className="stack" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
            {u.versions.map((x) => (
              <div key={x.id}>
                <label className="check small" style={{ alignItems: 'center' }}>
                  <input type="radio" name="mpv" checked={pick === x.id} onChange={() => setPick(x.id)} />
                  <span className="grow"><b>{x.number}</b> <span className="muted">{fmtDate(x.date)}</span>{x.type !== 'release' && <span className="badge" style={{ marginLeft: 6 }}>{x.type}</span>}{x.mcChange && <span className="badge warn" style={{ marginLeft: 6 }}>Minecraft {x.mc}</span>}</span>
                  {x.changelog && <button className="btn ghost xs" onClick={(e) => { e.preventDefault(); setOpen(open === x.id ? null : x.id); }}>Changes</button>}
                </label>
                {open === x.id && <pre className="small muted" style={{ whiteSpace: 'pre-wrap', margin: '4px 0 8px 24px', maxHeight: 160, overflow: 'auto' }}>{x.changelog}</pre>}
              </div>
            ))}
          </div>
          {v && v.changelog && <AiHint item="modpack" title="AI summary" input={`Modpack ${s.modpack.name}: ${s.modpack.version} → ${v.number}${v.mcChange ? ` (Minecraft ${s.version} → ${v.mc})` : ''}\n\n${v.changelog}`} />}
          {v && v.mcChange && <Callout kind="warn">This version switches to Minecraft {v.mc}. Players then have to use the new modpack too.</Callout>}
          <Btn className="primary" icon={ArrowUpCircle} busy={busy} disabled={!v} onClick={run}>{v ? `Update to ${v.number}` : 'Choose version'}</Btn>
          <div className="tiny muted">A backup is created automatically beforehand (Files → Backups).</div>
        </>}
      </div>
    </div>
  );
}
