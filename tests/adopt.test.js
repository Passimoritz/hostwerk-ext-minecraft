'use strict';
// Übernahme fremder Server (kind.adopt): Erkennung über die startende .bat, Typ und Version aus dem JAR-Namen, Port und RAM.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require(path.join(__dirname, '..', 'server', 'hw')).init({ core: () => ({}), lib: () => ({}), t: (s) => s });
const { detectMinecraft, minecraftAdopt } = require(path.join(__dirname, '..', 'server', 'adopt'));

// Hilfen, die Hostwerk mitgibt (hier vereinfacht)
const splitCmd = (s) => (String(s || '').match(/"[^"]*"|\S+/g) || []).map((x) => x.replace(/^"|"$/g, ''));
const h = { splitCmd, versionOf: async () => null };

test('Ordner über die startende .bat finden (Windows kennt das Arbeitsverzeichnis fremder Prozesse nicht)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mc-adopt-'));
  try {
    const dir = path.join(tmp, 'mein server');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'server.properties'), 'server-port=25577\nmotd=Mein Server\n');
    fs.writeFileSync(path.join(dir, 'paper-1.21.8-40.jar'), 'x');
    const java = process.execPath;
    const byPid = new Map([[10, { pid: 10, ppid: 1, name: 'cmd.exe', cmd: `cmd /c "${path.join(dir, 'start.bat')}"` }]]);
    const m = await detectMinecraft({ pid: 11, ppid: 10, name: 'java.exe', exe: java, cmd: `"${java}" -Xms1G -Xmx6G -XX:+UseG1GC -jar paper-1.21.8-40.jar nogui` }, byPid, h);
    assert.ok(m);
    assert.deepStrictEqual([m.dir, m.type, m.version, m.port, m.memMax, m.extraArgs, m.motd], [dir, 'paper', '1.21.8', 25577, 6144, '-XX:+UseG1GC', 'Mein Server']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Ohne server.properties ist es kein Minecraft-Server', async () => {
  const m = await detectMinecraft({ pid: 1, ppid: 0, name: 'java.exe', exe: process.execPath, cmd: 'java -jar irgendwas.jar' }, new Map(), h);
  assert.strictEqual(m, null);
});

test('kind.adopt: Erkennung nur für Java, eigener Port, Ordner zum Kopieren', () => {
  const a = minecraftAdopt({ list: () => [{ id: 'a', externalDir: 'C:/mc/alt' }] });
  assert.strictEqual(a.match('java'), true);
  assert.strictEqual(a.match('node'), false);
  assert.strictEqual(a.keepPort, true);
  assert.deepStrictEqual(a.owned(), ['C:/mc/alt']);
  assert.deepStrictEqual(a.oldPaths({ dir: 'D:/srv' }), ['D:/srv']);
  assert.strictEqual(a.copies({ dir: 'D:/srv' })[0].from, 'D:/srv');
});
