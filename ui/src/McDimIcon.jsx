import { useId } from 'react';
import { useApi } from '@hostwerk/api';
import { getLang } from '@hostwerk/kit';

/*
 * Symbol je Minecraft-Dimension – ohne dass Hostwerk eine Dimension kennen muss:
 *  1. Gezeichnetes SVG aus dem Katalog catalog/mc-dimensions.json (online aus hostwerk-public, neue Symbole ohne Update).
 *  2. Sonst zusammengesetzt aus den echten Daten der Dimension (server/minecraft/dimensions.js): Himmel oder Decke,
 *     Himmelsart (Ende), Farben von Himmel, Nebel und Wolken, heiß (Lava), Gelände (flach, Inseln, Höhlen),
 *     Biome (Temperatur, Niederschlag, Wasserfarbe), Drachenkampf.
 *  3. Nur wenn es gar keine Daten gibt: ein Planet, der aus dem Namen entsteht (gleiche Dimension = gleiches Bild).
 */

const KNOWN = {
  'minecraft:overworld': { de: 'Overworld', en: 'Overworld' },
  'minecraft:the_nether': { de: 'Nether', en: 'Nether' },
  'minecraft:the_end': { de: 'The End', en: 'The End' },
};

/** Anzeigename: aus dem Katalog, für die drei eingebauten mitgeliefert, sonst aus der Kennung („deep_dark_caves“ → „Deep dark caves“). */
export function dimLabel(id, info) {
  const en = getLang() === 'en';
  const l = (info && info.label) || KNOWN[id];
  if (l) return (en ? l.en : l.de) || l.de || l.en;
  const key = String(id || '').split(':').pop() || String(id || '');
  return key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Kennung ohne „minecraft:“ – für die kleine Zeile unter dem Namen. */
export const dimKey = (id) => String(id || '').replace(/^minecraft:/, '');

/** Symbole und Eigenschaften aller Dimensionen eines Servers (einmal geladen, ändert sich nur mit Datenpaketen/Mods). */
export function useDimInfo(serverId) {
  const r = useApi(serverId ? `/mc/servers/${serverId}/dimensions` : null, [], { live: false });
  const all = (r.data && r.data.dimensions) || {};
  return (id) => all[id] || null;
}

/* ---------------- Farben ---------------- */
const hex = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4), 16)] : null; };
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = hex(a); const y = hex(b); return x && y ? toHex(x.map((v, i) => v + (y[i] - v) * t)) : a || b; };
const shade = (c, t) => (t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t));

/** Bodenfarbe eines Bioms: eigene Grasfarbe, sonst aus Temperatur und Niederschlag (wie Minecrafts Grasfarbe). */
function groundOf(b, { hot, end }) {
  if (end) return '#e3e3a6';
  if (!b) return hot ? '#7a2b26' : '#5fae3b';
  if (b.grass) return b.grass;
  const t = Number.isFinite(b.temp) ? b.temp : 0.8;
  const d = Number.isFinite(b.downfall) ? b.downfall : 0.4;
  if (t >= 1.5 && d < 0.1) return hot ? '#7a2b26' : '#d9c27a';
  if (t < 0.15) return '#eef3f8';
  return mix('#b3b04c', '#3f9a2c', Math.max(0, Math.min(1, d * Math.min(1, t))));
}

