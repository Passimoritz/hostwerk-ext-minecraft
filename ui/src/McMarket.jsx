import { useEffect, useRef, useState } from 'react';
import { Search, Download, Star, CheckCircle2, ExternalLink, Store, Puzzle, Clock, Image as ImageIcon, FileText, ListOrdered, Link2 } from 'lucide-react';
import { get, post, waitJob, fmtNumber, fmtDate, openExternal } from '@hostwerk/api';
import { Btn, Seg, Tabs, Modal, Loading, Empty, Callout, toast, InfoTip } from '@hostwerk/ui';
import { Markdown } from '@hostwerk/kit';
import { LazyImg } from '@hostwerk/kit';
import { t as T } from '@hostwerk/i18n';

const SRC = { modrinth: { label: 'Modrinth', color: '#1bd96a' }, hangar: { label: 'Hangar', color: '#3b82f6' } };
const ago = (d) => {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400e3);
  return days < 1 ? T('today') : days < 30 ? T('{n} d ago', { n: days }) : days < 365 ? T('{n} mo. ago', { n: Math.floor(days / 30) }) : T('{n} y. ago', { n: Math.floor(days / 365) });
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
      toast.success(`${j.result.title} ${j.result.version} ${j.result.mode === 'queued' ? T('waiting – applied at the next stop or restart') : j.result.mode === 'hot' ? T('swapped live, without restart') : `${T('installed')}${j.result.needsRestart ? T(' – takes effect after a restart (or live update)') : ''}`}`);
      onInstalled && onInstalled();
      onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const v = d && d.versions.find((x) => x.id === ver);
  return (
    <Modal size="wide" onClose={onClose} title={<span className="row-tight" style={{ gap: 10 }}>{hit.icon ? <LazyImg src={hit.icon} style={{ width: 32, height: 32, borderRadius: 8 }} /> : <Puzzle size={22} />}{hit.title}</span>}
      subtitle={d ? [T('by {name}', { name: d.author || hit.author }), T('{n} downloads', { n: fmtNumber(d.downloads) }), d.license ? T('License {name}', { name: d.license }) : null, T('updated {when}', { when: ago(d.updated) })].filter(Boolean).join(' · ') : hit.description}
      footer={d && (
        <div className="row grow" style={{ gap: 8, flexWrap: 'wrap' }}>
          {d.installed && <span className="badge ok"><CheckCircle2 size={12} /> installed{d.installed.version ? ` (${d.installed.version})` : ''}</span>}
          <div className="grow" />
          {d.versions.length > 0 ? <>
            <select className="input" style={{ width: 'auto', maxWidth: 320 }} value={ver} onChange={(e) => setVer(e.target.value)}>
              {d.versions.map((x) => <option key={x.id} value={x.id}>{x.number}{x.type !== 'release' ? ` (${x.channel || x.type})` : ''}{x.id === d.recommended ? ' – recommended' : ''}{!x.fits ? T(' – not for ') + (d.serverVersion || T('this version')) : ''}</option>)}
            </select>
            <Btn className="primary" icon={Download} busy={busy} disabled={!ver} onClick={install}>{d.installed ? 'Install this version' : 'Install'}</Btn>
          </> : <span className="small muted">No version available for this server type.</span>}
        </div>
      )}>
      {!d ? <Loading /> : (
        <div className="stack" style={{ gap: 12 }}>
          {d.compat && d.compat.known && d.compat.status === 'too-new' && <Callout kind="warn" title={`Only up to Minecraft ${d.compat.max}`}>{d.title} supports Minecraft {d.compat.min} until {d.compat.max}, your server runs {d.compat.serverVersion}. It may still work – but often only after an update of the plugin.</Callout>}
          {d.compat && d.compat.known && d.compat.status === 'other' && <Callout kind="warn" title={`Not listed for Minecraft ${d.compat.serverVersion}`}>Supported versions: {d.compat.min} until {d.compat.max}.</Callout>}
          {d.compat && d.compat.known && d.compat.status === 'ok' && <div className="small muted">{`Supports Minecraft ${d.compat.min === d.compat.max ? d.compat.min : `${d.compat.min}–${d.compat.max}`} – fits your server.`}</div>}
          {v && !v.fits && <Callout kind="warn">Version {v.number} is not explicitly released for {d.serverVersion} – it may still work.</Callout>}
          {v && v.external && <InfoTip>This version is downloaded from the developer’s site. Hostwerk checks that a plugin JAR really arrives.</InfoTip>}
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'about', label: 'Description', icon: FileText },
            { id: 'versions', label: 'Versions', icon: ListOrdered, badge: d.versions.length },
            ...(d.gallery.length ? [{ id: 'gallery', label: T('Images'), icon: ImageIcon, badge: d.gallery.length }] : []),
            { id: 'links', label: 'Links', icon: Link2 },
          ]} />
          {tab === 'about' && <div style={{ maxHeight: '52vh', overflow: 'auto' }}>{d.body ? <Markdown text={d.body} /> : <p className="muted">{d.description}</p>}</div>}
          {tab === 'versions' && (
            <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
              {d.versions.map((x) => (
                <div key={x.id} className="list-item" style={{ alignItems: 'flex-start', cursor: 'pointer', background: x.id === ver ? 'var(--accent-soft)' : undefined }} onClick={() => setVer(x.id)}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row-tight" style={{ gap: 6, flexWrap: 'wrap' }}><b>{x.number}</b>{x.type !== 'release' && <span className="badge warn">{x.channel || x.type}</span>}{x.fits ? <span className="badge ok">fits {d.serverVersion || 'your server'}</span> : <span className="badge">not for {d.serverVersion}</span>}{x.id === d.recommended && <span className="badge accent">recommended</span>}</div>
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
  if (!s.pluginsSupported) return <Empty icon={Puzzle} title="Vanilla doesn't support plugins" text="Switch to Paper or Purpur under “Version” to use plugins – your world is kept." />;
  const cats = data ? data.categories.filter((c) => source === 'all' || c.sources.includes(source)) : [];
  return (
    <div className="market">
      <aside className="market-side card">
        <div className="card-body stack" style={{ gap: 14 }}>
          <div>
            <div className="tiny muted bold" style={{ marginBottom: 6 }}>SOURCE</div>
            <Seg value={source} onChange={(v) => { setSource(v); setCategory(''); }} options={[{ id: 'all', label: 'All' }, { id: 'modrinth', label: 'Modrinth' }, ...(!data || data.hangar ? [{ id: 'hangar', label: 'Hangar' }] : [])]} />
          </div>
          <div>
            <div className="tiny muted bold" style={{ marginBottom: 6 }}>CATEGORY</div>
            <div className="market-cats">
              <button className={!category ? 'active' : ''} onClick={() => setCategory('')}>All categories</button>
              {cats.map((c) => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => setCategory(c.id)}>{c.label}</button>)}
            </div>
          </div>
          {s.content === 'mods'
            ? <div className="tiny muted">Only showing mods for <b>{s.typeLabel} {s.version}</b>that run on a server. Modrinth is the community’s official, reviewed mod site.</div>
            : <div className="tiny muted">Only showing plugins for <b>{s.typeLabel} {s.version}</b>. Modrinth and Hangar are the community’s official, vetted plugin sites.</div>}
        </div>
      </aside>
      <div className="stack" style={{ minWidth: 0 }}>
        <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); if (q.trim() && sort === 'downloads') setSort('relevance'); }}>
          <div className="input-icon grow" style={{ minWidth: 220 }}><Search /><input className="input" placeholder={s.content === 'mods' ? 'Search mods – e.g. Create, Lithium, Terralith …' : 'Search plugins – e.g. LuckPerms, WorldEdit, shop …'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="relevance">Best match</option>
            <option value="downloads">Most downloads</option>
            <option value="updated">Recently updated</option>
            <option value="newest">Latest</option>
          </select>
          <Btn className="primary" busy={loading && page === 0} onClick={() => { setQuery(q.trim()); }}>Search</Btn>
        </form>
        {data && data.errors.length > 0 && <Callout kind="warn">A source is not responding right now: {data.errors[0]}</Callout>}
        {!data ? <Loading /> : data.hits.length === 0 ? <Empty icon={Store} title="Nothing found" text="Try other search terms, category or source." /> : (
          <>
            <div className="market-grid">
              {data.hits.map((h) => (
                <button key={h.source + h.id} className="market-card" onClick={() => setOpen(h)}>
                  <div className="row-tight" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <LazyImg src={h.icon} className="ph" fallback={<div className="ph"><Puzzle size={20} /></div>} />
                    <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}>
                      <div className="bold ellipsis">{h.title}</div>
                      <div className="tiny muted ellipsis">of {h.author}</div>
                    </div>
                    {h.installed && <span className="badge ok" title={h.installed.file}><CheckCircle2 size={11} /> installed</span>}
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
            {data.more && <div style={{ textAlign: 'center' }}><Btn busy={loading && page > 0} onClick={() => load(page + 1)}>Load more</Btn></div>}
          </>
        )}
      </div>
      {open && <Detail s={s} hit={open} onClose={() => setOpen(null)} onInstalled={() => { load(0); onInstalled && onInstalled(); }} />}
    </div>
  );
}
