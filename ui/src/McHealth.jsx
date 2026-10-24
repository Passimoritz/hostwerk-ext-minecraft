import { useEffect, useRef, useState } from 'react';
import { Gauge, Cpu, MemoryStick, HardDrive, Globe2, Puzzle, Lightbulb, ListTree, Download, Info } from 'lucide-react';
import { get, post, useApi, fmtBytes, fmtDuration } from '@hostwerk/api';
import { Btn, SideSheet, Loading, Callout, StatusPill, toast, useNow } from '@hostwerk/ui';
import McDimIcon, { dimLabel, useDimInfo } from './McDimIcon';
import { t as T } from '@hostwerk/i18n';

/*
 * Zustand eines Minecraft-Servers: auf der Kachel CPU und RAM immer als „Server / System“, in der Detailansicht die
 * Aufschlüsselung – was am PC wie viel braucht (dieser Server, andere Dienste, andere Programme), was im Server wie viel
 * braucht (Java-Speicher, CPU je Aufgabe, Welten, Plugins) und wie viel Platz auf der Platte belegt ist.
 * Das Innere der Java-VM liefert die HostwerkBridge ab 1.2 (still über die Konsole); ohne sie bleibt die Prozess-Sicht.
 */

const pctText = (v) => (v == null || !Number.isFinite(v) ? '–' : `${String(Math.round(v * 10) / 10).replace('.', ',')} %`);
const gb = (b) => (b == null ? '–' : fmtBytes(b));

/** Gestapelter Balken: parts = [{ v, cls, label, hint }], total = 100 %. */
function StackBar({ parts, total, height = 10 }) {
  const sum = Math.max(total || 0, parts.reduce((n, p) => n + Math.max(0, p.v || 0), 0)) || 1;
  return (
    <div className="hb-bar" style={{ height }} role="img" aria-label={parts.map((p) => `${p.label}: ${p.hint || ''}`).join(', ')}>
      {parts.filter((p) => p.v > 0).map((p) => <span key={p.label} className={`hb-seg ${p.cls}`} style={{ width: `${(p.v / sum) * 100}%` }} title={`${p.label}${p.hint ? `: ${p.hint}` : ''}`} />)}
    </div>
  );
}
function Legend({ parts }) {
  return (
    <div className="hb-legend">
      {parts.map((p) => <span key={p.label} className="hb-leg"><i className={`hb-dot ${p.cls}`} />{p.label}<b>{p.hint}</b></span>)}
    </div>
  );
}

