import { useEffect, useRef, useState } from 'react';
import { Gauge, Cpu, MemoryStick, HardDrive, Globe2, Puzzle, Lightbulb, ListTree, Download, Info } from 'lucide-react';
import { get, post, useApi, fmtBytes, fmtDuration } from '@hostwerk/api';
import { Btn, SideSheet, Loading, Callout, StatusPill, toast, useNow } from '@hostwerk/ui';
import McDimIcon, { dimLabel, useDimInfo } from './McDimIcon';
import { tr } from '@hostwerk/kit';

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
        <div className="hb-tile" title={tr('CPU dieses Servers / Auslastung des ganzen PCs')}>
          <div className="k"><Cpu size={13} />CPU <span className="tiny muted">{tr('Server / System')}</span></div>
          <div className="v">{pctText(cpu)} <span className="of">/ {pctText(d ? d.cpu : null)}</span></div>
          <StackBar total={100} parts={[{ v: cpu || 0, cls: 'c1', label: tr('Dieser Server'), hint: pctText(cpu) }, { v: Math.max(0, ((d && d.cpu) || 0) - (cpu || 0)), cls: 'c3', label: tr('Rest des PCs') }]} height={6} />
        </div>
        <div className="hb-tile" title={tr('RAM dieses Servers / belegter RAM des ganzen PCs')}>
          <div className="k"><MemoryStick size={13} />RAM <span className="tiny muted">{tr('Server / System')}</span></div>
          <div className="v">{gb(mem)} <span className="of">/ {gb(sysMem)}</span></div>
          <StackBar total={d ? d.totalMem : 1} parts={[{ v: mem || 0, cls: 'c1', label: tr('Dieser Server'), hint: gb(mem) }, { v: Math.max(0, (sysMem || 0) - (mem || 0)), cls: 'c3', label: tr('Rest des PCs') }]} height={6} />
          {d && <div className="tiny muted">{tr(`von ${fmtBytes(d.totalMem)} im PC`)}</div>}
        </div>
      </div>
      <div className="row-tight small">
        {running ? <span className="muted">{tr('Läuft seit')} {fmtDuration(now - s.proc.startedAt)}</span> : <span className="muted">{tr('Der Server ist gestoppt.')}</span>}
        <span className="grow" />
        <Btn className="xs" icon={ListTree} onClick={() => setOpen(true)}>Details</Btn>
      </div>
      {open && <HealthSheet s={s} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Gruppen der Bridge (Thread-Namen) → verständliche Namen
const GROUPS = {
  main: ['Spiel-Ticks (Haupt-Thread)', 'Kreaturen, Redstone, Blöcke und alles, was Plugins im Haupt-Thread tun. Bei 100 % eines Kerns sinken die TPS.'],
  chunks: ['Chunks laden & erzeugen', 'Gelände erzeugen, Chunks lesen und speichern – hoch beim Erkunden und Vorgenerieren.'],
  network: ['Netzwerk', 'Verbindungen der Spieler, Pakete, Anmeldung.'],
  async: ['Plugin-Hintergrundaufgaben', 'Aufgaben, die Plugins neben dem Spiel laufen lassen.'],
  log: ['Konsole & Protokoll', ''],
  other: ['Sonstiges', 'Weitere Threads (z. B. Wächter, Zeitgeber).'],
  jvm: ['Java intern (Müllsammler, Übersetzer)', 'Speicher aufräumen und Code übersetzen – steigt, wenn der RAM knapp wird.'],
};
const POOLS = [
  [/eden|young/i, 'Neue Objekte'], [/survivor/i, 'Überlebende Objekte'], [/old|tenured/i, 'Langlebige Objekte'],
  [/metaspace/i, 'Klassen (Metaspace)'], [/compressed class/i, 'Klassen-Zeiger'], [/code/i, 'Übersetzter Code'],
];
const poolLabel = (n) => { const hit = POOLS.find(([re]) => re.test(n)); return hit ? hit[1] : n; };

/** Hinweise aus den Messwerten: was man tun kann, wenn etwas knapp ist. */
function tips(h) {
  const out = [];
  const j = h.jvm;
  if (j && j.heap && j.heap.max > 0 && j.heap.used / j.heap.max > 0.85) out.push(tr(`Der Java-Speicher ist zu ${Math.round((j.heap.used / j.heap.max) * 100)} % voll – erhöhe „Max. RAM“ unter Einstellungen → Speicher & Java oder verringere die Sichtweite.`));
  const main = j && (j.threads || []).find((g) => g.group === 'main');
  if (main && main.pct > 85) out.push(tr(`Der Haupt-Thread ist fast voll ausgelastet (${pctText(main.pct)} eines Kerns) – Sichtweite (${h.config.viewDistance || '?'}) und Simulationsweite (${h.config.simulationDistance || '?'}) verringern oder viele Kreaturen und Redstone prüfen.`));
  if (h.system.totalMem && h.system.memUsed / h.system.totalMem > 0.92) out.push(tr('Der PC hat kaum noch freien RAM – andere Programme schließen oder dem Server weniger RAM geben, sonst lagert Windows aus und alles wird langsam.'));
  if (h.config.memMax > h.system.totalMem * 0.8) out.push(tr('„Max. RAM“ ist größer als 80 % des PC-Speichers – für Windows und andere Programme bleibt zu wenig.'));
  const ents = j ? (j.worlds || []).reduce((n, w) => n + Math.max(0, w.entities || 0), 0) : 0;
  if (ents > 3000) out.push(tr(`${ents} Kreaturen und Objekte sind geladen – viele Tiere auf engem Raum oder liegende Gegenstände kosten Rechenzeit.`));
  if (h.disk && h.disk.logs > 1024 ** 3) out.push(tr(`Protokolle und Absturzberichte belegen ${fmtBytes(h.disk.logs)} – unter Dateien → logs aufräumen.`));
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
    try { await post(`/mc/servers/${s.id}/live-update/bridge`); toast.success(tr('HostwerkBridge liegt bereit – aktiv nach dem nächsten Neustart des Servers.')); window.dispatchEvent(new CustomEvent('hw:mc-plugins', { detail: { id: s.id } })); } catch (e) { toast.error(e.message); }
  };
  return (
    <SideSheet size="wide" title={tr(`Zustand: ${s.name}`)} subtitle={tr('Was wie viel CPU, Arbeitsspeicher und Platz braucht')} onClose={onClose}>
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
    { v: h.proc.cpu, cls: 'c1', label: tr('Dieser Server'), hint: pctText(h.proc.cpu) },
    { v: othersCpu, cls: 'c2', label: tr('Andere Hostwerk-Dienste'), hint: pctText(othersCpu) },
    { v: restCpu, cls: 'c3', label: tr('Andere Programme'), hint: pctText(restCpu) },
  ];
  const hwMem = othersMem + (h.hostwerk || 0);
  const restMem = Math.max(0, h.system.memUsed - h.proc.memory - hwMem);
  const pcMem = [
    { v: h.proc.memory, cls: 'c1', label: tr('Dieser Server'), hint: gb(h.proc.memory) },
    { v: hwMem, cls: 'c2', label: tr('Hostwerk & andere Dienste'), hint: gb(hwMem) },
    { v: restMem, cls: 'c3', label: tr('Andere Programme'), hint: gb(restMem) },
    { v: h.system.totalMem - h.system.memUsed, cls: 'c0', label: tr('Frei'), hint: gb(h.system.totalMem - h.system.memUsed) },
  ];
  // RAM des Servers: Heap belegt / reserviert, Nicht-Heap, Rest (Threads, Netzwerk-Puffer, native Bibliotheken)
  const rss = h.proc.memory || 0;
  const memParts = j ? [
    { v: j.heap.used, cls: 'c1', label: tr('Java-Heap belegt'), hint: gb(j.heap.used) },
    { v: Math.max(0, j.heap.committed - j.heap.used), cls: 'c4', label: tr('Heap reserviert, gerade frei'), hint: gb(Math.max(0, j.heap.committed - j.heap.used)) },
    { v: j.nonHeap.committed, cls: 'c2', label: tr('Klassen & Code'), hint: gb(j.nonHeap.committed) },
    { v: Math.max(0, rss - j.heap.committed - j.nonHeap.committed), cls: 'c3', label: tr('Threads, Puffer, Bibliotheken'), hint: gb(Math.max(0, rss - j.heap.committed - j.nonHeap.committed)) },
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
    { v: disk.worlds, cls: 'c1', label: tr('Welten'), hint: gb(disk.worlds) },
    { v: disk.plugins, cls: 'c2', label: s.content === 'mods' ? tr('Mods') : tr('Plugins'), hint: gb(disk.plugins) },
    { v: disk.libraries, cls: 'c4', label: tr('Server-Software'), hint: gb(disk.libraries) },
    { v: disk.logs, cls: 'c5', label: tr('Protokolle'), hint: gb(disk.logs) },
    { v: disk.other, cls: 'c3', label: tr('Sonstiges'), hint: gb(disk.other) },
  ] : [];
  const plugins = j ? (j.plugins || []).filter((p) => p.tasks || p.workers || p.listeners).sort((a, b) => (b.workers * 10 + b.tasks) - (a.workers * 10 + a.tasks) || b.listeners - a.listeners) : [];
  return (
    <div className="stack hb-sheet">
      <div className="row-tight"><StatusPill state={s.proc.state} /><span className="tiny muted">{tr('Aktualisiert sich alle paar Sekunden.')}</span></div>
      {tipList.length > 0 && <Callout kind="warn" icon={Lightbulb} title={tr('Was helfen würde')}>{tipList.map((t, i) => <div key={i}>{t}</div>)}</Callout>}

      <section className="hb-sec">
        <h4><Cpu size={15} />{tr('CPU des PCs')} <span className="muted">{pctText(sysCpu)} · {tr(`${cores} Kerne`)}</span></h4>
        <StackBar total={100} parts={pcCpu} />
        <Legend parts={pcCpu} />
        <h4><MemoryStick size={15} />{tr('Arbeitsspeicher des PCs')} <span className="muted">{gb(h.system.memUsed)} / {gb(h.system.totalMem)}</span></h4>
        <StackBar total={h.system.totalMem} parts={pcMem} />
        <Legend parts={pcMem} />
        {h.others.length > 0 && (
          <div className="hb-list">
            {[...h.others].sort((a, b) => b.memory - a.memory).slice(0, 6).map((o) => <div key={o.id} className="hb-row"><span className="grow ellipsis">{o.name}</span><span className="mono tiny">{pctText(o.cpu)}</span><span className="mono tiny">{gb(o.memory)}</span></div>)}
          </div>
        )}
      </section>

      {!h.running ? <Callout kind="info">{tr('Der Server ist gestoppt – die Aufschlüsselung von CPU und Arbeitsspeicher erscheint, sobald er läuft.')}</Callout> : !j && (
        <Callout kind="info" icon={Info} dismissible={false} title={h.bridgeStats ? tr('Werte aus dem Server kommen gleich …') : tr('Genauere Werte mit der HostwerkBridge')}>
          {h.bridgeStats ? tr('Die Bridge antwortet nach dem Laden der Welt.') : <>{tr('Ohne Hostwerks Helfer-Plugin sieht Hostwerk nur den ganzen Prozess. Mit HostwerkBridge (1.2 oder neuer) siehst du Java-Speicher, CPU je Aufgabe, Welten und Plugins.')}{s.pluginsSupported && <div style={{ marginTop: 6 }}><Btn className="xs primary" icon={Download} onClick={installBridge}>{h.bridge ? tr('Bridge aktualisieren') : tr('Bridge installieren')}</Btn></div>}</>}
        </Callout>
      )}

      {h.running && (
        <section className="hb-sec">
          <h4><MemoryStick size={15} />{tr('Arbeitsspeicher des Servers')} <span className="muted">{gb(rss)}{j ? ` · ${tr('Heap-Grenze')} ${gb(j.heap.max)}` : ` · ${tr('Max. RAM')} ${gb(h.config.memMax)}`}</span></h4>
          {j ? <>
            <StackBar total={Math.max(rss, j.heap.committed + j.nonHeap.committed)} parts={memParts} />
            <Legend parts={memParts} />
            <div className="hb-meter">
              <span className="small">{tr('Java-Heap belegt')}</span>
              <div className="hb-bar thin"><span className={`hb-seg ${j.heap.used / j.heap.max > 0.85 ? 'warn' : 'c1'}`} style={{ width: `${Math.min(100, (j.heap.used / Math.max(1, j.heap.max)) * 100)}%` }} /></div>
              <span className="mono tiny">{Math.round((j.heap.used / Math.max(1, j.heap.max)) * 100)} %</span>
            </div>
            <div className="hb-list">
              {/* Bereiche mit gleichem Namen zusammenfassen (z. B. drei Code-Cache-Bereiche → „Übersetzter Code“) */}
              {Object.values((j.pools || []).filter((p) => p.used > 0).reduce((acc, p) => { const l = poolLabel(p.name); const x = acc[l] || (acc[l] = { label: l, used: 0, heap: p.heap, names: [] }); x.used += p.used; x.names.push(p.name); return acc; }, {})).sort((a, b) => b.used - a.used).map((p) => <div key={p.label} className="hb-row" title={p.names.join(', ')}><span className="grow ellipsis">{tr(p.label)} {p.heap && <span className="tiny muted">Heap</span>}</span><span className="mono tiny">{gb(p.used)}</span></div>)}
            </div>
            {(j.gc || []).length > 0 && <div className="tiny muted">{tr('Müllsammler')}: {(j.gc || []).map((g) => `${g.name} ${g.count}× (${String(Math.round(g.ms / 100) / 10).replace('.', ',')} s)`).join(' · ')}</div>}
          </> : <StackBar total={h.config.memMax} parts={[{ v: rss, cls: 'c1', label: tr('Prozess'), hint: gb(rss) }]} />}
        </section>
      )}

      {cpuRows.length > 0 && (
        <section className="hb-sec">
          <h4><Gauge size={15} />{tr('CPU des Servers')} <span className="muted">{pctText(procCores)} {tr('eines Kerns')} · {pctText(h.proc.cpu)} {tr('des PCs')}</span></h4>
          <div className="hb-list">
            {cpuRows.map((r) => {
              const g = r.group.startsWith('plugin:') ? [`Plugin: ${r.group.slice(7)}`, 'Eigene Threads dieses Plugins.'] : GROUPS[r.group] || [r.group, ''];
              return (
                <div key={r.group} className="hb-row cpu" title={g[1] ? tr(g[1]) : undefined}>
                  <span className="hb-name ellipsis">{tr(g[0])}{r.count ? <span className="tiny muted"> · {r.count}</span> : null}</span>
                  <div className="hb-bar thin grow"><span className={`hb-seg ${r.group === 'main' && r.pct > 85 ? 'warn' : r.group === 'jvm' ? 'c4' : 'c1'}`} style={{ width: `${Math.min(100, (r.pct / maxRow) * 100)}%` }} /></div>
                  <span className="mono tiny hb-num">{pctText(r.pct)}</span>
                </div>
              );
            })}
          </div>
          <div className="tiny muted">{tr('100 % = ein voller CPU-Kern. Plugins, die im Haupt-Thread arbeiten, zählen zu den Spiel-Ticks – genau je Plugin misst das Plugin „spark“.')}</div>
          {(j.topThreads || []).length > 0 && <button type="button" className="link-btn tiny" onClick={() => setThreads(!threads)}>{threads ? tr('Einzelne Threads ausblenden') : tr('Einzelne Threads zeigen')}</button>}
          {threads && <div className="hb-list">{j.topThreads.map((t) => <div key={t.name} className="hb-row"><span className="grow ellipsis mono tiny" title={t.name}>{t.name}</span><span className="mono tiny">{pctText(t.pct)}</span></div>)}</div>}
        </section>
      )}

      {j && (j.worlds || []).length > 0 && (
        <section className="hb-sec">
          <h4><Globe2 size={15} />{tr('Welten')} <span className="muted">{tr(`${j.players} Spieler online`)}</span></h4>
          <table className="table compact">
            <thead><tr><th>{tr('Dimension')}</th><th className="num">Chunks</th><th className="num">{tr('Kreaturen & Objekte')}</th><th className="num">{tr('Blockobjekte')}</th><th className="num">{tr('Spieler')}</th></tr></thead>
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
          <h4><Puzzle size={15} />Plugins <span className="muted">{tr(`${(j.plugins || []).length} geladen`)}</span></h4>
          <table className="table compact">
            <thead><tr><th>Plugin</th><th className="num" title={tr('Wiederkehrende bzw. geplante Aufgaben')}>{tr('Aufgaben')}</th><th className="num" title={tr('Gerade laufende Hintergrund-Aufgaben')}>{tr('Im Hintergrund')}</th><th className="num" title={tr('Auf wie viele Spiel-Ereignisse das Plugin reagiert')}>Listener</th></tr></thead>
            <tbody>{plugins.slice(0, 30).map((p) => <tr key={p.name} style={{ opacity: p.enabled ? 1 : 0.55 }}><td>{p.name}</td><td className="num">{p.tasks}</td><td className="num">{p.workers}</td><td className="num">{p.listeners}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {disk && (
        <section className="hb-sec">
          <h4><HardDrive size={15} />{tr('Speicherplatz')} <span className="muted">{gb(disk.total)}{disk.backups ? ` · ${tr('Sicherungen')} ${gb(disk.backups)}` : ''}</span></h4>
          <StackBar total={disk.total} parts={diskParts} />
          <Legend parts={diskParts} />
        </section>
      )}
    </div>
  );
}
