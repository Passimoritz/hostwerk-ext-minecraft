'use strict';
// NBT-Baum für die Dateivorschau (bis Hostwerk 3.1 im Kern): GET /mc/nbt liest level.dat & Co. nur lesend als JSON.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nbt = require('../server/nbt');
const { routes } = require('../server/nbtview');

const { T } = nbt;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mc-nbt-'));
// Kleiner Ersatz für Hostwerks Router und ctx.files.resolve
const handlers = {};
routes({ get: (p, fn) => { handlers[p] = fn; } }, { files: { resolve: (root, rel) => ({ full: path.join(dir, rel) }) } });
const call = (rel) => new Promise((resolve, reject) => handlers['/mc/nbt']({ query: { root: 'x', path: rel } }, { json: resolve }, reject));

test('level.dat als Baum, lange Zahlen als Text', async () => {
  nbt.write(path.join(dir, 'level.dat'), { name: '', root: { t: T.COMPOUND, v: [['Data', { t: T.COMPOUND, v: [['LevelName', { t: T.STRING, v: 'Welt' }], ['Time', { t: T.LONG, v: 123456789n }], ['GameRules', { t: T.COMPOUND, v: [['keepInventory', { t: T.STRING, v: 'true' }]] }]] }]] } });
  const r = await call('level.dat');
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.tree.Data.LevelName, 'Welt');
  assert.strictEqual(r.tree.Data.Time, '123456789L');
  assert.strictEqual(r.tree.Data.GameRules.keepInventory, 'true');
});

test('keine NBT-Datei: verständliche Meldung statt Fehler', async () => {
  fs.writeFileSync(path.join(dir, 'kaputt.dat'), 'kein nbt');
  const r = await call('kaputt.dat');
  assert.ok(!r.ok && /NBT/.test(r.error), JSON.stringify(r));
});
