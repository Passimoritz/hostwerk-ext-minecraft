'use strict';
/*
 * Kleiner NBT-Leser/-Schreiber (Java Edition, Big-Endian, gzip) – genug für level.dat: Spielregeln (Data.GameRules)
 * lesen und ändern, auch wenn der Server nicht läuft. Der Baum bleibt typgetreu, damit die Datei unverändert
 * zurückgeschrieben werden kann (Minecraft legt selbst level.dat_old als Sicherung an, wir zusätzlich .hostwerk-bak).
 */
const fs = require('fs');
const zlib = require('zlib');

const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTES: 7, STRING: 8, LIST: 9, COMPOUND: 10, INTS: 11, LONGS: 12 };

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  u8() { return this.b[this.p++]; }
  i8() { return this.b.readInt8(this.p++); }
  i16() { const v = this.b.readInt16BE(this.p); this.p += 2; return v; }
  u16() { const v = this.b.readUInt16BE(this.p); this.p += 2; return v; }
  i32() { const v = this.b.readInt32BE(this.p); this.p += 4; return v; }
  i64() { const v = this.b.readBigInt64BE(this.p); this.p += 8; return v; }
  f32() { const v = this.b.readFloatBE(this.p); this.p += 4; return v; }
  f64() { const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }
  str() { const n = this.u16(); const s = this.b.toString('utf8', this.p, this.p + n); this.p += n; return s; }
  payload(t) {
    switch (t) {
      case T.BYTE: return this.i8();
      case T.SHORT: return this.i16();
      case T.INT: return this.i32();
      case T.LONG: return this.i64();
      case T.FLOAT: return this.f32();
      case T.DOUBLE: return this.f64();
      case T.BYTES: { const n = this.i32(); const v = Buffer.from(this.b.subarray(this.p, this.p + n)); this.p += n; return v; }
      case T.STRING: return this.str();
      case T.LIST: { const lt = this.u8(); const n = this.i32(); const items = []; for (let i = 0; i < n; i++) items.push(this.payload(lt)); return { lt, items }; }
      case T.COMPOUND: { const out = []; for (;;) { const ct = this.u8(); if (ct === T.END) break; const name = this.str(); out.push([name, { t: ct, v: this.payload(ct) }]); } return out; }
      case T.INTS: { const n = this.i32(); const v = []; for (let i = 0; i < n; i++) v.push(this.i32()); return v; }
      case T.LONGS: { const n = this.i32(); const v = []; for (let i = 0; i < n; i++) v.push(this.i64()); return v; }
      default: throw new Error(T('Unknown NBT type {t}', { t }));
    }
  }
}

class Writer {
  constructor() { this.parts = []; }
  push(b) { this.parts.push(b); }
  u8(v) { this.push(Buffer.from([v & 255])); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.push(b); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v); this.push(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.push(b); }
  i64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.push(b); }
  f32(v) { const b = Buffer.alloc(4); b.writeFloatBE(v); this.push(b); }
  f64(v) { const b = Buffer.alloc(8); b.writeDoubleBE(v); this.push(b); }
  str(s) { const b = Buffer.from(String(s), 'utf8'); this.u16(b.length); this.push(b); }
  payload(t, v) {
    switch (t) {
      case T.BYTE: this.u8(v); break;
      case T.SHORT: this.i16(v); break;
      case T.INT: this.i32(v); break;
      case T.LONG: this.i64(v); break;
      case T.FLOAT: this.f32(v); break;
      case T.DOUBLE: this.f64(v); break;
      case T.BYTES: this.i32(v.length); this.push(Buffer.from(v)); break;
      case T.STRING: this.str(v); break;
      case T.LIST: this.u8(v.lt); this.i32(v.items.length); for (const it of v.items) this.payload(v.lt, it); break;
      case T.COMPOUND: for (const [name, node] of v) { this.u8(node.t); this.str(name); this.payload(node.t, node.v); } this.u8(T.END); break;
      case T.INTS: this.i32(v.length); for (const x of v) this.i32(x); break;
      case T.LONGS: this.i32(v.length); for (const x of v) this.i64(x); break;
      default: throw new Error(T('Unknown NBT type {t}', { t }));
    }
  }
  out() { return Buffer.concat(this.parts); }
}

/** Datei (gzip oder roh) → { name, root } mit root = { t, v }. */
function read(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const r = new Reader(buf);
  const t = r.u8();
  if (t !== T.COMPOUND) throw new Error(T('Not an NBT file (no compound at the start).'));
  const name = r.str();
  return { name, root: { t, v: r.payload(t) } };
}
function write(file, { name, root }, { gzip = true } = {}) {
  const w = new Writer();
  w.u8(root.t); w.str(name); w.payload(root.t, root.v);
  const raw = w.out();
  const data = gzip ? zlib.gzipSync(raw) : raw;
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.hostwerk-bak');
  fs.writeFileSync(file + '.tmp', data);
  fs.renameSync(file + '.tmp', file);
}
const child = (compound, name) => { const e = (compound || []).find(([n]) => n === name); return e ? e[1] : null; };

/** Spielregeln aus level.dat: { name: "true"|"false"|"3" } (alle Werte sind dort Strings). */
function readGameRules(levelDat) {
  const { root } = read(levelDat);
  const data = child(root.v, 'Data');
  const rules = data && child(data.v, 'GameRules');
  const out = {};
  for (const [name, node] of (rules && rules.v) || []) if (node.t === T.STRING) out[name] = node.v;
  return out;
}
/** Eine Spielregel in level.dat setzen (Server muss gestoppt sein, sonst überschreibt er die Datei). */
function writeGameRule(levelDat, name, value) {
  const doc = read(levelDat);
  const data = child(doc.root.v, 'Data');
  if (!data) throw new Error(T('level.dat without a “Data” section.'));
  let rules = child(data.v, 'GameRules');
  if (!rules) { rules = { t: T.COMPOUND, v: [] }; data.v.push(['GameRules', rules]); }
  const cur = rules.v.find(([n]) => n === name);
  if (cur) cur[1] = { t: T.STRING, v: String(value) }; else rules.v.push([name, { t: T.STRING, v: String(value) }]);
  write(levelDat, doc);
}

module.exports = { read, write, readGameRules, writeGameRule, T };
