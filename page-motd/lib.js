/* Motd – pure logic without DOM, tested in tests/lib.test.js (node --test). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Motd = api;
}(typeof self !== 'undefined' ? self : this, () => {
  /** Minecraft colour codes (§0–§f) with the colours the client uses in the server list. */
  const COLORS = {
    0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
    8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
  };
  const FORMATS = { k: 'obfuscated', l: 'bold', m: 'strike', n: 'underline', o: 'italic' };
  const MAX_LINE = 59; // more characters per line are cut off in the default server list

  /** server.properties writes § as § – both forms are accepted, line breaks as real "\n" or the two characters \n. */
  function normalize(text) {
    return String(text || '').replace(/\\u00a7/gi, '§').replace(/\\n/g, '\n').replace(/\r/g, '');
  }

  /** Text → lines of segments [{ text, color, bold, italic, underline, strike, obfuscated }]. Max. 2 lines like Minecraft. */
  function parse(text) {
    const lines = normalize(text).split('\n').slice(0, 2);
    return lines.map((line) => {
      const out = [];
      let st = { color: COLORS[7], bold: false, italic: false, underline: false, strike: false, obfuscated: false };
      let buf = '';
      const flush = () => { if (buf) { out.push({ text: buf, ...st }); buf = ''; } };
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '§' && i + 1 < line.length) {
          const c = line[i + 1].toLowerCase();
          if (COLORS[c] || FORMATS[c] || c === 'r') {
            flush();
            if (COLORS[c]) st = { color: COLORS[c], bold: false, italic: false, underline: false, strike: false, obfuscated: false };
            else if (c === 'r') st = { color: COLORS[7], bold: false, italic: false, underline: false, strike: false, obfuscated: false };
            else st = { ...st, [FORMATS[c]]: true };
            i++; continue;
          }
        }
        buf += ch;
      }
      flush();
      return out;
    });
  }

  /** Visible text without codes (for length and copy). */
  function plain(text) { return parse(text).map((l) => l.map((s) => s.text).join('')).join('\n'); }

  /** Problems: too many lines, too long, unknown codes. → [{ code, line }] */
  function check(text) {
    const n = normalize(text);
    const problems = [];
    const lines = n.split('\n');
    if (lines.length > 2) problems.push({ code: 'lines' });
    plain(text).split('\n').forEach((l, i) => { if (l.length > MAX_LINE) problems.push({ code: 'long', line: i + 1, length: l.length }); });
    if (/§(?![0-9a-fk-or])/i.test(n)) problems.push({ code: 'unknown' });
    return problems;
  }

  /** For server.properties: § and line break written the way Minecraft reads them. */
  function toProperty(text) { return normalize(text).replace(/§/g, '\\u00A7').replace(/\n/g, '\\n'); }

  /** Insert a code at the cursor (or wrap a selection: code + text + §r). */
  function insert(text, start, end, code) {
    const s = String(text || '');
    const a = Math.max(0, Math.min(start, s.length)); const b = Math.max(a, Math.min(end, s.length));
    const sel = s.slice(a, b);
    const piece = sel ? `§${code}${sel}§r` : `§${code}`;
    return { text: s.slice(0, a) + piece + s.slice(b), cursor: a + piece.length };
  }

  /* ---------- Zentrieren: Breite wie Minecrafts Standardschrift (Pixel je Zeichen inkl. Abstand) ---------- */
  const NARROW = { '!': 2, '.': 2, ',': 2, ':': 2, ';': 2, '|': 2, i: 2, "'": 3, '`': 3, l: 3, I: 4, t: 4, ' ': 4, '"': 4, '(': 4, ')': 4, '[': 4, ']': 4, '{': 4, '}': 4, '*': 4, f: 5, k: 5, '<': 5, '>': 5, '@': 7, '~': 7 };
  const LIST_WIDTH = 270; // Platz für die Beschreibung in der Serverliste (GUI-Maßstab 1)
  /** Breite einer Zeile in Pixeln – Codes zählen nicht, fett macht jedes Zeichen 1 Pixel breiter. */
  function width(line) {
    const segs = parse(String(line || '').split('\n')[0])[0] || [];
    let w = 0;
    for (const s of segs) for (const ch of s.text) w += (NARROW[ch] || 6) + (s.bold ? 1 : 0);
    return w;
  }
  /**
   * Jede Zeile mit Leerzeichen davor mittig setzen (vorhandene Einrückung wird ersetzt). Codes am Zeilenanfang bleiben
   * vorn, damit die Leerzeichen nicht fett/unterstrichen werden.
   */
  function center(text) {
    return normalize(text).split('\n').slice(0, 2).map((line) => {
      const m = line.match(/^((?:§[0-9a-fk-or])*)\s*/i);
      const codes = m ? m[1] : '';
      const rest = line.slice(m ? m[0].length : 0).replace(/\s+$/, '');
      const free = LIST_WIDTH - width(codes + rest);
      const pad = free > 0 ? Math.floor(free / 2 / 4) : 0;
      return ' '.repeat(pad) + codes + rest;
    }).join('\n');
  }
  /** Vorlagen für schöne MOTDs – {name} wird durch den Servernamen ersetzt. */
  const TEMPLATES = [
    { id: 'welcome', text: '§6§l{name}§r\n§7Willkommen – §aschau rein!' },
    { id: 'survival', text: '§2§l✦ {name} ✦§r\n§aSurvival §7· §eFreunde §7· §bkein Reset' },
    { id: 'event', text: '§d§l★ EVENT HEUTE ★§r\n§fAb §e20 Uhr §fauf §b{name}' },
    { id: 'maintenance', text: '§c§lWartung§r\n§7Gleich wieder da – danke für die Geduld!' },
    { id: 'creative', text: '§b§l{name}§r §7| §dKreativ\n§7Bauen ohne Grenzen' },
    { id: 'info', text: '§6§l{name} §r§7· §f{type} {version}\n§7Neustart: §e{restart} §7· §bbis {max} Spieler' },
    { id: 'today', text: '§a§l{name}§r §7– §f{weekday}\n§7Stand {date}, {time} Uhr' },
  ];
  const TEMPLATES_EN = { welcome: '§6§l{name}§r\n§7Welcome – §acome on in!', survival: '§2§l✦ {name} ✦§r\n§aSurvival §7· §eFriends §7· §bno reset', event: '§d§l★ EVENT TONIGHT ★§r\n§fFrom §e8 pm §fon §b{name}', maintenance: '§c§lMaintenance§r\n§7Back soon – thanks for your patience!', creative: '§b§l{name}§r §7| §dCreative\n§7Build without limits', info: '§6§l{name} §r§7· §f{type} {version}\n§7Restart: §e{restart} §7· §bup to {max} players', today: '§a§l{name}§r §7– §f{weekday}\n§7As of {date}, {time}' };
  /** Vorlage in der Sprache der Oberfläche, mit eingesetztem Namen (ohne § im Namen; '{name}' lässt den Platzhalter stehen). */
  function template(id, name, lang = 'de') {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (!tpl) return '';
    const text = lang === 'en' ? TEMPLATES_EN[id] : tpl.text;
    return text.replace(/\{name\}/g, String(name || 'Server').replace(/§/g, '').slice(0, 30));
  }

  /* ---------- Server-Symbol: Bild quadratisch zuschneiden (64×64, wie Minecraft es verlangt) ---------- */
  /**
   * Ausschnitt im Quellbild für Zoom (1 = ganze kurze Seite) und Verschiebung x/y (-1 … 1).
   * → { sx, sy, size } in Pixeln des Quellbilds
   */
  function crop(w, h, zoom = 1, x = 0, y = 0) {
    const short = Math.min(w, h);
    const size = Math.max(1, Math.round(short / Math.max(1, zoom)));
    const clamp = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
    const sx = Math.round(((w - size) / 2) * (1 + clamp(x)));
    const sy = Math.round(((h - size) / 2) * (1 + clamp(y)));
    return { sx, sy, size };
  }

  /* ---------- Platzhalter (1.3) ----------
   * Minecraft liest die Beschreibung nur beim Start aus server.properties – Platzhalter setzt das MOTD-Studio deshalb beim
   * Speichern und bei „Jetzt neu starten“ ein (die Vorlage mit Platzhaltern merkt es sich). Live-Werte wie „gerade online“
   * gehen so nicht – die zeigt die Serverliste ohnehin rechts daneben.
   */
  const PLACEHOLDERS = ['name', 'version', 'type', 'max', 'date', 'time', 'weekday', 'restart'];
  const pad2 = (n) => String(n).padStart(2, '0');
  /** Werte zu einem Zeitpunkt: { name, version, type, max, nextRestart (ms|null) }, lang de|en. */
  function values(server, now = Date.now(), lang = 'de') {
    const d = new Date(now);
    const s = server || {};
    const fmtDate = (x) => (lang === 'en' ? `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}` : `${pad2(x.getDate())}.${pad2(x.getMonth() + 1)}.${x.getFullYear()}`);
    const fmtTime = (x) => `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
    const days = lang === 'en' ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] : ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    let restart = '';
    if (s.nextRestart) {
      const r = new Date(s.nextRestart);
      const same = r.toDateString() === d.toDateString();
      restart = same ? `${lang === 'en' ? 'today' : 'heute'} ${fmtTime(r)}` : `${days[r.getDay()].slice(0, 2)} ${fmtTime(r)}`;
    }
    const clean = (v) => String(v == null ? '' : v).replace(/§/g, '').slice(0, 40);
    return { name: clean(s.name || 'Server'), version: clean(s.version), type: clean(s.typeLabel || s.type), max: clean(s.maxPlayers || 20), date: fmtDate(d), time: fmtTime(d), weekday: days[d.getDay()], restart: clean(restart || (lang === 'en' ? 'not planned' : 'nicht geplant')) };
  }
  /** {name} … durch Werte ersetzen; unbekannte Platzhalter bleiben stehen (die Prüfung meldet sie). */
  function resolve(text, vals) {
    return String(text || '').replace(/\{([a-z]+)\}/g, (m, k) => (PLACEHOLDERS.includes(k) && vals && vals[k] !== undefined ? vals[k] : m));
  }
  const hasPlaceholders = (text) => /\{(name|version|type|max|date|time|weekday|restart)\}/.test(String(text || ''));
  /** Unbekannte {platzhalter} (Tippfehler) */
  function unknownPlaceholders(text) { return [...String(text || '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => !PLACEHOLDERS.includes(k)); }

  /* ---------- Farbverläufe (1.3) ----------
   * server.properties kennt nur die 16 Minecraft-Farben. Ein Verlauf wird daher je Zeichen auf die nächstliegende dieser
   * Farben abgebildet (sichtbare Stufen). Echte Hex-Farben (ab 1.16) gehen nur über ein Plugin wie MiniMOTD – dafür gibt
   * es toMiniMessage() zum Kopieren.
   */
  const rgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  /** Nächste Minecraft-Farbe (Code 0–f) zu einer Hex-Farbe – gewichteter Abstand wie das Auge. */
  function nearest(hex) {
    const [r, g, b] = rgb(hex);
    let best = 'f'; let bestD = Infinity;
    for (const [code, h] of Object.entries(COLORS)) {
      const [r2, g2, b2] = rgb(h);
      const rm = (r + r2) / 2;
      const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2;
      if (d < bestD) { bestD = d; best = code; }
    }
    return best;
  }
  /** Text als Verlauf von → bis (Hex) in §-Codes; Leerzeichen bekommen keinen eigenen Code. fmt = z. B. 'l' für fett. */
  function gradient(text, from, to, fmt = '') {
    const chars = [...String(text || '').replace(/§[0-9a-fk-or]/gi, '')];
    const vis = chars.filter((c) => c.trim()).length;
    const [a, b] = [rgb(from), rgb(to)];
    let out = ''; let last = null; let i = 0;
    for (const ch of chars) {
      if (!ch.trim()) { out += ch; continue; }
      const t = vis > 1 ? i / (vis - 1) : 0;
      const hex = '#' + a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, '0')).join('');
      const code = nearest(hex);
      if (code !== last) { out += `§${code}${fmt ? `§${fmt}` : ''}`; last = code; }
      out += ch; i++;
    }
    return out + (chars.length ? '§r' : '');
  }
  /** §-Text → MiniMessage (für MiniMOTD & Co. auf Paper): Farben als <#hex>, Formate als Tags, Zeilen mit <newline>. */
  function toMiniMessage(text) {
    const TAG = { bold: 'bold', italic: 'italic', underline: 'underlined', strike: 'strikethrough', obfuscated: 'obfuscated' };
    return parse(text).map((line) => line.map((s) => {
      const open = Object.keys(TAG).filter((k) => s[k]).map((k) => `<${TAG[k]}>`).join('');
      const close = Object.keys(TAG).filter((k) => s[k]).reverse().map((k) => `</${TAG[k]}>`).join('');
      const safe = s.text.replace(/</g, '\\<');
      return `<${s.color.toLowerCase()}>${open}${safe}${close}</${s.color.toLowerCase()}>`;
    }).join('')).join('<newline>');
  }

  /* ---------- Varianten (1.3): mehrere Beschreibungen, beim Neustart über das MOTD-Studio der Reihe nach ---------- */
  /** Nächste Variante nach index (rundum); leere werden übersprungen. → { index, text } */
  function nextVariant(list, index) {
    const l = (Array.isArray(list) ? list : []).map((x) => String(x || ''));
    if (!l.some((x) => x.trim())) return { index: 0, text: '' };
    for (let k = 1; k <= l.length; k++) { const i = (Number(index) + k + l.length) % l.length; if (l[i].trim()) return { index: i, text: l[i] }; }
    return { index: 0, text: l[0] };
  }

  /** Nächster geplanter Neustart dieses Servers aus Hostwerks Aufgaben (Aktion mc-restart, eingeschaltet) – ms oder null. */
  function nextRestart(tasks, serverId) {
    const list = Array.isArray(tasks) ? tasks : (tasks && Array.isArray(tasks.list) ? tasks.list : []);
    const times = list.filter((x) => x && x.enabled !== false && x.action && x.action.type === 'mc-restart' && x.action.target === serverId && Number(x.nextRun) > 0).map((x) => Number(x.nextRun));
    return times.length ? Math.min(...times) : null;
  }

  return { COLORS, FORMATS, MAX_LINE, LIST_WIDTH, normalize, parse, plain, check, toProperty, insert, width, center, TEMPLATES, template, crop,
    PLACEHOLDERS, values, resolve, hasPlaceholders, unknownPlaceholders, nearest, gradient, toMiniMessage, nextVariant, nextRestart };
}));
