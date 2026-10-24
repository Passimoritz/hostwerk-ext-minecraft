'use strict';
/*
 * Dimensionen eines Minecraft-Servers: Symbole und echte Eigenschaften – ohne dass Hostwerk neue Dimensionen kennen muss.
 *
 *  1. Katalog catalog/mc-dimensions.json: gezeichnete SVG-Symbole je Dimension (und Muster für ganze Familien). Online aus
 *     hostwerk-public, die mitgelieferte Datei als Rückfall – neue Symbole kommen ohne Hostwerk-Update.
 *  2. Echte Daten der Dimension: dimension/<name>.json → dimension_type (Himmel, Decke, Himmelsart, Farben von Himmel,
 *     Nebel und Wolken, heiß, Drachenkampf) und die Biome (Temperatur, Niederschlag, Wasserfarbe). Gesucht in den Datenpaketen
 *     der Welt, in Mods und in der Server-JAR (dort liegen die eingebauten Dimensionen). Daraus setzt die Oberfläche ein
 *     passendes Symbol zusammen, wenn der Katalog keins hat.
 * Ältere Formate (bis 1.21: effects, ultrawarm, fixed_time, Farben als Zahl) werden genauso gelesen.
 */
const fs = require('fs');
const path = require('path');
const yauzl = require('./hw').lib('yauzl');
const { cached } = require('./hw').core('download');

const ENTRY = /^data\/([^/]+)\/(dimension|dimension_type|worldgen\/biome|worldgen\/world_preset)\/(.+)\.json$/;
const LOCAL_CATALOG = path.join(__dirname, '..', 'catalog', 'mc-dimensions.json'); // mitgeliefert; online: catalog/ in hostwerk-public

/** Farbe als #rrggbb (aus „#rrggbb“, „#aarrggbb“ oder Zahl). */
function color(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return `#${(v & 0xffffff).toString(16).padStart(6, '0')}`;
  const m = String(v || '').match(/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i);
  return m ? `#${m[1].slice(-6).toLowerCase()}` : null;
}

/** Biome einer Dimension (höchstens 4) aus ihrem Generator. */
function biomesOf(gen) {
  const bs = gen && gen.biome_source;
  if (!bs) return gen && gen.settings && gen.settings.biome ? [gen.settings.biome] : []; // flach: settings.biome
  if (typeof bs.biome === 'string') return [bs.biome];
  if (bs.preset) return ({ 'minecraft:overworld': ['minecraft:plains', 'minecraft:forest'], 'minecraft:nether': ['minecraft:nether_wastes', 'minecraft:crimson_forest'] })[bs.preset] || [];
  if (/the_end$/.test(String(bs.type || ''))) return ['minecraft:the_end', 'minecraft:end_highlands'];
  const list = Array.isArray(bs.biomes) ? bs.biomes : [];
  return list.map((x) => (typeof x === 'string' ? x : x && x.biome)).filter((x) => typeof x === 'string' && !x.startsWith('#')).slice(0, 4);
}

/** Art des Geländes: flach, schwebende Inseln, Höhlen oder normal. */
function terrainOf(gen) {
  if (!gen) return null;
  const t = String(gen.type || '');
  if (/flat/.test(t)) return 'flat';
  const s = typeof gen.settings === 'string' ? gen.settings : '';
  if (/floating_islands|end/.test(s)) return 'islands';
  if (/caves|nether/.test(s)) return 'caves';
  return 'noise';
}

/** dimension_type → die Eigenschaften, die das Aussehen bestimmen (neues Format mit attributes und altes). */
function typeTraits(j) {
  if (!j || typeof j !== 'object') return null;
  const a = j.attributes || {};
  const attr = (k) => a[`minecraft:${k}`];
  const effects = String(j.effects || '');
  return {
    sky: j.has_skylight !== false,
    ceiling: !!j.has_ceiling,
    fixedTime: !!(j.has_fixed_time || j.fixed_time != null),
    skybox: j.skybox || (/the_end/.test(effects) ? 'end' : /the_nether/.test(effects) ? 'none' : 'overworld'),
    hot: !!(j.ultrawarm || attr('gameplay/water_evaporates')),
    ambient: Number(j.ambient_light) || 0,
    skyColor: color(attr('visual/sky_color')),
    fogColor: color(attr('visual/fog_color')),
    cloudColor: attr('visual/cloud_color') != null ? color(attr('visual/cloud_color')) : null,
    skyLight: color(attr('visual/sky_light_color')),
    dragon: !!j.has_ender_dragon_fight,
    scale: Number(j.coordinate_scale) || 1,
  };
}