/** Zustand-Kachel auf der Übersicht: Laufzeit, CPU und RAM als „Server / System“, Knopf zur Detailansicht. */
export function HealthSummary({ s }) {
  const running = s.proc.state === 'running';
  const sys = useApi('/mc/system', [], { live: false, poll: true });
  const now = useNow(5000);
  const [open, setOpen] = useState(false);
  const d = sys.data;
  const cpu = running ? (s.proc.stats && s.proc.stats.cpu) || 0 : null;
  const mem = running ? (s.proc.stats && s.proc.stats.memory) || 0 : null;
  const sysMem = d ? d.totalMem - d.freeMem : null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="hb-tiles">
        <div className="hb-tile" title={T('CPU of this server / load of the whole PC')}>
          <div className="k"><Cpu size={13} />CPU <span className="tiny muted">{T(T('Server / system'))}</span></div>
          <div className="v">{pctText(cpu)} <span className="of">/ {pctText(d ? d.cpu : null)}</span></div>
          <StackBar total={100} parts={[{ v: cpu || 0, cls: 'c1', label: T('This server'), hint: pctText(cpu) }, { v: Math.max(0, ((d && d.cpu) || 0) - (cpu || 0)), cls: 'c3', label: T('Rest of the PC') }]} height={6} />
        </div>
        <div className="hb-tile" title={T('RAM of this server / used RAM of the whole PC')}>
          <div className="k"><MemoryStick size={13} />RAM <span className="tiny muted">{T(T('Server / system'))}</span></div>
          <div className="v">{gb(mem)} <span className="of">/ {gb(sysMem)}</span></div>
          <StackBar total={d ? d.totalMem : 1} parts={[{ v: mem || 0, cls: 'c1', label: T('This server'), hint: gb(mem) }, { v: Math.max(0, (sysMem || 0) - (mem || 0)), cls: 'c3', label: T('Rest of the PC') }]} height={6} />
          {d && <div className="tiny muted">{T(`of ${fmtBytes(d.totalMem)} in the PC`)}</div>}
        </div>
      </div>
      <div className="row-tight small">
        {running ? <span className="muted">{T('Running since')} {fmtDuration(now - s.proc.startedAt)}</span> : <span className="muted">{T('The server is stopped.')}</span>}
        <span className="grow" />
        <Btn className="xs" icon={ListTree} onClick={() => setOpen(true)}>Details</Btn>
      </div>
      {open && <HealthSheet s={s} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Gruppen der Bridge (Thread-Namen) → verständliche Namen
const GROUPS = {
  main: ['Game ticks (main thread)', 'Mobs, redstone, blocks and everything plugins do on the main thread. At 100 % of a core the TPS drop.'],
  chunks: ['Loading & generating chunks', 'Generating terrain, reading and saving chunks – high while exploring and pre-generating.'],
  network: ['Network', 'Player connections, packets, login.'],
  async: ['Plugin background tasks', 'Tasks plugins run alongside the game.'],
  log: ['Console & log', ''],
  other: ['Other', 'Other threads (e.g. watchdog, timers).'],
  jvm: ['Java internals (garbage collector, compiler)', 'Cleaning up memory and compiling code – rises when RAM runs short.'],
};
const POOLS = [
  [/eden|young/i, 'New objects'], [/survivor/i, 'Surviving objects'], [/old|tenured/i, 'Long-lived objects'],
  [/metaspace/i, 'Classes (Metaspace)'], [/compressed class/i, 'Class pointers'], [/code/i, 'Compiled code'],
];
const poolLabel = (n) => { const hit = POOLS.find(([re]) => re.test(n)); return hit ? hit[1] : n; };

/** Hinweise aus den Messwerten: was man tun kann, wenn etwas knapp ist. */
function tips(h) {
  const out = [];
  const j = h.jvm;
  if (j && j.heap && j.heap.max > 0 && j.heap.used / j.heap.max > 0.85) out.push(T(`Java memory is ${Math.round((j.heap.used / j.heap.max) * 100)} % full – raise “Max. RAM” under Settings → Memory & Java or lower the view distance.`));
  const main = j && (j.threads || []).find((g) => g.group === 'main');
  if (main && main.pct > 85) out.push(T(`The main thread is almost fully busy (${pctText(main.pct)} of a core) – lower view distance (${h.config.viewDistance || '?'}) and simulation distance (${h.config.simulationDistance || '?'}) or check for many mobs and redstone.`));
  if (h.system.totalMem && h.system.memUsed / h.system.totalMem > 0.92) out.push(T('The PC is almost out of free RAM – close other programs or give the server less RAM, otherwise Windows starts swapping and everything slows down.'));
  if (h.config.memMax > h.system.totalMem * 0.8) out.push(T('“Max. RAM” is more than 80 % of the PC’s memory – too little is left for Windows and other programs.'));
  const ents = j ? (j.worlds || []).reduce((n, w) => n + Math.max(0, w.entities || 0), 0) : 0;
  if (ents > 3000) out.push(T(`${ents} mobs and entities are loaded – many animals in a small space or items on the ground cost processing time.`));
  if (h.disk && h.disk.logs > 1024 ** 3) out.push(T(`Logs and crash reports take up ${fmtBytes(h.disk.logs)} – clean up under Files → logs.`));
  return out;
}

/** Detailansicht (Seitenblatt): fragt alle 4 s neu, solange sie offen ist. */
export function HealthSheet({ s, onClose }) {
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const [threads, setThreads] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let t = null;
    const tick = async () => {
      try { const d = await get(`/mc/servers/${s.id}/health?full=1`); if (alive.current) { setH(d); setErr(null); } } catch (e) { if (alive.current) setErr(e.message); }
      if (alive.current) t = setTimeout(tick, document.hidden ? 15000 : 4000);
    };
    tick();
    return () => { alive.current = false; clearTimeout(t); };
  }, [s.id]);
  const installBridge = async () => {
    try { await post(`/mc/servers/${s.id}/live-update/bridge`); toast.success(T('HostwerkBridge is in place – active after the next server restart.')); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); }
  };
  return (
    <SideSheet size="wide" title={T(`Health: ${s.name}`)} subtitle={T('What uses how much CPU, memory and disk space')} onClose={onClose}>
      {!h ? (err ? <Callout kind="err">{err}</Callout> : <Loading />) : <HealthBody h={h} s={s} threads={threads} setThreads={setThreads} installBridge={installBridge} />}
    </SideSheet>
  );
}

