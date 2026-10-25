'use strict';
// Nächtliche Sicherung (bis Hostwerk 3.1 im Kern): fällig nach Hostwerks Zeitplan, gestoppt + unverändert übersprungen,
// Aufbewahrung nur der automatischen Sicherungen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Hostwerks Kernbausteine direkt aus dem Nachbar-Ordner (sonst kommen sie über host.core)
const CORE = path.join(process.env.HW_CORE_DIR || path.join(__dirname, '..', '..', '..', 'hostwerk', 'server', 'core'));
const hw = require(path.join(__dirname, '..', 'server', 'hw'));
const haveCore = fs.existsSync(path.join(CORE, 'nightly.js'));
if (haveCore) hw.setCoreDir(CORE);

const DAY = 86400000;
const at = (s) => new Date(s).getTime();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mc-nightly-'));
const settingsOf = () => ({ get: () => ({}), save() {} });

test('fällig nach demselben Plan, gestoppt + unverändert übersprungen', { skip: !haveCore && 'Hostwerk-Kern nicht gefunden (HW_CORE_DIR)' }, () => {
  const { NightlyBackups } = require(path.join(__dirname, '..', 'server', 'nightly'));
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'level.dat'), 'x');
  const old = at('2026-10-19T12:00:00') / 1000; fs.utimesSync(path.join(dir, 'level.dat'), old, old);
  const s = { id: 'a', nightlyBackup: { enabled: true, everyHours: 24, hour: 3, lastRun: at('2026-10-20T03:00:00') } };
  let running = true;
  const nb = new NightlyBackups({ settings: settingsOf() }, { list: () => [s], dir: () => dir, proc: () => ({ isRunning: () => running }) });
  assert.strictEqual(nb.dueList(at('2026-10-21T03:01:00')).length, 1);
  assert.strictEqual(nb.dueList(at('2026-10-20T08:00:00')).length, 0, 'am Morgen nach der Sicherung nicht noch einmal');
  running = false;
  assert.strictEqual(nb.dueList(at('2026-10-21T03:01:00')).length, 0, 'gestoppt, nichts geändert');
  nb.dispose();
});

test('Aufbewahrung nur der automatischen (7), eigene Sicherungen bleiben', { skip: !haveCore && 'Hostwerk-Kern nicht gefunden (HW_CORE_DIR)' }, async () => {
  const { NightlyBackups } = require(path.join(__dirname, '..', 'server', 'nightly'));
  const dir = tmp(); const bdir = tmp();
  fs.writeFileSync(path.join(dir, 'level.dat'), 'x');
  for (let i = 0; i < 9; i++) { const f = path.join(bdir, `2026-10-${10 + i}-auto.zip`); fs.writeFileSync(f, 'z'); const tm = at(`2026-10-${10 + i}T03:00:00`) / 1000; fs.utimesSync(f, tm, tm); }
  fs.writeFileSync(path.join(bdir, 'vor-update.zip'), 'z');
  const now = at('2026-10-21T03:10:00');
  const s = { id: 'mc1', name: 'Welt', nightlyBackup: { enabled: true, everyHours: 24, keep: 7, hour: 3, lastRun: now - DAY } };
  let running = false;
  const mc = { list: () => [s], get: () => s, dir: () => dir, backupDir: () => bdir, proc: () => ({ isRunning: () => running }), backup: () => ({ promise: Promise.resolve({}) }) };
  const nb = new NightlyBackups({ settings: settingsOf() }, mc);
  const old = (now - 2 * DAY) / 1000; fs.utimesSync(path.join(dir, 'level.dat'), old, old);
  assert.strictEqual(nb.dueList(now).length, 0, 'gestoppt und unverändert');
  running = true;
  assert.deepStrictEqual(await nb.tick(now), [{ id: 'mc1', ok: true }]);
  assert.strictEqual(fs.readdirSync(bdir).filter((f) => /-auto\.zip$/.test(f)).length, 7);
  assert.ok(fs.existsSync(path.join(bdir, 'vor-update.zip')), 'eigene Sicherung bleibt');
  nb.dispose();
});
