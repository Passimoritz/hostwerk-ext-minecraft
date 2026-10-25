const test = require('node:test');
const assert = require('node:assert');
const L = require('../page-motd/live.js');

/** Kleines Dokument-Double: hidden umschalten und visibilitychange auslösen. */
function fakeDoc() {
  const ls = [];
  return { hidden: false, addEventListener: (t, f) => ls.push(f), removeEventListener: (t, f) => ls.splice(ls.indexOf(f), 1), fire() { for (const f of [...ls]) f(); }, count: () => ls.length };
}

test('every: läuft nur bei sichtbarem Reiter, holt Verpasstes beim Zurückkommen nach', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const doc = fakeDoc();
  let n = 0;
  const h = L.every(5000, () => { n++; }, doc);
  t.mock.timers.tick(5000); assert.strictEqual(n, 1);
  doc.hidden = true;
  t.mock.timers.tick(15000); assert.strictEqual(n, 1, 'versteckt: keine Abfragen');
  doc.hidden = false; doc.fire(); assert.strictEqual(n, 2, 'zurück: sofort einmal');
  doc.fire(); assert.strictEqual(n, 2, 'ohne verpassten Takt kein Extra-Aufruf');
  h.stop(); t.mock.timers.tick(20000); assert.strictEqual(n, 2);
  assert.strictEqual(doc.count(), 0, 'Ereignis wieder abgemeldet');
});

test('every: Takt lässt sich ändern, mindestens eine Sekunde', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let n = 0;
  const h = L.every(10, () => { n++; }, null);
  t.mock.timers.tick(999); assert.strictEqual(n, 0);
  t.mock.timers.tick(1); assert.strictEqual(n, 1);
  h.every(3000); t.mock.timers.tick(3000); assert.strictEqual(n, 2);
  h.stop();
});

test('throttle: erster Aufruf sofort, ein Schwall wird zu einem', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let n = 0;
  const f = L.throttle(() => { n++; }, 2000);
  f(); f(); f(); assert.strictEqual(n, 1);
  t.mock.timers.tick(2000); assert.strictEqual(n, 2);
  t.mock.timers.tick(5000); assert.strictEqual(n, 2);
});

test('guard: Fehler zeichnet den Fehlerzustand, Erfolg nicht', async () => {
  const drawn = [];
  const node = { querySelector: () => null };
  const H = { render: (el, x) => drawn.push(x), html: (s, ...v) => s.raw.join('|') + v.join('|'), t: (k) => k };
  assert.strictEqual(await L.guard(H, node, async () => {}), true);
  assert.strictEqual(drawn.length, 0);
  assert.strictEqual(await L.guard(H, node, async () => { throw new Error('kaputt'); }), false);
  assert.strictEqual(drawn.length, 1);
  assert.match(drawn[0], /loadError/); assert.match(drawn[0], /kaputt/); assert.match(drawn[0], /retry/);
});
