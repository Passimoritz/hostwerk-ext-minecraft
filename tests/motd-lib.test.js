const test = require('node:test');
const assert = require('node:assert');
const M = require('../page-motd/lib.js');

test('Farben und Formate werden zu Abschnitten', () => {
  const l = M.parse('§aGrün §lfett§r normal');
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual(l[0].map((s) => [s.text, s.color, s.bold]), [['Grün ', '#55FF55', false], ['fett', '#55FF55', true], [' normal', '#AAAAAA', false]]);
});

test('Farbe setzt Formate zurück (wie im Spiel)', () => {
  const l = M.parse('§c§lRot fett §9blau');
  assert.strictEqual(l[0][0].bold, true);
  assert.strictEqual(l[0][1].bold, false);
  assert.strictEqual(l[0][1].color, '#5555FF');
});

test('server.properties-Schreibweise wird verstanden und geschrieben', () => {
  assert.strictEqual(M.plain('\\u00A7aHallo\\nWelt'), 'Hallo\nWelt');
  assert.strictEqual(M.toProperty('§aHallo\nWelt'), '\\u00A7aHallo\\nWelt');
});

test('Prüfung: zu viele Zeilen, zu lang, unbekannter Code', () => {
  assert.deepStrictEqual(M.check('§aOk'), []);
  assert.ok(M.check('a\nb\nc').some((p) => p.code === 'lines'));
  assert.ok(M.check('x'.repeat(70)).some((p) => p.code === 'long' && p.length === 70));
  assert.ok(M.check('§zFalsch').some((p) => p.code === 'unknown'));
});

test('Einfügen: Code an der Stelle oder Auswahl einfassen', () => {
  assert.deepStrictEqual(M.insert('Hallo', 5, 5, 'a'), { text: 'Hallo§a', cursor: 7 });
  assert.deepStrictEqual(M.insert('Hallo Welt', 6, 10, 'l'), { text: 'Hallo §lWelt§r', cursor: 14 });
});

test('§k gehört zu den Formaten (Werkzeugleiste und Tabelle)', () => {
  assert.strictEqual(M.FORMATS.k, 'obfuscated');
  assert.strictEqual(M.parse('§kGeheim')[0][0].obfuscated, true);
});

test('Breite wie Minecrafts Schrift: Codes zählen nicht, fett ist breiter', () => {
  assert.strictEqual(M.width('aaa'), 18);
  assert.strictEqual(M.width('§aaaa'), 18);
  assert.strictEqual(M.width('§laaa'), 21);
  assert.strictEqual(M.width('il!'), 7);
});

test('Zentrieren: Leerzeichen davor, Codes bleiben vorn, alte Einrückung wird ersetzt', () => {
  const c = M.center('§6§lHallo\n   §7Welt');
  const [a, b] = c.split('\n');
  assert.match(a, /^ +§6§lHallo$/); assert.match(b, /^ +§7Welt$/);
  const pad = (s) => s.match(/^ */)[0].length;
  assert.strictEqual(pad(a), Math.floor((M.LIST_WIDTH - M.width('§6§lHallo')) / 8));
  assert.strictEqual(M.center(M.center('§aX')), M.center('§aX'), 'zweimal zentrieren ändert nichts');
  assert.strictEqual(M.center('x'.repeat(80)).startsWith('x'), true, 'zu lange Zeile bleibt links');
});

test('Vorlagen: Name eingesetzt, beide Sprachen, ohne § aus dem Namen', () => {
  for (const tpl of M.TEMPLATES) {
    const de = M.template(tpl.id, '§cFreunde', 'de'); const en = M.template(tpl.id, 'Friends', 'en');
    assert.ok(de && en, tpl.id);
    assert.deepStrictEqual(M.check(de).filter((p) => p.code !== 'long'), [], `${tpl.id}: gültig`);
    assert.ok(!de.includes('{name}') && !/§cFreunde/.test(de));
  }
  assert.strictEqual(M.template('gibtsnicht', 'x'), '');
});

test('Symbol-Zuschnitt: quadratisch, mittig, Zoom und Verschiebung bleiben im Bild', () => {
  assert.deepStrictEqual(M.crop(200, 100), { sx: 50, sy: 0, size: 100 });
  assert.deepStrictEqual(M.crop(200, 100, 2), { sx: 75, sy: 25, size: 50 });
  assert.deepStrictEqual(M.crop(200, 100, 2, -1, 1), { sx: 0, sy: 50, size: 50 });
  assert.deepStrictEqual(M.crop(200, 100, 1, 5, 0), { sx: 100, sy: 0, size: 100 }, 'Verschiebung begrenzt');
});

