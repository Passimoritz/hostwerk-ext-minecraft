'use strict';
/*
 * README pictures of the Minecraft extension: a throwaway Hostwerk (temporary folder, never the real ~/Hostwerk) with
 * this extension and one freshly created Paper server that is running.
 *   docs/screenshot.png / .de.png   Minecraft → server → overview (health, quick actions, players)
 *   node tools/shots.js            (needs ../hostwerk with a built ui/dist and puppeteer-core + Chrome/Edge; downloads Paper)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, '..');
const HOSTWERK = process.env.HOSTWERK_DIR || path.join(DIR, '..', '..', 'hostwerk');
const { startServer } = require(path.join(HOSTWERK, 'scripts', 'lib', 'ui-server'));
const puppeteer = require(require.resolve('puppeteer-core', { paths: [HOSTWERK, DIR] }));
const EXE = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-mc-shots-'));
  fs.cpSync(DIR, path.join(ext, 'hostwerk-ext-minecraft'), { recursive: true, filter: (f) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(f) }); // docs/ bleibt: das Manifest nennt die Bilder
  const port = 21000 + Math.floor(Math.random() * 9000);
  const srv = await startServer({ port, ext, clicktest: false });
  const api = async (method, p, body) => { const r = await fetch(`${srv.origin}/api${p}`, { method, headers: { 'x-hostwerk-token': srv.token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${await r.text()}`); return r.json(); };
  const until = async (what, fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(1000); } throw new Error(`timed out: ${what}`); };
  const browser = await puppeteer.launch({ executablePath: EXE, headless: true });
  let id = null;
  try {
    // a real Paper server on a free port far away from 25565 (a real server of this PC keeps running)
    const mcPort = 26000 + Math.floor(Math.random() * 3000);
    const { job } = await api('POST', '/mc/servers', { name: 'Survival', type: 'paper', eula: true, memMax: 2048, port: mcPort });
    await until('server created', async () => { const x = await api('GET', `/jobs/${job}`); if (x.state === 'error') throw new Error(x.error); return x.state === 'done'; }, 10 * 60000);
    id = (await api('GET', '/mc/servers')).find((x) => x.name === 'Survival' && x.port === mcPort).id; // die Testdaten bringen eigene Server mit
    await api('POST', `/mc/servers/${id}/start`);
    await until('server ready', async () => { const s = (await api('GET', '/mc/servers')).find((x) => x.id === id); return s && s.proc && s.proc.extra && s.proc.extra.ready; }, 5 * 60000);
    await sleep(8000); // a few seconds of CPU/RAM history for the health tile
    fs.mkdirSync(path.join(DIR, 'docs'), { recursive: true });
    for (const lang of ['en', 'de']) {
      await api('PUT', '/settings/general', { language: lang });
      const suffix = lang === 'de' ? '.de' : '';
      const p = await browser.newPage();
      await p.setViewport({ width: 1440, height: 1000 });
      await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      await p.goto(`${srv.origin}/?token=${srv.token}#/mc/${id}`, { waitUntil: 'networkidle2' });
      await sleep(4000);
      await p.screenshot({ path: path.join(DIR, 'docs', `screenshot${suffix}.png`) });
      await p.close();
      console.log(`✓ ${lang}`);
    }
  } finally {
    if (id) await api('POST', `/mc/servers/${id}/stop`).catch(() => {});
    await sleep(3000);
    await browser.close();
    await srv.stop();
    fs.rmSync(ext, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