function biomeTraits(j) {
  if (!j || typeof j !== 'object') return null;
  const a = j.attributes || {};
  const e = j.effects || {};
  return {
    temp: Number(j.temperature), downfall: Number(j.downfall),
    water: color(e.water_color), grass: color(e.grass_color), foliage: color(e.foliage_color),
    sky: color(a['minecraft:visual/sky_color'] ?? e.sky_color), fog: color(a['minecraft:visual/fog_color'] ?? e.fog_color),
  };
}

/** Eine Datei aus einem Datenpaket/einer JAR in die Sammlung übernehmen (kompakt – große Biome-Dateien nicht ganz merken). */
function take(out, name, text) {
  const m = name.match(ENTRY);
  if (!m) return;
  let j; try { j = JSON.parse(text); } catch { return; }
  const id = `${m[1]}:${m[3]}`;
  if (m[2] === 'dimension') { if (!out.dimension[id]) out.dimension[id] = { type: typeof j.type === 'string' ? j.type : null, inlineType: typeof j.type === 'object' ? typeTraits(j.type) : null, biomes: biomesOf(j.generator), terrain: terrainOf(j.generator) }; }
  else if (m[2] === 'dimension_type') { if (!out.dimension_type[id]) out.dimension_type[id] = typeTraits(j); }
  else if (m[2] === 'worldgen/biome') { if (!out.biome[id]) out.biome[id] = biomeTraits(j); }
  else if (id === 'minecraft:normal') {
    // Weltvoreinstellung „normal“: welche Dimensionen es von Haus aus gibt und welchen Typ sie haben
    for (const [did, d] of Object.entries(j.dimensions || {})) if (!out.dimension[did]) out.dimension[did] = { type: typeof d.type === 'string' ? d.type : null, inlineType: null, biomes: biomesOf(d.generator), terrain: terrainOf(d.generator) };
  }
}
const empty = () => ({ dimension: {}, dimension_type: {}, biome: {} });

/** Alle passenden Einträge einer ZIP/JAR lesen. */
function scanZip(file) {
  return new Promise((resolve) => {
    const out = empty();
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return resolve(out);
      const done = () => { try { zip.close(); } catch { /* egal */ } resolve(out); };
      zip.on('entry', (e) => {
        if (!ENTRY.test(e.fileName) || e.uncompressedSize > 2e6) return zip.readEntry();
        zip.openReadStream(e, (e2, s) => {
          if (e2) return zip.readEntry();
          const chunks = [];
          s.on('data', (c) => chunks.push(c));
          s.on('end', () => { take(out, e.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
          s.on('error', () => zip.readEntry());
        });
      });
      zip.on('end', done);
      zip.on('error', done);
      zip.readEntry();
    });
  });
}

/** Datenpaket als Ordner lesen (nur data/<ns>/dimension…, …/biome, …/world_preset). */
function scanDir(dir) {
  const out = empty();
  const walk = (d, rel, depth) => {
    if (depth > 6) return;
    let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r, depth + 1);
      else if (ENTRY.test(r)) { try { take(out, r, fs.readFileSync(path.join(d, e.name), 'utf8')); } catch { /* gesperrt */ } }
    }
  };
  walk(path.join(dir, 'data'), 'data', 0);
  return out;
}

/** SVG aus dem Katalog entschärfen (wird als Bild gezeigt – trotzdem keine Skripte, Ereignisse oder fremden Adressen). */
function cleanSvg(svg) {
  const s = String(svg || '');
  if (!/^\s*<svg[\s>]/i.test(s) || s.length > 30000) return null;
  return s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
}

class Dimensions {
  constructor(mc) { this.mc = mc; }

  /** Katalog: online (hostwerk-public) gewinnt, wenn mindestens so neu wie die mitgelieferte Fassung; 12 h gemerkt. */
  async catalog() {
    return cached('mc-dimensions-catalog', 12 * 3600e3, async () => {
      let local = { version: 0, dimensions: {}, rules: [] };
      try { local = JSON.parse(fs.readFileSync(LOCAL_CATALOG, 'utf8')); } catch { /* fehlt */ }
      let cat = local;
      try { const r = await require('./hw').core('github').contentJson('catalog/mc-dimensions.json'); if (r && r.data && r.data.dimensions && (r.data.version || 0) >= (local.version || 0)) cat = r.data; } catch { /* offline */ }
      const dimensions = {};
      for (const [id, d] of Object.entries(cat.dimensions || {})) { const svg = cleanSvg(d && d.svg); if (svg) dimensions[id] = { svg, label: d.label || null }; }
      const rules = (cat.rules || []).map((r) => { try { return { match: String(r.match), svg: cleanSvg(r.svg), label: r.label || null }; } catch { return null; } }).filter((r) => r && r.svg);
      return { dimensions, rules, source: cat === local ? 'local' : 'online' };
    }, { persist: false });
  }

