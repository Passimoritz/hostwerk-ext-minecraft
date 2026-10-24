'use strict';
// Server-List-Ping (wie die Serverliste im Minecraft-Client): Spielerzahl, Spielernamen-Auszug und die
// MOTD, die der Server gerade wirklich anzeigt – auch wenn ein Plugin sie überschreibt.
const net = require('net');
const dgram = require('dgram');
const http = require('http');

function varInt(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
function readVarInt(buf, off) {
  let n = 0; let shift = 0; let b;
  do {
    if (off >= buf.length) return null;
    b = buf[off++];
    n |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80 && shift < 35);
  return { value: n, off };
}
const packet = (...parts) => { const body = Buffer.concat(parts); return Buffer.concat([varInt(body.length), body]); };
const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varInt(b.length), b]); };

/** Chat-Komponente (JSON) in Text mit §-Farbcodes umwandeln. */
const COLORS = { black: '0', dark_blue: '1', dark_green: '2', dark_aqua: '3', dark_red: '4', dark_purple: '5', gold: '6', gray: '7', dark_gray: '8', blue: '9', green: 'a', aqua: 'b', red: 'c', light_purple: 'd', yellow: 'e', white: 'f' };
function componentToLegacy(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(componentToLegacy).join('');
  let pre = '';
  if (c.color && COLORS[c.color]) pre += '§' + COLORS[c.color];
  else if (c.color && /^#[0-9a-f]{6}$/i.test(c.color)) pre += '§x' + c.color.slice(1).split('').map((x) => '§' + x).join('');
  if (c.bold) pre += '§l';
  if (c.italic) pre += '§o';
  if (c.underlined) pre += '§n';
  if (c.strikethrough) pre += '§m';
  if (c.obfuscated) pre += '§k';
  return pre + (c.text || c.translate || '') + (c.extra ? c.extra.map(componentToLegacy).join('') : '');
}

/** Fragt einen Server ab: { online, max, sample: [namen], motd, version } */
function ping(port, host = '127.0.0.1', timeout = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    const done = (err, val) => { sock.destroy(); clearTimeout(t); err ? reject(err) : resolve(val); };
    const t = setTimeout(() => done(new Error('Zeitüberschreitung')), timeout);
    sock.on('error', (e) => done(e));
    sock.on('connect', () => {
      const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(port);
      sock.write(packet(varInt(0), varInt(767), str(host), portBuf, varInt(1)));
      sock.write(packet(varInt(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const len = readVarInt(buf, 0);
      if (!len || buf.length < len.off + len.value) return;
      const id = readVarInt(buf, len.off);
      const sl = readVarInt(buf, id.off);
      try {
        const j = JSON.parse(buf.slice(sl.off, sl.off + sl.value).toString('utf8'));
        done(null, {
          online: j.players ? j.players.online : 0,
          max: j.players ? j.players.max : 0,
          sample: (j.players && j.players.sample || []).map((p) => p.name).filter((n) => n && !/§/.test(n)),
          motd: componentToLegacy(j.description),
          version: j.version ? j.version.name : null,
        });
      } catch (e) { done(e); }
    });
  });
}

/*
 * Bedrock (Bedrock Dedicated Server, Geyser): RakNet „unconnected ping“ über UDP – dasselbe Paket, das die Bedrock-App
 * für ihre Serverliste schickt. Antwort „MCPE;MOTD;Protokoll;Version;Spieler;Max;ID;Weltname;Spielmodus;…“.
 */
const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
/** Antwort (unconnected pong) lesen → { motd, protocol, version, online, max, world } oder null */
function parsePong(msg) {
  if (!Buffer.isBuffer(msg) || msg.length < 35 || msg[0] !== 0x1c) return null;
  const len = msg.readUInt16BE(33);
  const parts = msg.toString('utf8', 35, 35 + len).split(';');
  if (parts[0] !== 'MCPE' && parts[0] !== 'MCEE') return null;
  return { motd: parts[1] || '', protocol: Number(parts[2]) || null, version: parts[3] || '', online: Number(parts[4]) || 0, max: Number(parts[5]) || 0, world: parts[7] || '' };
}
/** Bedrock-Server abfragen → wie parsePong oder null (keine Antwort innerhalb von timeout ms). */
function bedrockPing(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise((resolve) => {
    const s = dgram.createSocket(String(host).includes(':') ? 'udp6' : 'udp4');
    const done = (v) => { clearTimeout(t); try { s.close(); } catch { /* schon zu */ } resolve(v); };
    const t = setTimeout(() => done(null), timeout);
    s.on('error', () => done(null));
    s.on('message', (msg) => done(parsePong(msg)));
    const p = Buffer.alloc(33);
    p[0] = 0x01; p.writeBigInt64BE(BigInt(Date.now()), 1); RAKNET_MAGIC.copy(p, 9); p.writeBigInt64BE(2n, 25);
    s.send(p, port, host, (e) => { if (e) done(null); });
  });
}

/*
 * NetherNet (Bedrock ab 26.60 ohne RakNet): Die App fragt zuerst per HTTP über TCP auf dem Server-Port an – GET /v1/join
 * liefert den Status als JSON (Geyser: so im Quelltext; Mojangs Bedrock-Server: dort nur als „HTTP-based signaling“
 * beschrieben). → wie parsePong oder null.
 */
function netherNetPing(port, host = '127.0.0.1', timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/v1/join', timeout, headers: { Host: `${host}:${port}` } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 8192) body += d; });
      res.on('end', () => {
        try {
          const j = res.statusCode === 200 ? JSON.parse(body) : null;
          resolve(j && typeof j === 'object' ? { motd: String(j.name || ''), protocol: Number(j.protocol) || null, version: String(j.version || ''), online: Number(j.players) || 0, max: Number(j.maxPlayers) || 0, world: String(j.level || '') } : null);
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
/** Bedrock-Server über beide Wege fragen: erst RakNet (UDP), dann NetherNet (TCP) → Antwort mit via: 'raknet'|'nethernet' oder null. */
async function bedrockStatus(port, host = '127.0.0.1', timeout = 1500) {
  const r = await bedrockPing(port, host, timeout);
  if (r) return { ...r, via: 'raknet' };
  const n = await netherNetPing(port, host, timeout);
  return n ? { ...n, via: 'nethernet' } : null;
}

module.exports = { ping, componentToLegacy, bedrockPing, parsePong, netherNetPing, bedrockStatus };