/* ---------- 1.3: Platzhalter, Verläufe, MiniMessage, Varianten ---------- */
test('Platzhalter werden eingesetzt, unbekannte bleiben stehen und werden gemeldet', () => {
  const now = new Date(2026, 9, 21, 9, 5).getTime(); // Mittwoch
  const v = M.values({ name: 'Survival §cX', version: '1.21.4', typeLabel: 'Paper', maxPlayers: 30, nextRestart: new Date(2026, 9, 21, 4 + 20, 0).getTime() }, now, 'de');
  assert.strictEqual(M.resolve('{name} {version} {type} {max} {date} {time} {weekday}', v), 'Survival cX 1.21.4 Paper 30 21.10.2026 09:05 Mittwoch');
  assert.strictEqual(v.restart, 'Do 00:00', 'nicht heute → Wochentag kurz + Uhrzeit');
  assert.strictEqual(M.values({ nextRestart: new Date(2026, 9, 21, 22, 30).getTime() }, now, 'de').restart, 'heute 22:30');
  assert.strictEqual(M.values({}, now, 'en').restart, 'not planned');
  assert.strictEqual(M.resolve('{online} {name}', { name: 'A' }), '{online} A');
  assert.deepStrictEqual(M.unknownPlaceholders('{nme} {name}'), ['nme']);
  assert.ok(M.hasPlaceholders('§a{restart}')); assert.ok(!M.hasPlaceholders('kein {x}'));
});

test('Nächster Neustart kommt aus Hostwerks Aufgaben (nur eingeschaltete mc-restart dieses Servers)', () => {
  const tasks = { list: [
    { enabled: true, action: { type: 'mc-restart', target: 'a' }, nextRun: 500 },
    { enabled: true, action: { type: 'mc-restart', target: 'a' }, nextRun: 300 },
    { enabled: false, action: { type: 'mc-restart', target: 'a' }, nextRun: 100 },
    { enabled: true, action: { type: 'mc-backup', target: 'a' }, nextRun: 50 },
    { enabled: true, action: { type: 'mc-restart', target: 'b' }, nextRun: 10 },
  ] };
  assert.strictEqual(M.nextRestart(tasks, 'a'), 300);
  assert.strictEqual(M.nextRestart(tasks, 'c'), null);
  assert.strictEqual(M.nextRestart(null, 'a'), null);
});

test('Verlauf: nur die 16 Minecraft-Farben, ein Code je Farbwechsel, Leerzeichen ohne Code', () => {
  assert.strictEqual(M.nearest('#ff0000'), '4'); assert.strictEqual(M.nearest('#ff6060'), 'c');
  assert.strictEqual(M.nearest('#000000'), '0');
  const g = M.gradient('Hallo Welt', '#ffaa00', '#5555ff', 'l');
  assert.strictEqual(M.plain(g), 'Hallo Welt');
  assert.ok(g.startsWith('§6§l'));
  assert.ok(/§9§l[^§]*t§r$/.test(g), g);
  assert.ok(!/§[0-9a-f]§l /.test(g), 'Leerzeichen bekommen keinen eigenen Code');
  assert.strictEqual(M.gradient('', '#000000', '#ffffff'), '');
});

test('MiniMessage: Farben als Hex, Formate als Tags, Zeilen mit <newline>, < maskiert', () => {
  assert.strictEqual(M.toMiniMessage('§a§lHi§r <x>\nZwei'), '<#55ff55><bold>Hi</bold></#55ff55><#aaaaaa> \\<x></#aaaaaa><newline><#aaaaaa>Zwei</#aaaaaa>');
});

test('Varianten: der Reihe nach, leere übersprungen', () => {
  assert.deepStrictEqual(M.nextVariant(['a', '', 'c'], 0), { index: 2, text: 'c' });
  assert.deepStrictEqual(M.nextVariant(['a', '', 'c'], 2), { index: 0, text: 'a' });
  assert.deepStrictEqual(M.nextVariant(['', ''], 0), { index: 0, text: '' });
});

test('Neue Vorlagen mit Platzhaltern', () => {
  assert.ok(M.hasPlaceholders(M.template('info', '{name}', 'de')));
  assert.ok(M.template('today', 'X', 'en').startsWith('§a§lX'));
});
