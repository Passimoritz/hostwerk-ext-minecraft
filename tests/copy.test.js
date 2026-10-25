'use strict';
// Klonen eines Minecraft-Servers (kind.copy.clone, bis Hostwerk 3.1 im Kern): ohne Welt und Protokolle, freier Port und
// freier RCON-Port in server.properties, Kopie startet nicht automatisch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = path.join(process.env.HW_CORE_DIR || path.join(__dirname, '..', '..', '..', 'hostwerk', 'server', 'core'));
const hw = require(path.join(__dirname, '..', 'server', 'hw'));
const haveCore = fs.existsSync(path.join(CORE, 'ports.js'));
if (haveCore) hw.setCoreDir(CORE);

test('Klonen ohne Welt: Plugins mit, Welt und Protokolle nicht, neuer Port', { skip: !haveCore && 'Hostwerk-Kern nicht gefunden (HW_CORE_DIR)' }, async () => {
  const { minecraftCopy } = require(path.join(__dirname, '..', 'server', 'copy'));
  const { parseProps, writeProps } = require(path.join(__dirname, '..', 'server', 'manager'));
  const { copyDir } = require(path.join(__dirname, '..', 'server', 'trial'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mc-clone-'));
  const src = path.join(root, 'survival');
  for (const d of ['plugins', 'world', 'logs']) fs.mkdirSync(path.join(src, d), { recursive: true });
  fs.writeFileSync(path.join(src, 'server.properties'), '#x\nserver-port=25565\nrcon.port=25575\nmotd=Hallo\n');
  fs.writeFileSync(path.join(src, 'plugins', 'a.jar'), 'jar');
  fs.writeFileSync(path.join(src, 'world', 'level.dat'), 'w');
  fs.writeFileSync(path.join(src, 'logs', 'latest.log'), 'l');
  const servers = [{ id: 'survival', name: 'Survival', port: 25565, type: 'paper', autostart: true }];
  let saved = 0;
  const mc = {
    list: () => servers, get: (id) => servers.find((x) => x.id === id), dir: (id) => path.join(root, id),
    proc: () => ({ isRunning: () => false }), paths: { mcDir: (id) => path.join(root, id) }, settings: { save: () => { saved++; } },
    helpers: { copyDir, parseProps, writeProps },
  };
  const job = { progress() {}, log() {} };
  const r = await minecraftCopy(mc).clone('survival', { name: 'Survival Test', withData: false }, job);
  const copy = servers.find((x) => x.id === r.id);
  assert.ok(copy && copy.id !== 'survival' && copy.autostart === false && copy.clonedFrom === 'survival');
  assert.notStrictEqual(copy.port, 25565);
  const dir = path.join(root, r.id);
  assert.ok(fs.existsSync(path.join(dir, 'plugins', 'a.jar')), 'Plugins kopiert');
  assert.ok(!fs.existsSync(path.join(dir, 'world')), 'ohne Welt');
  const props = fs.readFileSync(path.join(dir, 'server.properties'), 'utf8');
  assert.match(props, new RegExp(`server-port=${copy.port}`));
  assert.match(props, /motd=Hallo/);
  assert.doesNotMatch(props, /rcon\.port=25575/, 'eigener RCON-Port');
  assert.strictEqual(saved, 1);
  assert.strictEqual(r.href, `#/mc/${r.id}`);
  fs.rmSync(root, { recursive: true, force: true });
});