  /** Woher die Daten kommen – in dieser Reihenfolge (erste gewinnt): Datenpakete der Welten, Mods, Server-JARs. */
  sources(id) {
    const dir = this.mc.dir(id);
    const out = [];
    let worlds = [];
    try { worlds = this.mc.worlds(id).worlds; } catch { /* keine */ }
    for (const w of worlds) {
      const dp = path.join(dir, w.name, 'datapacks');
      let list = []; try { list = fs.readdirSync(dp, { withFileTypes: true }); } catch { continue; }
      for (const e of list) {
        if (e.isDirectory()) out.push({ kind: 'dir', file: path.join(dp, e.name) });
        else if (/\.(zip|jar)$/i.test(e.name)) out.push({ kind: 'zip', file: path.join(dp, e.name) });
      }
    }
    try { for (const f of fs.readdirSync(path.join(dir, 'mods'))) if (/\.jar$/i.test(f)) out.push({ kind: 'zip', file: path.join(dir, 'mods', f) }); } catch { /* keine Mods */ }
    // Eingebaute Dimensionen: Server-JAR bzw. die von Paperclip entpackte Fassung unter versions/
    const jars = [];
    const walk = (d, depth) => { let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of list) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 2) walk(p, depth + 1); else if (/\.jar$/i.test(e.name)) jars.push(p); } };
    walk(path.join(dir, 'versions'), 0);
    try { for (const f of fs.readdirSync(dir).filter((x) => /\.jar$/i.test(x))) jars.push(path.join(dir, f)); } catch { /* Ordner fehlt */ }
    for (const f of jars) out.push({ kind: 'zip', file: f });
    return out;
  }

  /** Alle Daten zusammenführen. ZIPs/JARs sind je Datei (Größe + Zeit) im JAR-Zwischenspeicher – auch über Neustarts. */
  async data(id) {
    const all = empty();
    for (const src of this.sources(id)) {
      const part = src.kind === 'dir' ? scanDir(src.file) : await this.mc.jarCache.get(src.file, 'dimdata-1', () => scanZip(src.file));
      if (!part) continue;
      for (const k of Object.keys(all)) for (const [key, v] of Object.entries(part[k] || {})) if (!(key in all[k])) all[k][key] = v;
    }
    return all;
  }

  /** Eigenschaften einer Dimension (null = keine Daten gefunden). */
  resolve(data, id) {
    const d = data.dimension[id] || null;
    const type = (d && d.inlineType) || data.dimension_type[(d && d.type) || id] || null;
    if (!type && !d) return null;
    const biomes = ((d && d.biomes) || []).map((b) => ({ id: b, ...(data.biome[b] || {}) })).filter((b) => b.temp != null || b.water);
    return { ...(type || {}), type: (d && d.type) || (type ? id : null), terrain: (d && d.terrain) || null, biomes };
  }

  /** Für die Oberfläche: je Dimension aller Welten Katalog-Symbol (falls vorhanden), Name und echte Eigenschaften. */
  async forServer(id) {
    const cat = await this.catalog().catch(() => ({ dimensions: {}, rules: [] }));
    let worlds = [];
    try { worlds = this.mc.worlds(id).worlds; } catch { /* keine */ }
    const ids = new Set();
    for (const w of worlds) for (const d of w.dims || []) ids.add(d.id);
    for (const k of ['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end']) ids.add(k); // auch für die Zustand-Ansicht
    let data = null;
    try { data = await this.data(id); } catch { data = empty(); }
    const rules = cat.rules.map((r) => { try { return { ...r, re: new RegExp(r.match, 'i') }; } catch { return null; } }).filter(Boolean);
    const out = {};
    for (const did of ids) {
      const hit = cat.dimensions[did] || rules.find((r) => r.re.test(did)) || null;
      out[did] = { svg: hit ? hit.svg : null, label: hit ? hit.label : null, traits: this.resolve(data, did) };
    }
    return { dimensions: out, catalog: cat.source };
  }
}

module.exports = { Dimensions, typeTraits, biomeTraits, biomesOf, cleanSvg };
