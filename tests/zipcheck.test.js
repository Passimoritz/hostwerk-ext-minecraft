'use strict';
// Sicherung vor dem Wiederherstellen prüfen: gültiges ZIP, abgeschnittenes ZIP, kein ZIP, leeres ZIP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = path.join(process.env.HW_CORE_DIR || path.join(__dirname, '..', '..', '..', 'hostwerk', 'server', 'core'));
const hw = require(path.join(__dirname, '..', 'server', 'hw'));
const haveCore = fs.existsSync(path.join(CORE, 'util.js'));
if (haveCore) hw.setCoreDir(CORE);

test('checkZip erkennt gültige und beschädigte Sicherungen', { skip: !haveCore && 'Hostwerk-Kern nicht gefunden (HW_CORE_DIR)' }, async () => {
  const { zipDir } = require(path.join(CORE, 'util'));
  const { checkZip } = require(path.join(__dirname, '..', 'server', 'zipcheck'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mc-zipcheck-'));
  try {
    const src = path.join(root, 'srv');
    fs.mkdirSync(path.join(src, 'world'), { recursive: true });
    fs.writeFileSync(path.join(src, 'server.properties'), 'motd=Test\n');
    fs.writeFileSync(path.join(src, 'world', 'level.dat'), Buffer.alloc(4096, 7));
    const good = path.join(root, 'good.zip');
    await zipDir(src, good);
    const r = await checkZip(good);
    assert.strictEqual(r.ok, true);
    assert.ok(r.entries >= 2);

    const cut = path.join(root, 'cut.zip');
    const buf = fs.readFileSync(good);
    fs.writeFileSync(cut, buf.subarray(0, Math.floor(buf.length / 2)));
    assert.strictEqual((await checkZip(cut)).ok, false);

    const txt = path.join(root, 'kein.zip');
    fs.writeFileSync(txt, 'kein zip');
    const bad = await checkZip(txt);
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.error);

    const empty = path.join(root, 'leer.zip');
    // Leeres ZIP: nur der Abschluss-Eintrag (End of central directory)
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
    fs.writeFileSync(empty, eocd);
    assert.strictEqual((await checkZip(empty)).ok, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
