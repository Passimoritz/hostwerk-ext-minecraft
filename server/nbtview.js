'use strict';
/*
 * NBT-Dateien (level.dat, Spielerdaten, Strukturen, Schematics) im Dateibrowser als Baum – bis Hostwerk 3.1 im Kern.
 *   GET /mc/nbt?root=<wurzel>&path=<pfad> → { ok, name, tree } (nur lesen, höchstens 20 MB)
 * Die Oberfläche hängt sich als Ansicht „NBT-Baum“ in Hostwerks Dateivorschau (Einhängepunkt files.preview).
 */
const fs = require('fs');
const T = (text, vars) => require('./hw').t(text, vars);

/** NBT-Baum → einfaches JSON für die Baumansicht (Zahlenfelder gekürzt, große Werte als Text). */
function nbtToJson(node, depth = 0) {
  const { T } = require('./nbt');
  const { t, v } = node;
  if (depth > 40) return '…';
  if (t === T.COMPOUND) { const o = {}; for (const [k, c] of v.slice(0, 2000)) o[k] = nbtToJson(c, depth + 1); if (v.length > 2000) o['…'] = `${v.length - 2000} weitere`; return o; }
  if (t === T.LIST) return v.items.slice(0, 500).map((x) => nbtToJson({ t: v.lt, v: x }, depth + 1)).concat(v.items.length > 500 ? [`… ${v.items.length - 500} weitere`] : []);
  if (t === T.BYTES || t === T.INTS || t === T.LONGS) { const arr = Array.from(v, (x) => (typeof x === 'bigint' ? x.toString() : x)); return arr.length > 64 ? `[${arr.length} Werte: ${arr.slice(0, 16).join(', ')} …]` : arr; }
  if (typeof v === 'bigint') return `${v.toString()}L`;
  return v;
}

function routes(r, ctx) {
  r.get('/mc/nbt', (req, res, next) => {
    try {
      const { full } = ctx.files.resolve(req.query.root, req.query.path);
      if (fs.statSync(full).size > 20 * 1024 * 1024) return res.json({ ok: false, error: T('The file is too large for the preview (over 20 MB).') });
      let parsed;
      try { parsed = require('./nbt').read(full); } catch { return res.json({ ok: false, error: T('Not an NBT file – probably another format with the .dat extension.') }); }
      res.json({ ok: true, name: parsed.name, tree: nbtToJson(parsed.root) });
    } catch (e) { next(e); }
  });
}

module.exports = { routes, nbtToJson };
