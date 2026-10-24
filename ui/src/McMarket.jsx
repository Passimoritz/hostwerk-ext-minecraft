import { useEffect, useRef, useState } from 'react';
import { Search, Download, Star, CheckCircle2, ExternalLink, Store, Puzzle, Clock, Image as ImageIcon, FileText, ListOrdered, Link2 } from 'lucide-react';
import { get, post, waitJob, fmtNumber, fmtDate, openExternal } from '@hostwerk/api';
import { Btn, Seg, Tabs, Modal, Loading, Empty, Callout, toast, InfoTip } from '@hostwerk/ui';
import { Markdown } from '@hostwerk/kit';
import { LazyImg } from '@hostwerk/kit';

const SRC = { modrinth: { label: 'Modrinth', color: '#1bd96a' }, hangar: { label: 'Hangar', color: '#3b82f6' } };
const ago = (d) => {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400e3);
  return days < 1 ? 'heute' : days < 30 ? `vor ${days} T.` : days < 365 ? `vor ${Math.floor(days / 30)} Mon.` : `vor ${Math.floor(days / 365)} J.`;
};

function SourceBadge({ source, also }) {
  return (
    <span className="row-tight" style={{ gap: 4 }}>
      {[source, also].filter(Boolean).map((x) => <span key={x} className="badge" style={{ color: SRC[x].color, borderColor: SRC[x].color + '55' }}>{SRC[x].label}</span>)}
    </span>
  );
}