function HealthBody({ h, s, threads, setThreads, installBridge }) {
  const dimInfo = useDimInfo(s.id);
  const cores = h.system.cores || 1;
  const j = h.jvm;
  const othersCpu = h.others.reduce((n, o) => n + (o.cpu || 0), 0);
  const othersMem = h.others.reduce((n, o) => n + (o.memory || 0), 0);
  const sysCpu = h.system.cpu || 0;
  const restCpu = Math.max(0, sysCpu - h.proc.cpu - othersCpu);
  const pcCpu = [
    { v: h.proc.cpu, cls: 'c1', label: T('This server'), hint: pctText(h.proc.cpu) },
    { v: othersCpu, cls: 'c2', label: T('Other Hostwerk services'), hint: pctText(othersCpu) },
    { v: restCpu, cls: 'c3', label: T('Other programs'), hint: pctText(restCpu) },
  ];
  const hwMem = othersMem + (h.hostwerk || 0);
  const restMem = Math.max(0, h.system.memUsed - h.proc.memory - hwMem);
  const pcMem = [
    { v: h.proc.memory, cls: 'c1', label: T('This server'), hint: gb(h.proc.memory) },
    { v: hwMem, cls: 'c2', label: T('Hostwerk & other services'), hint: gb(hwMem) },
    { v: restMem, cls: 'c3', label: T('Other programs'), hint: gb(restMem) },
    { v: h.system.totalMem - h.system.memUsed, cls: 'c0', label: T('Free'), hint: gb(h.system.totalMem - h.system.memUsed) },
  ];
  // RAM des Servers: Heap belegt / reserviert, Nicht-Heap, Rest (Threads, Netzwerk-Puffer, native Bibliotheken)
  const rss = h.proc.memory || 0;
  const memParts = j ? [
    { v: j.heap.used, cls: 'c1', label: T('Java heap used'), hint: gb(j.heap.used) },
    { v: Math.max(0, j.heap.committed - j.heap.used), cls: 'c4', label: T('Heap reserved, currently free'), hint: gb(Math.max(0, j.heap.committed - j.heap.used)) },
    { v: j.nonHeap.committed, cls: 'c2', label: T('Classes & code'), hint: gb(j.nonHeap.committed) },
    { v: Math.max(0, rss - j.heap.committed - j.nonHeap.committed), cls: 'c3', label: T('Threads, buffers, libraries'), hint: gb(Math.max(0, rss - j.heap.committed - j.nonHeap.committed)) },
  ] : [];
  // CPU im Server: Gruppen der Bridge (100 = ein Kern) + Java intern als Rest der Prozess-CPU
  const groups = j ? (j.threads || []).filter((g) => g.pct != null) : [];
  const procCores = h.proc.cpu * cores; // Prozess-CPU in „% eines Kerns“
  const sumGroups = groups.reduce((n, g) => n + g.pct, 0);
  const cpuRows = groups.length ? [...groups, { group: 'jvm', pct: Math.max(0, procCores - sumGroups) }].sort((a, b) => b.pct - a.pct) : [];
  const maxRow = Math.max(100, ...cpuRows.map((r) => r.pct));
  const tipList = tips(h);
  const disk = h.disk;
  const diskParts = disk ? [
    { v: disk.worlds, cls: 'c1', label: T('Worlds'), hint: gb(disk.worlds) },
    { v: disk.plugins, cls: 'c2', label: s.content === 'mods' ? T('Mods') : T('Plugins'), hint: gb(disk.plugins) },
    { v: disk.libraries, cls: 'c4', label: T(T('Server software')), hint: gb(disk.libraries) },
    { v: disk.logs, cls: 'c5', label: T('Logs'), hint: gb(disk.logs) },
    { v: disk.other, cls: 'c3', label: T('Other'), hint: gb(disk.other) },
  ] : [];
  const plugins = j ? (j.plugins || []).filter((p) => p.tasks || p.workers || p.listeners).sort((a, b) => (b.workers * 10 + b.tasks) - (a.workers * 10 + a.tasks) || b.listeners - a.listeners) : [];
  return (
    <div className="stack hb-sheet">
      <div className="row-tight"><StatusPill state={s.proc.state} /><span className="tiny muted">{T('Updates every few seconds.')}</span></div>
      {tipList.length > 0 && <Callout kind="warn" icon={Lightbulb} title={T('What would help')}>{tipList.map((t, i) => <div key={i}>{t}</div>)}</Callout>}

      <section className="hb-sec">
        <h4><Cpu size={15} />{T('CPU of the PC')} <span className="muted">{pctText(sysCpu)} · {T(`${cores} cores`)}</span></h4>
        <StackBar total={100} parts={pcCpu} />
        <Legend parts={pcCpu} />
        <h4><MemoryStick size={15} />{T('Memory of the PC')} <span className="muted">{gb(h.system.memUsed)} / {gb(h.system.totalMem)}</span></h4>
        <StackBar total={h.system.totalMem} parts={pcMem} />
        <Legend parts={pcMem} />
        {h.others.length > 0 && (
          <div className="hb-list">
            {[...h.others].sort((a, b) => b.memory - a.memory).slice(0, 6).map((o) => <div key={o.id} className="hb-row"><span className="grow ellipsis">{o.name}</span><span className="mono tiny">{pctText(o.cpu)}</span><span className="mono tiny">{gb(o.memory)}</span></div>)}
          </div>
        )}
      </section>

      {!h.running ? <Callout kind="info">{T('The server is stopped – the CPU and memory breakdown appears once it is running.')}</Callout> : !j && (
        <Callout kind="info" icon={Info} dismissible={false} title={h.bridgeStats ? T('Values from the server are on their way …') : T('More detail with HostwerkBridge')}>
          {h.bridgeStats ? T('The bridge answers once the world has loaded.') : <>{T('Without Hostwerk’s helper plugin, Hostwerk only sees the whole process. With HostwerkBridge (1.2 or newer) you see Java memory, CPU per task, worlds and plugins.')}{s.pluginsSupported && <div style={{ marginTop: 6 }}><Btn className="xs primary" icon={Download} onClick={installBridge}>{h.bridge ? T('Update bridge') : T('Install bridge')}</Btn></div>}</>}
        </Callout>
      )}

      {h.running && (
        <section className="hb-sec">
          <h4><MemoryStick size={15} />{T('Memory of the server')} <span className="muted">{gb(rss)}{j ? ` · ${T('Heap limit')} ${gb(j.heap.max)}` : ` · ${T('Max. RAM')} ${gb(h.config.memMax)}`}</span></h4>
          {j ? <>
            <StackBar total={Math.max(rss, j.heap.committed + j.nonHeap.committed)} parts={memParts} />
            <Legend parts={memParts} />
            <div className="hb-meter">
              <span className="small">{T('Java heap used')}</span>
              <div className="hb-bar thin"><span className={`hb-seg ${j.heap.used / j.heap.max > 0.85 ? 'warn' : 'c1'}`} style={{ width: `${Math.min(100, (j.heap.used / Math.max(1, j.heap.max)) * 100)}%` }} /></div>
              <span className="mono tiny">{Math.round((j.heap.used / Math.max(1, j.heap.max)) * 100)} %</span>
            </div>
            <div className="hb-list">
              {/* Bereiche mit gleichem Namen zusammenfassen (z. B. drei Code-Cache-Bereiche → „Übersetzter Code“) */}
              {Object.values((j.pools || []).filter((p) => p.used > 0).reduce((acc, p) => { const l = poolLabel(p.name); const x = acc[l] || (acc[l] = { label: l, used: 0, heap: p.heap, names: [] }); x.used += p.used; x.names.push(p.name); return acc; }, {})).sort((a, b) => b.used - a.used).map((p) => <div key={p.label} className="hb-row" title={p.names.join(', ')}><span className="grow ellipsis">{T(p.label)} {p.heap && <span className="tiny muted">Heap</span>}</span><span className="mono tiny">{gb(p.used)}</span></div>)}
            </div>
            {(j.gc || []).length > 0 && <div className="tiny muted">{T('Garbage collector')}: {(j.gc || []).map((g) => `${g.name} ${g.count}× (${String(Math.round(g.ms / 100) / 10).replace('.', ',')} s)`).join(' · ')}</div>}
          </> : <StackBar total={h.config.memMax} parts={[{ v: rss, cls: 'c1', label: T('Process'), hint: gb(rss) }]} />}
        </section>
      )}

      {cpuRows.length > 0 && (
        <section className="hb-sec">
          <h4><Gauge size={15} />{T('CPU of the server')} <span className="muted">{pctText(procCores)} {T('of one core')} · {pctText(h.proc.cpu)} {T('of the PC')}</span></h4>
          <div className="hb-list">
            {cpuRows.map((r) => {
              const g = r.group.startsWith('plugin:') ? [`Plugin: ${r.group.slice(7)}`, T('This plugin’s own threads.')] : GROUPS[r.group] || [r.group, ''];
              return (
                <div key={r.group} className="hb-row cpu" title={g[1] ? T(g[1]) : undefined}>
                  <span className="hb-name ellipsis">{T(g[0])}{r.count ? <span className="tiny muted"> · {r.count}</span> : null}</span>
                  <div className="hb-bar thin grow"><span className={`hb-seg ${r.group === 'main' && r.pct > 85 ? 'warn' : r.group === 'jvm' ? 'c4' : 'c1'}`} style={{ width: `${Math.min(100, (r.pct / maxRow) * 100)}%` }} /></div>
                  <span className="mono tiny hb-num">{pctText(r.pct)}</span>
                </div>
              );
            })}
          </div>
          <div className="tiny muted">{T('100 % = one full CPU core. Plugins working on the main thread count as game ticks – the “spark” plugin measures each plugin exactly.')}</div>
          {(j.topThreads || []).length > 0 && <button type="button" className="link-btn tiny" onClick={() => setThreads(!threads)}>{threads ? T('Hide individual threads') : T('Show individual threads')}</button>}
          {threads && <div className="hb-list">{j.topThreads.map((t) => <div key={t.name} className="hb-row"><span className="grow ellipsis mono tiny" title={t.name}>{t.name}</span><span className="mono tiny">{pctText(t.pct)}</span></div>)}</div>}
        </section>
      )}

      {j && (j.worlds || []).length > 0 && (
        <section className="hb-sec">
          <h4><Globe2 size={15} />{T('Worlds')} <span className="muted">{T(`${j.players} players online`)}</span></h4>
          <table className="table compact">
            <thead><tr><th>{T('Dimension')}</th><th className="num">Chunks</th><th className="num">{T('Mobs & entities')}</th><th className="num">{T('Block entities')}</th><th className="num">{T('Players')}</th></tr></thead>
            <tbody>{j.worlds.map((w) => {
              const key = /:/.test(w.key || '') ? w.key : { normal: 'minecraft:overworld', nether: 'minecraft:the_nether', the_end: 'minecraft:the_end' }[w.env] || `custom:${w.name}`;
              return <tr key={w.name}><td><span className="row-tight"><McDimIcon id={key} info={dimInfo(key)} size={20} /><span>{dimLabel(key, dimInfo(key))}</span><span className="tiny muted mono">{w.name}</span></span></td><td className="num">{w.chunks >= 0 ? w.chunks : '–'}</td><td className="num">{w.entities >= 0 ? w.entities : '–'}</td><td className="num">{w.tiles >= 0 ? w.tiles : '–'}</td><td className="num">{w.players}</td></tr>;
            })}</tbody>
          </table>
          {(j.entityTypes || []).length > 0 && <div className="hb-chips">{j.entityTypes.map((e) => <span key={e.type} className="badge">{e.type.replace(/_/g, ' ')} <b>{e.count}</b></span>)}</div>}
        </section>
      )}

      {plugins.length > 0 && (
        <section className="hb-sec">
          <h4><Puzzle size={15} />Plugins <span className="muted">{T(`${(j.plugins || []).length} pulled`)}</span></h4>
          <table className="table compact">
            <thead><tr><th>Plugin</th><th className="num" title={T('Repeating or scheduled tasks')}>{T('Tasks')}</th><th className="num" title={T('Background tasks running right now')}>{T('In background')}</th><th className="num" title={T('How many game events the plugin reacts to')}>Listener</th></tr></thead>
            <tbody>{plugins.slice(0, 30).map((p) => <tr key={p.name} style={{ opacity: p.enabled ? 1 : 0.55 }}><td>{p.name}</td><td className="num">{p.tasks}</td><td className="num">{p.workers}</td><td className="num">{p.listeners}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {disk && (
        <section className="hb-sec">
          <h4><HardDrive size={15} />{T('Disk space')} <span className="muted">{gb(disk.total)}{disk.backups ? ` · ${T('Backups')} ${gb(disk.backups)}` : ''}</span></h4>
          <StackBar total={disk.total} parts={diskParts} />
          <Legend parts={diskParts} />
        </section>
      )}
    </div>
  );
}