/* ---------------- Aus Eigenschaften zusammengesetzt ---------------- */
function Composed({ t, uid }) {
  const end = t.skybox === 'end';
  const cave = t.ceiling || !t.sky;
  const b0 = (t.biomes || [])[0];
  const b1 = (t.biomes || [])[1];
  const fog = (b0 && b0.fog) || t.fogColor;
  // Hintergrund: Himmel (Farbe aus dem Typ bzw. Biom), Weltraum (Ende) oder Höhle (Nebelfarbe)
  const skyTop = end ? (t.skyColor && t.skyColor !== '#000000' ? t.skyColor : '#0e0a1a') : cave ? shade(fog || (t.hot ? '#5a1616' : '#2b2622'), -0.35) : (t.skyColor || (b0 && b0.sky) || '#78a7ff');
  // Heiße Höhle (Nether-artig): unten glüht es nach Lava
  const skyBottom = end ? shade(t.skyLight || '#3b2a5c', -0.55) : cave ? (t.hot ? mix(fog || '#5a1616', '#ff6a00', 0.5) : shade(fog || '#4a4038', 0.15)) : shade(t.fogColor || skyTop, 0.35);
  const ground = groundOf(b0, { hot: t.hot && cave, end });
  const ground2 = b1 ? groundOf(b1, { hot: t.hot && cave, end }) : shade(ground, -0.18);
  const dirt = end ? '#bdbd84' : t.hot && cave ? '#4e1616' : '#8a5a33';
  const water = (b0 && b0.water) || '#3f76e4';
  const terrain = end ? 'islands' : t.terrain || (cave ? 'caves' : 'noise');
  const stars = [[7, 8, 0.8], [24, 7, 0.6], [11, 5, 0.5], [27, 13, 0.7], [5, 14, 0.5], [19, 4, 0.6]];
  return (
    <>
      <defs>
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={skyTop} /><stop offset="1" stopColor={skyBottom} /></linearGradient>
        <clipPath id={`${uid}c`}><circle cx="16" cy="16" r="13" /></clipPath>
      </defs>
      <circle cx="16" cy="16" r="13" fill={`url(#${uid}s)`} />
      <g clipPath={`url(#${uid}c)`}>
        {(end || (!cave && t.fixedTime)) && stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#e8e4ff" opacity="0.9" />)}
        {!cave && !end && (t.fixedTime ? <circle cx="23" cy="9" r="2.4" fill="#e9ecf5" /> : <circle cx="23" cy="9" r="2.6" fill="#ffe27a" />)}
        {!cave && !end && t.cloudColor && <path d="M4 13 h4 v-2 h5 v3 h-9 z" fill={t.cloudColor} opacity="0.85" />}
        {cave && <path d="M2 2 H30 V9 l-3 2 l-2 -1 l-3 4 l-2 -3 l-3 2 l-2 -2 l-3 3 l-2 -2 l-3 2 l-3 -2 z" fill={shade(dirt, -0.25)} />}
        {cave && [[9, 10], [17, 12], [24, 11]].map(([x, y], i) => <path key={i} d={`M${x - 1} ${y} l1 3 l1 -3 z`} fill={shade(dirt, -0.1)} />)}
        {terrain === 'islands' && <>
          <path d="M5 20 Q16 15 27 20 Q22 26 16 27 Q10 26 5 20 z" fill={ground} />
          <path d="M8 21.5 Q16 18.5 24 21.5" fill="none" stroke={shade(ground, -0.18)} strokeWidth="1" />
          <path d="M9 23 Q16 31 23 23 Q16 26 9 23 z" fill={shade(dirt, -0.3)} />
          {t.dragon && <><rect x="11" y="12" width="2" height="9" fill="#1e1530" /><rect x="19.5" y="10" width="2" height="11" fill="#1e1530" /><circle cx="12" cy="11.4" r="1" fill="#e48aff" /><circle cx="20.5" cy="9.4" r="1" fill="#e48aff" /></>}
        </>}
        {terrain === 'flat' && <>
          <rect x="2" y="20" width="28" height="3" fill={ground} /><rect x="2" y="23" width="28" height="4" fill={dirt} /><rect x="2" y="27" width="28" height="5" fill="#7d7d7d" />
        </>}
        {(terrain === 'noise' || terrain === 'caves') && <>
          <path d="M2 20 Q9 15 16 19 T30 17 V32 H2 z" fill={ground2} />
          <path d="M2 23 Q10 19 17 22 T30 21 V32 H2 z" fill={ground} />
          <rect x="2" y="25.5" width="28" height="7" fill={dirt} />
        </>}
        {t.hot && <><path d="M2 26 Q6 24 10 26 T18 26 T26 26 T34 26 V32 H2 z" fill="#ff6a00" /><path d="M2 28 Q6 26.5 10 28 T18 28 T26 28 T34 28 V32 H2 z" fill="#ffc23d" /></>}
        {!t.hot && !end && terrain !== 'islands' && <path d="M19 24.5 Q24 23 30 24.5 V27 H19 z" fill={water} opacity="0.9" />}
        {t.ambient > 0 && (t.skyLight || fog) && <circle cx="16" cy="16" r="13" fill={t.skyLight || fog} opacity={Math.min(0.25, t.ambient * 0.6)} />}
      </g>
      <circle cx="16" cy="16" r="13" fill="none" stroke={end ? 'rgba(160,120,255,.45)' : 'rgba(0,0,0,.25)'} strokeWidth="1" />
    </>
  );
}

/* ---------------- Letzter Rückfall: Planet aus dem Namen ---------------- */
function hash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function Generated({ id, uid }) {
  const h = hash(String(id || '').toLowerCase());
  const hue = h % 360;
  const c1 = `hsl(${hue} 70% 62%)`; const c2 = `hsl(${hue} 60% 34%)`; const c3 = `hsl(${(hue + 35) % 360} 75% 72%)`;
  const tilt = ((h >>> 3) % 60) - 30;
  return (
    <>
      <defs>
        <radialGradient id={`${uid}g`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></radialGradient>
        <clipPath id={`${uid}c`}><circle cx="16" cy="16" r="13" /></clipPath>
      </defs>
      <circle cx="16" cy="16" r="13" fill={`url(#${uid}g)`} />
      <g clipPath={`url(#${uid}c)`} transform={`rotate(${tilt} 16 16)`}>{[9, 15, 21].map((y, i) => <rect key={i} x="0" y={y} width="32" height="2.4" fill={i % 2 ? c2 : c3} opacity="0.55" />)}</g>
      <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1" />
    </>
  );
}

/**
 * Symbol einer Dimension. id = „namespace:name“, info = Eintrag aus useDimInfo (svg aus dem Katalog und/oder traits).
 */
export default function McDimIcon({ id, info, size = 30, title }) {
  const uid = `dim${useId().replace(/[^a-z0-9]/gi, '')}`;
  const label = title || dimLabel(id, info);
  // Katalog-SVG als Bild: läuft getrennt von der Seite (keine Skripte, keine Namenskonflikte der Verläufe)
  if (info && info.svg) return <img className="mc-dim-ico" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.svg)}`} width={size} height={size} alt={label} title={title} />;
  return (
    <svg className="mc-dim-ico" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label}>
      {title && <title>{title}</title>}
      {info && info.traits ? <Composed t={info.traits} uid={uid} /> : <Generated id={id} uid={uid} />}
    </svg>
  );
}