/* ---------------------------------------------------------------- Detailansicht */
function Detail({ s, hit, onClose, onInstalled }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('about');
  const [ver, setVer] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get(`/mc/servers/${s.id}/market/${hit.source}/${encodeURIComponent(hit.id)}`).then((x) => { setD(x); setVer(x.recommended || (x.versions[0] && x.versions[0].id) || ''); }).catch((e) => { toast.error(e.message); onClose(); });
  }, [hit.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const install = async () => {
    setBusy(true);
    try {
      const r = await post(`/mc/servers/${s.id}/market/install`, { source: d.source, id: d.id, version: ver });
      const j = await waitJob(r.job);
      toast.success(`${j.result.title} ${j.result.version} ${j.result.mode === 'queued' ? 'wartet – wird beim nächsten Stopp oder Neustart eingespielt' : j.result.mode === 'hot' ? 'live ausgetauscht, ohne Neustart' : `installiert${j.result.needsRestart ? ' – wirkt nach einem Neustart (oder Live-Update)' : ''}`}`);
      onInstalled && onInstalled();
      onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const v = d && d.versions.find((x) => x.id === ver);
  return (
    <Modal size="wide" onClose={onClose} title={<span className="row-tight" style={{ gap: 10 }}>{hit.icon ? <LazyImg src={hit.icon} style={{ width: 32, height: 32, borderRadius: 8 }} /> : <Puzzle size={22} />}{hit.title}</span>}
      subtitle={d ? `von ${d.author || hit.author} · ${fmtNumber(d.downloads)} Downloads${d.license ? ` · Lizenz ${d.license}` : ''} · aktualisiert ${ago(d.updated)}` : hit.description}
      footer={d && (
        <div className="row grow" style={{ gap: 8, flexWrap: 'wrap' }}>
          {d.installed && <span className="badge ok"><CheckCircle2 size={12} /> installiert{d.installed.version ? ` (${d.installed.version})` : ''}</span>}
          <div className="grow" />
          {d.versions.length > 0 ? <>
            <select className="input" style={{ width: 'auto', maxWidth: 320 }} value={ver} onChange={(e) => setVer(e.target.value)}>
              {d.versions.map((x) => <option key={x.id} value={x.id}>{x.number}{x.type !== 'release' ? ` (${x.channel || x.type})` : ''}{x.id === d.recommended ? ' – empfohlen' : ''}{!x.fits ? ' – nicht für ' + (d.serverVersion || 'diese Version') : ''}</option>)}
            </select>
            <Btn className="primary" icon={Download} busy={busy} disabled={!ver} onClick={install}>{d.installed ? 'Diese Version installieren' : 'Installieren'}</Btn>
          </> : <span className="small muted">Keine Version für diesen Servertyp verfügbar.</span>}
        </div>
      )}>
      {!d ? <Loading /> : (
        <div className="stack" style={{ gap: 12 }}>
          {d.compat && d.compat.known && d.compat.status === 'too-new' && <Callout kind="warn" title={`Nur bis Minecraft ${d.compat.max}`}>{d.title} unterstützt Minecraft {d.compat.min} bis {d.compat.max}, dein Server läuft mit {d.compat.serverVersion}. Es kann trotzdem laufen – oft aber erst mit einem Update des Plugins.</Callout>}
          {d.compat && d.compat.known && d.compat.status === 'other' && <Callout kind="warn" title={`Nicht für Minecraft ${d.compat.serverVersion} angegeben`}>Unterstützte Versionen: {d.compat.min} bis {d.compat.max}.</Callout>}
          {d.compat && d.compat.known && d.compat.status === 'ok' && <div className="small muted">{`Unterstützt Minecraft ${d.compat.min === d.compat.max ? d.compat.min : `${d.compat.min} bis ${d.compat.max}`} – passt zu deinem Server.`}</div>}
          {v && !v.fits && <Callout kind="warn">Version {v.number} ist nicht ausdrücklich für {d.serverVersion} freigegeben – kann trotzdem laufen.</Callout>}
          {v && v.external && <InfoTip>Diese Version wird über die Seite des Herstellers geladen. Hostwerk prüft, ob wirklich eine Plugin-JAR ankommt.</InfoTip>}
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'about', label: 'Beschreibung', icon: FileText },
            { id: 'versions', label: 'Versionen', icon: ListOrdered, badge: d.versions.length },
            ...(d.gallery.length ? [{ id: 'gallery', label: 'Bilder', icon: ImageIcon, badge: d.gallery.length }] : []),
            { id: 'links', label: 'Links', icon: Link2 },
          ]} />
          {tab === 'about' && <div style={{ maxHeight: '52vh', overflow: 'auto' }}>{d.body ? <Markdown text={d.body} /> : <p className="muted">{d.description}</p>}</div>}
          {tab === 'versions' && (
            <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
              {d.versions.map((x) => (
                <div key={x.id} className="list-item" style={{ alignItems: 'flex-start', cursor: 'pointer', background: x.id === ver ? 'var(--accent-soft)' : undefined }} onClick={() => setVer(x.id)}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row-tight" style={{ gap: 6, flexWrap: 'wrap' }}><b>{x.number}</b>{x.type !== 'release' && <span className="badge warn">{x.channel || x.type}</span>}{x.fits ? <span className="badge ok">passt zu {d.serverVersion || 'deinem Server'}</span> : <span className="badge">nicht für {d.serverVersion}</span>}{x.id === d.recommended && <span className="badge accent">empfohlen</span>}</div>
                    <div className="tiny muted">{fmtDate(x.date)}{x.downloads != null ? ` · ${fmtNumber(x.downloads)} Downloads` : ''} · Minecraft {x.gameVersions.length > 6 ? `${x.gameVersions[x.gameVersions.length - 1]} … ${x.gameVersions[0]}` : x.gameVersions.join(', ')}</div>
                    {x.changelog && <div className="small" style={{ marginTop: 6, maxHeight: 140, overflow: 'auto' }}><Markdown text={x.changelog} maxBlocks={30} /></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'gallery' && <div className="grid grid-2" style={{ maxHeight: '52vh', overflow: 'auto' }}>{d.gallery.map((g) => <figure key={g.url} style={{ margin: 0 }}><LazyImg src={g.url} alt={g.title || ''} fit="contain" style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 10 }} />{g.title && <figcaption className="tiny muted">{g.title}</figcaption>}</figure>)}</div>}
          {tab === 'links' && <div className="stack" style={{ gap: 6 }}>{d.links.map((l) => <a key={l.url} href={l.url} onClick={(e) => { e.preventDefault(); openExternal(l.url); }} className="row-tight"><ExternalLink size={13} />{l.label} <span className="tiny muted">{l.url}</span></a>)}</div>}
        </div>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- Marktplatz */
export default function MarketTab({ s, onInstalled }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('downloads');
  const [data, setData] = useState(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(null);
  const seq = useRef(0);
  const load = async (p = 0) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, source, category, sort, page: String(p) });
      const r = await get(`/mc/servers/${s.id}/market?${params}`);
      if (my !== seq.current) return;
      setData((old) => (p > 0 && old ? { ...r, hits: [...old.hits, ...r.hits.filter((h) => !old.hits.some((o) => o.source === h.source && o.id === h.id))] } : r));
      setPage(p);
    } catch (e) { toast.error(e.message); }
    if (my === seq.current) setLoading(false);
  };
  useEffect(() => { load(0); }, [s.id, query, source, category, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s.pluginsSupported) return <Empty icon={Puzzle} title="Vanilla unterstützt keine Plugins" text="Wechsle unter „Version“ auf Paper oder Purpur, um Plugins zu nutzen – deine Welt bleibt erhalten." />;
  const cats = data ? data.categories.filter((c) => source === 'all' || c.sources.includes(source)) : [];
  return (
    <div className="market">
      <aside className="market-side card">
        <div className="card-body stack" style={{ gap: 14 }}>
          <div>
            <div className="tiny muted bold" style={{ marginBottom: 6 }}>QUELLE</div>
            <Seg value={source} onChange={(v) => { setSource(v); setCategory(''); }} options={[{ id: 'all', label: 'Alle' }, { id: 'modrinth', label: 'Modrinth' }, ...(!data || data.hangar ? [{ id: 'hangar', label: 'Hangar' }] : [])]} />
          </div>
          <div>
            <div className="tiny muted bold" style={{ marginBottom: 6 }}>KATEGORIE</div>
            <div className="market-cats">
              <button className={!category ? 'active' : ''} onClick={() => setCategory('')}>Alle Kategorien</button>
              {cats.map((c) => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}>{c.label}</button>)}
            </div>
          </div>
          {s.content === 'mods'
            ? <div className="tiny muted">Gezeigt werden nur Mods für <b>{s.typeLabel} {s.version}</b>, die auf einem Server laufen. Modrinth ist die offizielle, geprüfte Mod-Seite der Community.</div>
            : <div className="tiny muted">Gezeigt werden nur Plugins für <b>{s.typeLabel} {s.version}</b>. Modrinth und Hangar sind die offiziellen, geprüften Plugin-Seiten der Community.</div>}
        </div>
      </aside>
      <div className="stack" style={{ minWidth: 0 }}>
        <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); if (q.trim() && sort === 'downloads') setSort('relevance'); }}>
          <div className="input-icon grow" style={{ minWidth: 220 }}><Search /><input className="input" placeholder={s.content === 'mods' ? 'Mods suchen – z. B. Create, Lithium, Terralith …' : 'Plugins suchen – z. B. LuckPerms, WorldEdit, Shop …'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="relevance">Beste Treffer</option>
            <option value="downloads">Meiste Downloads</option>
            <option value="updated">Zuletzt aktualisiert</option>
            <option value="newest">Neueste</option>
          </select>
          <Btn className="primary" busy={loading && page === 0} onClick={() => { setQuery(q.trim()); }}>Suchen</Btn>
        </form>
        {data && data.errors.length > 0 && <Callout kind="warn">Eine Quelle antwortet gerade nicht: {data.errors[0]}</Callout>}
        {!data ? <Loading /> : data.hits.length === 0 ? <Empty icon={Store} title="Nichts gefunden" text="Andere Suchbegriffe, Kategorie oder Quelle versuchen." /> : (
          <>
            <div className="market-grid">
              {data.hits.map((h) => (
                <button key={h.source + h.id} className="market-card" onClick={() => setOpen(h)}>
                  <div className="row-tight" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <LazyImg src={h.icon} className="ph" fallback={<div className="ph"><Puzzle size={20} /></div>} />
                    <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                      <div className="bold ellipsis">{h.title}</div>
                      <div className="tiny muted ellipsis">von {h.author}</div>
                    </div>
                    {h.installed && <span className="badge ok" title={h.installed.file}><CheckCircle2 size={11} /> installiert</span>}
                  </div>
                  <div className="small muted market-desc">{h.description}</div>
                  <div className="row-tight tiny muted" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span><Download size={11} /> {fmtNumber(h.downloads)}</span>
                    {h.follows > 0 && <span><Star size={11} /> {fmtNumber(h.follows)}</span>}
                    {h.updated && <span><Clock size={11} /> {ago(h.updated)}</span>}
                    <span className="grow" />
                    <SourceBadge source={h.source} also={h.alsoOn && h.alsoOn.source} />
                  </div>
                </button>
              ))}
            </div>
            {data.more && <div style={{ textAlign: 'center' }}><Btn busy={loading && page > 0} onClick={() => load(page + 1)}>Mehr laden</Btn></div>}
          </>
        )}
      </div>
      {open && <Detail s={s} hit={open} onClose={() => setOpen(null)} onInstalled={() => { load(0); onInstalled && onInstalled(); }} />}
    </div>
  );
}
