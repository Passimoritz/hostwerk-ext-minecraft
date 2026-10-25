import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { get } from '@hostwerk/api';
import { Empty, Loading } from '@hostwerk/ui';
import { t } from '@hostwerk/i18n';

/*
 * NBT-Baum in Hostwerks Dateivorschau (Einhängepunkt files.preview): level.dat, Spielerdaten, Strukturen und
 * Schematics nur lesend als aufklappbarer Baum. Die Daten liefert GET /mc/nbt (server/nbtview.js).
 */
export const NBT_FILES = /\.(nbt|dat|dat_old|schem|schematic|litematic)$/i;

function Node({ k, v, depth }) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = v && typeof v === 'object';
  if (!isObj) return <div className="fp-json-row" style={{ paddingLeft: depth * 16 }}>{k != null && <span className="fp-json-k">{k}: </span>}<span className={`fp-json-v t-${v === null ? 'null' : typeof v}`}>{JSON.stringify(v)}</span></div>;
  const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  return (
    <div>
      <div className="fp-json-row clickable" style={{ paddingLeft: depth * 16 }} onClick={() => setOpen(!open)}>
        <span className="fp-json-tog">{open ? '▾' : '▸'}</span>{k != null && <span className="fp-json-k">{k}: </span>}<span className="muted">{Array.isArray(v) ? `[${v.length}]` : `{${entries.length}}`}</span>
      </div>
      {open && entries.slice(0, 1000).map(([ck, cv]) => <Node key={ck} k={ck} v={cv} depth={depth + 1} />)}
    </div>
  );
}

export default function McNbtView({ root, path }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true; setD(null);
    get(`/mc/nbt?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`).then((r) => alive && setD(r)).catch((e) => alive && setD({ error: e.message }));
    return () => { alive = false; };
  }, [root, path]);
  if (!d) return <Loading />;
  if (d.error || !d.ok) return <Empty icon={AlertCircle} title={t('Preview not possible')} text={d.error} />;
  return <div className="fp-json mono small"><div className="tiny muted" style={{ marginBottom: 6 }}>{t('Minecraft NBT')}{d.name ? ` · „${d.name}“` : ''} · {t('read only')}</div><Node k={null} v={d.tree} depth={0} /></div>;
}
