'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchJson, cached, downloadFile, jobProgress, cmpVersion } = require('./hw').core('download');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER = 'https://fill.papermc.io/v3/projects/paper';
const FOLIA = 'https://fill.papermc.io/v3/projects/folia';
const VELOCITY = 'https://fill.papermc.io/v3/projects/velocity';
const FABRIC = 'https://meta.fabricmc.net/v2';
const NEOFORGE = 'https://maven.neoforged.net';
const FORGE = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const MODRINTH = 'https://api.modrinth.com/v2';
const IS_WIN = process.platform === 'win32';
const PURPUR = 'https://api.purpurmc.org/v2/purpur';
const BUILDTOOLS = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar';

const TTL = 10 * 60 * 1000;
const manifest = () => cached('mc-manifest', TTL, () => fetchJson(MANIFEST));
const isStable = (v) => !/(-|_)?(rc|pre|snapshot|beta|alpha)/i.test(v) && !/w\d+[a-z]$/i.test(v);

/**
 * Java-Hauptversion für eine Minecraft-Version (bevorzugt aus Mojangs Metadaten). Mit Servertyp: Software mit eigener
 * Versionierung (Velocity 4.2.0 …) gibt ihre Java-Version selbst vor.
 */
async function javaFor(mcVersion, type) {
  if (type && providers[type] && providers[type].java) return providers[type].java(mcVersion);
  try {
    const m = await manifest();
    const base = String(mcVersion).replace(/-(rc|pre)-?\d*$/i, '');
    const v = m.versions.find((x) => x.id === mcVersion) || m.versions.find((x) => x.id === base);
    if (v) {
      const info = await cached('mc-ver-' + v.id, 24 * 60 * 60 * 1000, () => fetchJson(v.url));
      if (info.javaVersion && info.javaVersion.majorVersion) return info.javaVersion.majorVersion;
      return 8;
    }
  } catch {}
  // Rückfallebene ohne Netz: grobe Zuordnung
  const v = String(mcVersion);
  if (/^\d{2}\./.test(v)) return 25;
  if (cmpVersion(v, '1.20.5') >= 0) return 21;
  if (cmpVersion(v, '1.18') >= 0) return 17;
  if (cmpVersion(v, '1.17') >= 0) return 16;
  return 8;
}

/** Installer von Forge/NeoForge ausführen (lädt Bibliotheken, legt das Start-Argumente-File an). */
function runInstaller(javaExe, installer, dir, job, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaExe, ['-jar', installer, '--installServer'], { cwd: dir, windowsHide: true });
    let lines = 0;
    const onData = (c) => {
      for (const l of c.toString('utf8').split(/\r?\n/)) {
        if (!l.trim()) continue;
        if (++lines % 20 === 0 || /error|exception/i.test(l)) job.log(l.slice(0, 300));
        if (lines % 40 === 0) job.progress(Math.min(94, 55 + lines / 30), `${label} wird eingerichtet …`);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label}-Installer ist fehlgeschlagen (Code ${code}) – Details im Protokoll.`))));
  });
}
/** Nach dem Installer: Start über das Argumente-File (ab Minecraft 1.17) oder eine erzeugte Server-JAR (ältere). */
function installedLaunch(dir, argsDir, jarPattern) {
  const args = path.join(argsDir, IS_WIN ? 'win_args.txt' : 'unix_args.txt');
  if (fs.existsSync(path.join(dir, args))) return { launch: { argsFile: args.split(path.sep).join('/') } };
  const jar = fs.readdirSync(dir).find((f) => jarPattern.test(f) && !/installer/i.test(f));
  if (jar) return { jar };
  throw new Error('Der Installer hat keine Startdatei angelegt.');
}
/** Passende Mod-Version von Modrinth in mods/ legen (z. B. Fabric API). */
async function modrinthMod(project, loader, mcVersion, dir, job) {
  try {
    const q = `loaders=${encodeURIComponent(JSON.stringify([loader]))}&game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}`;
    const v = (await fetchJson(`${MODRINTH}/project/${project}/version?${q}`))[0];
    if (!v) { job.log(`Kein passender Download für ${project} (${mcVersion}) – übersprungen.`); return; }
    const f = v.files.find((x) => x.primary) || v.files[0];
    fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
    await downloadFile(f.url, path.join(dir, 'mods', path.basename(f.filename)), { sha1: f.hashes && f.hashes.sha1 });
    job.log(`${v.name} in mods/ gelegt.`);
  } catch (e) { job.log(`${project}: ${e.message}`); }
}
/** NeoForge-Version → Minecraft-Version (21.1.x → 1.21.1, 21.0.x → 1.21, 26.1.x → 26.1). */
function neoMc(nv) {
  const p = String(nv).replace(/-.*$/, '').split('.');
  const a = Number(p[0]); const b = Number(p[1]);
  if (a >= 25) return p.length >= 4 && p[2] !== '0' ? `${a}.${b}.${p[2]}` : `${a}.${b}`;
  return b === 0 ? `1.${a}` : `1.${a}.${b}`;
}
const unstable = (v) => /alpha|beta|rc|pre|snapshot/i.test(v);

/*
 * Zweite Quelle: MCJars (versions.mcjars.app) sammelt die Builds vieler Server-Programme. Fällt die Schnittstelle eines
 * Projekts aus oder ändert sie sich (wie Paper 2025 von „v2“ auf „v3“), lädt Hostwerk über MCJars weiter.
 */
const MCJARS = 'https://versions.mcjars.app/api/v2/builds';
const MCJ_TYPE = { paper: 'PAPER', purpur: 'PURPUR', folia: 'FOLIA', velocity: 'VELOCITY', fabric: 'FABRIC' };
let keeperNote = null; // wird von manager.js gesetzt (Selbstwartung)
function setKeeper(fn) { keeperNote = fn; }
async function mcjarsAll(type) { return (await cached(`mcjars-${type}`, TTL, () => fetchJson(`${MCJARS}/${type}`))).builds || {}; }
async function mcjarsVersions(type) {
  const b = await mcjarsAll(type);
  const list = Object.entries(b).filter(([, x]) => x && x.latest && (x.latest.jarUrl || x.latest.zipUrl)).map(([id, x]) => ({ id, stable: x.type === 'RELEASE' && !x.latest.experimental && isStable(id) }));
  list.sort((a, b2) => cmpVersion(b2.id.replace(/-.*$/, ''), a.id.replace(/-.*$/, '')));
  return { latest: (list.find((v) => v.stable) || list[0] || {}).id || null, versions: list, source: 'MCJars' };
}
async function mcjarsDownload(type, version, dest, job, label) {
  const x = (await mcjarsAll(type))[version];
  const l = x && x.latest;
  if (!l || !l.jarUrl) throw new Error(`${label} ${version} gibt es auch bei MCJars nicht.`);
  job.log(`${label} ${version} ${l.name || ''} über MCJars`);
  await downloadFile(l.jarUrl, dest, { onProgress: jobProgress(job, `${label} ${version} herunterladen`, 40, 90) });
  if (l.jarSize && fs.statSync(dest).size !== l.jarSize) { fs.rmSync(dest, { force: true }); throw new Error('Download unvollständig (Größe stimmt nicht).'); }
  return { build: String(l.buildNumber || l.name || '') };
}
/** Fehler, die keine Quelle beheben kann (z. B. die Version gibt es wirklich nicht). */
const userError = (e) => /gibt es .*nicht|unterstützt .* nicht|Unbekannte/i.test(e.message);

const providers = {
  vanilla: {
    label: 'Vanilla',
    homepage: 'https://www.minecraft.net/download/server',
    description: 'Der offizielle Server von Mojang – ohne Plugins.',
    plugins: false,
    async versions() {
      const m = await manifest();
      return {
        latest: m.latest.release,
        latestSnapshot: m.latest.snapshot,
        versions: m.versions.filter((v) => v.type === 'release' || v.type === 'snapshot').map((v) => ({ id: v.id, stable: v.type === 'release', date: v.releaseTime })),
      };
    },
    async download(version, dest, job) {
      const m = await manifest();
      const v = m.versions.find((x) => x.id === version);
      if (!v) throw new Error('Unbekannte Vanilla-Version ' + version);
      const info = await fetchJson(v.url);
      if (!info.downloads || !info.downloads.server) throw new Error(`Für ${version} gibt es keinen offiziellen Server-Download.`);
      await downloadFile(info.downloads.server.url, dest, { sha1: info.downloads.server.sha1, onProgress: jobProgress(job, `Vanilla ${version} herunterladen`, 40, 95) });
      return { build: null };
    },
  },

  paper: {
    label: 'Paper',
    homepage: 'https://papermc.io/downloads/paper',
    description: 'Schneller, optimierter Server mit Plugin-Unterstützung (Bukkit/Spigot/Paper).',
    plugins: true,
    loaders: ['paper', 'spigot', 'bukkit'],
    async versions() {
      const j = await cached('paper-versions', TTL, () => fetchJson(PAPER));
      const list = [];
      for (const group of Object.keys(j.versions)) for (const v of j.versions[group]) list.push({ id: v, stable: isStable(v) });
      list.sort((a, b) => cmpVersion(b.id, a.id));
      return { latest: (list.find((v) => v.stable) || list[0]).id, versions: list };
    },
    /** Neueste Build-Nummer dieser Minecraft-Version (automatische Server-Updates ohne Versionssprung). */
    async latestBuild(version) { const b = await fetchJson(`${PAPER}/versions/${encodeURIComponent(version)}/builds/latest`); return b && b.id != null ? String(b.id) : null; },
    async download(version, dest, job) {
      const b = await fetchJson(`${PAPER}/versions/${encodeURIComponent(version)}/builds/latest`);
      const d = b.downloads && b.downloads['server:default'];
      if (!d) throw new Error(`Kein Paper-Build für ${version} gefunden.`);
      job.log(`Paper ${version} Build #${b.id} (${b.channel})`);
      await downloadFile(d.url, dest, { sha256: d.checksums && d.checksums.sha256, onProgress: jobProgress(job, `Paper ${version} herunterladen`, 40, 95) });
      return { build: String(b.id) };
    },
  },

  purpur: {
    label: 'Purpur',
    homepage: 'https://purpurmc.org/',
    description: 'Paper-Fork mit vielen zusätzlichen Einstellungen und Gameplay-Optionen.',
    plugins: true,
    loaders: ['purpur', 'paper', 'spigot', 'bukkit'],
    async versions() {
      const j = await cached('purpur-versions', TTL, () => fetchJson(PURPUR));
      const list = [...j.versions].reverse().map((v) => ({ id: v, stable: isStable(v) }));
      list.sort((a, b) => cmpVersion(b.id, a.id));
      return { latest: (j.metadata && j.metadata.current) || list[0].id, versions: list };
    },
    /** Neueste Build-Nummer dieser Minecraft-Version. */
    async latestBuild(version) { const info = await fetchJson(`${PURPUR}/${encodeURIComponent(version)}`); return info.builds && info.builds.latest ? String(info.builds.latest) : null; },
    async download(version, dest, job) {
      const info = await fetchJson(`${PURPUR}/${encodeURIComponent(version)}`);
      const build = info.builds && info.builds.latest;
      if (!build) throw new Error(`Kein Purpur-Build für ${version}.`);
      let md5;
      try { md5 = (await fetchJson(`${PURPUR}/${encodeURIComponent(version)}/${build}`)).md5; } catch {}
      job.log(`Purpur ${version} Build #${build}${md5 ? ' (md5 ' + md5 + ')' : ''}`);
      await downloadFile(`${PURPUR}/${encodeURIComponent(version)}/${build}/download`, dest, { onProgress: jobProgress(job, `Purpur ${version} herunterladen`, 40, 95) });
      return { build: String(build) };
    },
  },

  spigot: {
    label: 'Spigot',
    homepage: 'https://www.spigotmc.org/wiki/buildtools/',
    description: 'Der klassische Plugin-Server. Wird mit BuildTools lokal gebaut (dauert einige Minuten).',
    plugins: true,
    loaders: ['spigot', 'bukkit'],
    async versions() {
      const m = await manifest();
      const list = m.versions.filter((v) => v.type === 'release' && /^\d+\.\d+(\.\d+)?$/.test(v.id) && cmpVersion(v.id, '1.8') >= 0).map((v) => ({ id: v.id, stable: true, date: v.releaseTime }));
      return { latest: m.latest.release, versions: list };
    },
    async download(version, dest, job, ctx) {
      const btDir = path.join(ctx.paths.cache, 'buildtools');
      fs.mkdirSync(btDir, { recursive: true });
      const bt = path.join(btDir, 'BuildTools.jar');
      job.status('BuildTools herunterladen …');
      await downloadFile(BUILDTOOLS, bt, { onProgress: jobProgress(job, 'BuildTools herunterladen', 35, 40) });
      const out = path.join(btDir, 'out');
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(out, { recursive: true });
      job.progress(42, `Spigot ${version} wird gebaut – das dauert einige Minuten …`);
      await new Promise((resolve, reject) => {
        const p = spawn(ctx.javaExe, ['-jar', bt, '--rev', version, '--compile', 'spigot', '--output-dir', out], { cwd: btDir, windowsHide: true });
        let lines = 0;
        const onData = (c) => {
          for (const l of c.toString('utf8').split(/\r?\n/)) {
            if (!l.trim()) continue;
            job.log(l);
            lines++;
            // Grobe Fortschrittsschätzung anhand der Ausgabemenge
            if (lines % 25 === 0) job.progress(Math.min(94, 42 + lines / 40), `Spigot ${version} wird gebaut …`);
          }
        };
        p.stdout.on('data', onData);
        p.stderr.on('data', onData);
        p.on('error', reject);
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`BuildTools ist fehlgeschlagen (Code ${code}). Gibt es Spigot ${version} schon? Details im Protokoll.`))));
      });
      const jar = fs.readdirSync(out).find((f) => /^spigot-.*\.jar$/i.test(f));
      if (!jar) throw new Error('BuildTools hat keine spigot-*.jar erzeugt.');
      fs.rmSync(dest, { force: true });
      fs.renameSync(path.join(out, jar), dest);
      return { build: null };
    },
  },

  folia: {
    label: 'Folia',
    homepage: 'https://papermc.io/software/folia',
    description: 'Paper für sehr viele Spieler: verteilt die Welt auf alle Prozessorkerne. Nur Folia-taugliche Plugins.',
    plugins: true,
    loaders: ['folia'],
    async versions() {
      const j = await cached('folia-versions', TTL, () => fetchJson(FOLIA));
      const list = [];
      for (const group of Object.keys(j.versions)) for (const v of j.versions[group]) list.push({ id: v, stable: isStable(v) });
      list.sort((a, b) => cmpVersion(b.id, a.id));
      return { latest: (list.find((v) => v.stable) || list[0]).id, versions: list };
    },
    /** Neueste Build-Nummer dieser Minecraft-Version (automatische Server-Updates ohne Versionssprung). */
    async latestBuild(version) { const b = await fetchJson(`${FOLIA}/versions/${encodeURIComponent(version)}/builds/latest`); return b && b.id != null ? String(b.id) : null; },
    async download(version, dest, job) {
      const b = await fetchJson(`${FOLIA}/versions/${encodeURIComponent(version)}/builds/latest`);
      const d = b.downloads && b.downloads['server:default'];
      if (!d) throw new Error(`Kein Folia-Build für ${version} gefunden.`);
      job.log(`Folia ${version} Build #${b.id} (${b.channel})`);
      await downloadFile(d.url, dest, { sha256: d.checksums && d.checksums.sha256, onProgress: jobProgress(job, `Folia ${version} herunterladen`, 40, 95) });
      return { build: String(b.id) };
    },
  },

  fabric: {
    label: 'Fabric',
    homepage: 'https://fabricmc.net/use/server/',
    description: 'Leichter Mod-Server: Fabric-Mods (Leistung, Technik, Abenteuer) von Modrinth – Fabric API kommt gleich mit.',
    plugins: true,
    content: 'mods',
    loaders: ['fabric'],
    async versions() {
      const g = await cached('fabric-games', TTL, () => fetchJson(`${FABRIC}/versions/game`));
      const list = g.map((v) => ({ id: v.version, stable: !!v.stable }));
      return { latest: (list.find((v) => v.stable) || list[0]).id, versions: list };
    },
    async download(version, dest, job, ctx = {}) {
      const loaders = await fetchJson(`${FABRIC}/versions/loader/${encodeURIComponent(version)}`);
      if (!loaders.length) throw new Error(`Fabric unterstützt Minecraft ${version} (noch) nicht.`);
      const loader = ctx.loaderVersion || (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
      const installers = await cached('fabric-installers', TTL, () => fetchJson(`${FABRIC}/versions/installer`));
      const inst = (installers.find((i) => i.stable) || installers[0]).version;
      job.log(`Fabric Loader ${loader} (Installer ${inst}) für Minecraft ${version}`);
      await downloadFile(`${FABRIC}/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(loader)}/${encodeURIComponent(inst)}/server/jar`, dest, { onProgress: jobProgress(job, `Fabric ${version} herunterladen`, 40, 80) });
      if (!ctx.noExtras) { job.progress(85, 'Fabric API herunterladen …'); await modrinthMod('P7dR8mSH', 'fabric', version, path.dirname(dest), job); }
      return { build: loader };
    },
  },

  neoforge: {
    label: 'NeoForge',
    homepage: 'https://neoforged.net/',
    description: 'Mod-Server für große Mods und Modpacks (Create, Mekanism …) – der moderne Forge-Nachfolger.',
    plugins: true,
    content: 'mods',
    loaders: ['neoforge'],
    async all() {
      const j = await cached('neoforge-versions', TTL, () => fetchJson(`${NEOFORGE}/api/maven/versions/releases/net/neoforged/neoforge`));
      return (j.versions || []).filter((v) => /^\d+\.\d+/.test(v) && !/^0\./.test(v));
    },
    async versions() {
      const byMc = new Map();
      for (const nv of await this.all()) {
        const mc = neoMc(nv);
        const cur = byMc.get(mc);
        // Je Minecraft-Version die neueste NeoForge-Fassung, stabile bevorzugt
        if (!cur || (unstable(cur) && !unstable(nv)) || (unstable(cur) === unstable(nv) && cmpVersion(nv.replace(/-.*$/, ''), cur.replace(/-.*$/, '')) > 0)) byMc.set(mc, nv);
      }
      const list = [...byMc.entries()].map(([mc, nv]) => ({ id: mc, stable: !unstable(nv) && isStable(mc), loader: nv })).sort((a, b) => cmpVersion(b.id, a.id));
      return { latest: (list.find((v) => v.stable) || list[0]).id, versions: list };
    },
    async download(version, dest, job, ctx = {}) {
      let nv = ctx.loaderVersion;
      if (!nv) { const v = (await this.versions()).versions.find((x) => x.id === version); if (!v) throw new Error(`NeoForge gibt es für Minecraft ${version} nicht.`); nv = v.loader; }
      const dir = path.dirname(dest);
      const installer = path.join(dir, `neoforge-${nv}-installer.jar`);
      job.log(`NeoForge ${nv} für Minecraft ${version}`);
      await downloadFile(`${NEOFORGE}/releases/net/neoforged/neoforge/${nv}/neoforge-${nv}-installer.jar`, installer, { onProgress: jobProgress(job, `NeoForge ${nv} herunterladen`, 40, 52) });
      job.progress(55, 'NeoForge einrichten (lädt Bibliotheken, dauert 1–3 Minuten) …');
      await runInstaller(ctx.javaExe, installer, dir, job, 'NeoForge');
      for (const f of [installer, installer + '.log', path.join(dir, 'installer.log')]) fs.rmSync(f, { force: true });
      return { build: nv, ...installedLaunch(dir, path.join('libraries', 'net', 'neoforged', 'neoforge', nv), /^neoforge-.*\.jar$/i) };
    },
  },

  forge: {
    label: 'Forge',
    homepage: 'https://files.minecraftforge.net/',
    description: 'Der klassische Mod-Server – für ältere Modpacks und Mods, die es nur für Forge gibt.',
    plugins: true,
    content: 'mods',
    loaders: ['forge'],
    async promos() { return (await cached('forge-promos', TTL, () => fetchJson(FORGE_PROMOS))).promos || {}; },
    async versions() {
      const p = await this.promos();
      const mcs = [...new Set(Object.keys(p).map((k) => k.replace(/-(latest|recommended)$/, '')))].filter((v) => /^1\.\d+(\.\d+)?$/.test(v) && cmpVersion(v, '1.12') >= 0);
      const list = mcs.map((mc) => ({ id: mc, stable: !!p[`${mc}-recommended`], loader: p[`${mc}-recommended`] || p[`${mc}-latest`] })).sort((a, b) => cmpVersion(b.id, a.id));
      return { latest: (list.find((v) => v.stable) || list[0]).id, versions: list };
    },
    async download(version, dest, job, ctx = {}) {
      const p = await this.promos();
      const fv = ctx.loaderVersion || p[`${version}-recommended`] || p[`${version}-latest`];
      if (!fv) throw new Error(`Forge gibt es für Minecraft ${version} nicht.`);
      const dir = path.dirname(dest);
      const full = `${version}-${fv}`;
      const installer = path.join(dir, `forge-${full}-installer.jar`);
      job.log(`Forge ${fv} für Minecraft ${version}`);
      await downloadFile(`${FORGE}/${full}/forge-${full}-installer.jar`, installer, { onProgress: jobProgress(job, `Forge ${fv} herunterladen`, 40, 52) });
      job.progress(55, 'Forge einrichten (lädt Bibliotheken, dauert 1–3 Minuten) …');
      await runInstaller(ctx.javaExe, installer, dir, job, 'Forge');
      for (const f of [installer, installer + '.log', path.join(dir, 'installer.log')]) fs.rmSync(f, { force: true });
      return { build: fv, ...installedLaunch(dir, path.join('libraries', 'net', 'minecraftforge', 'forge', full), /^forge-.*\.jar$/i) };
    },
  },

  velocity: {
    label: 'Velocity',
    homepage: 'https://papermc.io/software/velocity',
    description: 'Proxy fürs Netzwerk: verbindet mehrere Server (Lobby, Survival, Minispiele) – Spieler wechseln mit /server.',
    plugins: true,
    proxy: true,
    loaders: ['velocity'],
    // Velocity 4.x ist für Java 25 gebaut (Klassenversion 69), 3.4+ für Java 21, ältere für Java 17
    java: (v) => (cmpVersion(String(v), '4.0.0') >= 0 ? 25 : cmpVersion(String(v), '3.4.0') >= 0 ? 21 : 17),
    async versions() {
      const j = await cached('velocity-versions', TTL, () => fetchJson(VELOCITY));
      const list = [];
      for (const group of Object.keys(j.versions)) for (const v of j.versions[group]) list.push({ id: v, stable: !/snapshot/i.test(v) });
      list.sort((a, b) => cmpVersion(b.id.replace(/-.*$/, ''), a.id.replace(/-.*$/, '')) || (a.stable === b.stable ? 0 : a.stable ? -1 : 1));
      return { latest: (list.find((v) => v.stable) || list[0]).id, versions: list };
    },
    /** Neueste Build-Nummer dieser Minecraft-Version (automatische Server-Updates ohne Versionssprung). */
    async latestBuild(version) { const b = await fetchJson(`${VELOCITY}/versions/${encodeURIComponent(version)}/builds/latest`); return b && b.id != null ? String(b.id) : null; },
    async download(version, dest, job) {
      const b = await fetchJson(`${VELOCITY}/versions/${encodeURIComponent(version)}/builds/latest`);
      const d = b.downloads && b.downloads['server:default'];
      if (!d) throw new Error(`Kein Velocity-Build für ${version} gefunden.`);
      job.log(`Velocity ${version} Build #${b.id} (${b.channel})`);
      await downloadFile(d.url, dest, { sha256: d.checksums && d.checksums.sha256, onProgress: jobProgress(job, `Velocity ${version} herunterladen`, 40, 95) });
      return { build: String(b.id) };
    },
  },

  modpack: {
    label: 'Modpack',
    homepage: 'https://modrinth.com/modpacks',
    description: 'Fertiges Modpack von Modrinth mit einem Klick – Loader und alle Server-Mods inklusive.',
    plugins: true,
    content: 'mods',
    loaders: ['fabric', 'neoforge', 'forge'],
    async versions() { return { latest: null, versions: [] }; },
  },

  // Bedrock Edition: eigenes Programm statt Java (Fähigkeiten siehe caps, Einzelheiten in bedrock.js)
  bedrock: require('./bedrock').provider,

  custom: {
    label: 'Eigene JAR',
    description: 'Eine beliebige Server-JAR (z. B. Quilt, Mohist oder ein eigener Build).',
    plugins: true,
    loaders: ['paper', 'spigot', 'bukkit'],
    async versions() { return { latest: null, versions: [] }; },
  },
};

/*
 * Servertypen aus Erweiterungen (SDK 3.2): Eine native Erweiterung meldet einen weiteren Typ an (z. B. BungeeCord aus
 * „Minecraft-Servernetzwerk“). Er erscheint wie ein eingebauter beim Anlegen und in den Server-Updates. Eingebaute Typen
 * lassen sich nicht überschreiben. Zusätzliche Haken für den Start (manager.start):
 *   launchArgs(s, jar) → Argumente statt „-jar server.jar nogui“  ·  beforeStart(s, dir) → z. B. Port in die eigene Konfig
 *   readyRe → Zeile, an der der Server „bereit“ ist (Standard: „Done (…s)!“)
 */
const BUILTIN = new Set(Object.keys(providers));

/**
 * Fähigkeiten eines Servertyps – der Kern fragt diese statt fester Typnamen (Java-Pfade bleiben unverändert):
 *   edition 'java' | 'bedrock' · java (braucht Java) · protocol 'TCP' | 'UDP' · addons 'plugins' | 'mods' | null
 *   worlds/properties (Proxy: nein) · datapacks/map/gamerulesFile/serverJar (nur Java-Spielserver) · memory (RAM-Grenze per -Xmx)
 */
function caps(type) {
  const p = providers[type] || {};
  const bedrock = p.edition === 'bedrock';
  const proxy = !!p.proxy;
  const javaGame = !bedrock && !proxy;
  return {
    edition: bedrock ? 'bedrock' : 'java', java: !bedrock, protocol: bedrock ? 'UDP' : 'TCP', proxy,
    addons: bedrock ? null : (p.content || 'plugins'), plugins: !bedrock && p.plugins !== false,
    worlds: !proxy, properties: !proxy, datapacks: javaGame, map: javaGame, gamerulesFile: javaGame, serverJar: !bedrock, memory: !bedrock,
    lists: bedrock ? 'bedrock' : proxy ? null : 'java',
  };
}
const TYPE_ID = /^[a-z][a-z0-9-]{1,23}$/;
function registerType(id, def, owner = null) {
  if (!TYPE_ID.test(String(id))) throw new Error(`registerType: ungültige Typ-Kennung ${id}`);
  if (BUILTIN.has(id)) throw new Error(`registerType: ${id} ist ein eingebauter Typ`);
  if (!def || typeof def.label !== 'string' || typeof def.versions !== 'function' || typeof def.download !== 'function') throw new Error('registerType: label, versions() und download() sind Pflicht');
  for (const k of ['launchArgs', 'beforeStart', 'latestBuild', 'java']) if (def[k] !== undefined && typeof def[k] !== 'function') throw new Error(`registerType: ${k} muss eine Funktion sein`);
  if (def.readyRe !== undefined && !(def.readyRe instanceof RegExp)) throw new Error('registerType: readyRe muss ein regulärer Ausdruck sein');
  providers[id] = { plugins: true, loaders: ['paper', 'spigot', 'bukkit'], ...def, owner };
  return () => unregisterType(id, owner);
}
function unregisterType(id, owner = null) {
  if (BUILTIN.has(id) || !providers[id]) return false;
  if (owner && providers[id].owner !== owner) return false;
  delete providers[id];
  return true;
}

/*
 * Modpacks von Modrinth (.mrpack): Loader (Fabric/NeoForge/Forge) passend installieren, alle Dateien mit
 * env.server != "unsupported" laden und overrides/ + server-overrides/ übernehmen.
 */
const LOADER_DEP = { 'fabric-loader': 'fabric', neoforge: 'neoforge', forge: 'forge' };
async function searchModpacks(q = '', offset = 0) {
  const facets = [['project_type:modpack'], ['server_side:required', 'server_side:optional'], ['categories:fabric', 'categories:neoforge', 'categories:forge']];
  const url = `${MODRINTH}/search?limit=20&offset=${Number(offset) || 0}&index=${q ? 'relevance' : 'downloads'}&query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const j = await cached('mrpack:' + url, 5 * 60e3, () => fetchJson(url), { persist: false });
  return { total: j.total_hits, hits: j.hits.map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url || null, downloads: h.downloads, author: h.author, versions: (h.versions || []).filter(isStable).slice(-3).reverse(), loaders: (h.categories || []).filter((c) => ['fabric', 'neoforge', 'forge', 'quilt'].includes(c)), url: `https://modrinth.com/modpack/${h.slug}` })) };
}
/** Neueste Modpack-Version (oder die gewählte) samt Minecraft-Version und Loader. */
async function modpackVersion(projectId, versionId) {
  const list = await fetchJson(`${MODRINTH}/project/${encodeURIComponent(projectId)}/version`);
  const v = (versionId && list.find((x) => x.id === versionId)) || list.find((x) => x.version_type === 'release' && x.loaders.some((l) => LOADER_DEP[l === 'fabric' ? 'fabric-loader' : l])) || list[0];
  if (!v) throw new Error('Dieses Modpack hat keine Versionen.');
  const loader = ['neoforge', 'fabric', 'forge'].find((l) => v.loaders.includes(l));
  if (!loader) throw new Error(`Dieses Modpack nutzt ${v.loaders.join(', ')} – Hostwerk unterstützt Fabric, NeoForge und Forge.`);
  return { id: v.id, number: v.version_number, name: v.name, mc: v.game_versions[0], loader, file: v.files.find((f) => f.primary) || v.files[0] };
}
/** .mrpack laden und auspacken → { v, index, tmp, cleanup } */
async function fetchPack(projectId, versionId, job, ctx, range = [36, 40]) {
  const v = await modpackVersion(projectId, versionId);
  const pack = path.join(ctx.paths.cache, `modpack-${v.id}.mrpack`);
  await downloadFile(v.file.url, pack, { sha1: v.file.hashes && v.file.hashes.sha1, onProgress: jobProgress(job, `Modpack ${v.number} herunterladen`, range[0], range[1]) });
  const { unzipTo } = require('./hw').core('util');
  const tmp = path.join(ctx.paths.cache, `modpack-${v.id}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await unzipTo(pack, tmp);
  fs.rmSync(pack, { force: true });
  const index = JSON.parse(fs.readFileSync(path.join(tmp, 'modrinth.index.json'), 'utf8'));
  return { v, index, tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
const serverFiles = (index) => (index.files || []).filter((f) => !f.env || f.env.server !== 'unsupported');
const sha1Of = (file) => require('crypto').createHash('sha1').update(fs.readFileSync(file)).digest('hex');
/** Dateien eines Packs laden (gleiche Dateien – gleicher Hash – werden übersprungen) und overrides übernehmen. */
async function placeFiles(index, tmp, dir, job, range = [94, 98]) {
  const files = serverFiles(index);
  let n = 0; let loaded = 0;
  for (const f of files) {
    const target = path.resolve(dir, f.path);
    n++;
    if (!target.startsWith(path.resolve(dir) + path.sep)) continue; // kein Schreiben außerhalb des Serverordners
    if (fs.existsSync(target) && f.hashes && f.hashes.sha1 && sha1Of(target) === f.hashes.sha1) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await downloadFile(f.downloads[0], target, { sha1: f.hashes && f.hashes.sha1 });
    loaded++;
    if (n % 10 === 0) job.progress(Math.min(range[1], range[0] + (n / files.length) * (range[1] - range[0])), `Mods laden (${n}/${files.length}) …`);
  }
  for (const o of ['overrides', 'server-overrides']) if (fs.existsSync(path.join(tmp, o))) fs.cpSync(path.join(tmp, o), dir, { recursive: true, force: true });
  return { total: files.length, loaded };
}
function packLoader(index, fallbackMc) {
  const deps = index.dependencies || {};
  const loaderKey = Object.keys(LOADER_DEP).find((k) => deps[k]);
  if (!loaderKey) throw new Error('Unbekannter Loader im Modpack (nur Fabric, NeoForge, Forge).');
  return { type: LOADER_DEP[loaderKey], loaderVersion: deps[loaderKey], mc: deps.minecraft || fallbackMc };
}

async function installModpack({ projectId, versionId }, dir, job, ctx) {
  const p = await fetchPack(projectId, versionId, job, ctx);
  try {
    const { v, index, tmp } = p;
    const L = packLoader(index, v.mc);
    job.log(`Modpack ${v.name} (${v.number}) – Minecraft ${L.mc}, ${providers[L.type].label}`);
    // Loader in der Version installieren, die das Modpack verlangt
    const r = await providers[L.type].download(L.mc, path.join(dir, 'server.jar'), job, { ...ctx, loaderVersion: L.loaderVersion, noExtras: true });
    const res = await placeFiles(index, tmp, dir, job);
    job.log(`${res.loaded} Dateien aus dem Modpack geladen.`);
    return { ...r, type: L.type, mc: L.mc, modpack: { projectId, versionId: v.id, version: v.number, name: v.name } };
  } finally { p.cleanup(); }
}

/** Neuere Versionen des Modpacks (gleicher Loader) – mit Minecraft-Version und Änderungen. */
async function modpackUpdates(s) {
  if (!s.modpack) throw new Error('Dieser Server wurde nicht aus einem Modpack erstellt.');
  const list = await fetchJson(`${MODRINTH}/project/${encodeURIComponent(s.modpack.projectId)}/version`);
  const cur = list.find((x) => x.id === s.modpack.versionId);
  const since = cur ? Date.parse(cur.date_published) : 0;
  const newer = list.filter((x) => x.loaders.includes(s.type) && Date.parse(x.date_published) > since)
    .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published))
    .map((x) => ({ id: x.id, number: x.version_number, name: x.name, mc: x.game_versions[0], type: x.version_type, date: x.date_published, changelog: (x.changelog || '').slice(0, 3000), mcChange: x.game_versions[0] !== s.version }));
  return { current: { id: s.modpack.versionId, number: s.modpack.version, mc: s.version }, latest: newer.find((x) => x.type === 'release') || newer[0] || null, versions: newer.slice(0, 15) };
}

/**
 * Modpack aktualisieren: Dateien der alten Version entfernen (eigene Mods bleiben), Loader bei Bedarf neu
 * installieren, neue Dateien laden, overrides übernehmen. Welt und Spielerdaten bleiben unberührt.
 */
async function updateModpackFiles(s, dir, versionId, job, ctx) {
  job.progress(8, 'Alte Modpack-Version lesen …');
  const oldP = await fetchPack(s.modpack.projectId, s.modpack.versionId, job, ctx, [8, 15]).catch(() => null);
  const newP = await fetchPack(s.modpack.projectId, versionId, job, ctx, [15, 25]);
  try {
    const L = packLoader(newP.index, newP.v.mc);
    if (L.type !== s.type) throw new Error(`Die neue Version nutzt ${providers[L.type].label} statt ${providers[s.type].label} – bitte als neuen Server anlegen.`);
    const keep = new Set(serverFiles(newP.index).map((f) => path.normalize(f.path)));
    let removed = 0;
    if (oldP) {
      for (const f of serverFiles(oldP.index)) {
        const target = path.resolve(dir, f.path);
        if (keep.has(path.normalize(f.path)) || !target.startsWith(path.resolve(dir) + path.sep)) continue;
        if (fs.existsSync(target)) { fs.rmSync(target, { force: true }); removed++; }
      }
    } else job.log('Die alte Version ist nicht mehr abrufbar – nicht mehr benötigte Mods bitte selbst prüfen.');
    let loader = null;
    if (L.loaderVersion !== s.build || L.mc !== s.version) {
      job.progress(30, `${providers[L.type].label} ${L.loaderVersion} einrichten …`);
      loader = await providers[L.type].download(L.mc, path.join(dir, 'server.jar'), job, { ...ctx, loaderVersion: L.loaderVersion, noExtras: true });
    }
    job.progress(60, 'Neue Mods laden …');
    const res = await placeFiles(newP.index, newP.tmp, dir, job, [60, 95]);
    job.log(`${removed} alte Datei(en) entfernt, ${res.loaded} neue bzw. geänderte geladen.`);
    return { mc: L.mc, loader, modpack: { ...s.modpack, versionId: newP.v.id, version: newP.v.number, name: newP.v.name }, removed, loaded: res.loaded };
  } finally { if (oldP) oldP.cleanup(); newP.cleanup(); }
}

// Rückfall auf MCJars für Programme mit eigener Download-Schnittstelle
for (const [id, type] of Object.entries(MCJ_TYPE)) {
  const p = providers[id];
  const versions0 = p.versions.bind(p);
  const download0 = p.download.bind(p);
  p.versions = async () => {
    try { const r = await versions0(); if (keeperNote) keeperNote(id, true, `${p.label}: Versionen von der offiziellen Quelle.`); return r; } catch (e) {
      const r = await mcjarsVersions(type);
      if (keeperNote) keeperNote(id, true, `${p.label}: offizielle Quelle antwortet nicht (${e.message}) – Versionen kommen von MCJars.`);
      return r;
    }
  };
  p.download = async (version, dest, job, ctx) => {
    try { return await download0(version, dest, job, ctx); } catch (e) {
      if (userError(e)) throw e;
      job.log(`${p.label}: offizielle Quelle antwortet nicht (${e.message}) – lade über MCJars …`);
      const r = await mcjarsDownload(type, version, dest, job, p.label);
      if (id === 'fabric' && !(ctx && ctx.noExtras)) await modrinthMod('P7dR8mSH', 'fabric', version, path.dirname(dest), job);
      if (keeperNote) keeperNote(id, true, `${p.label} ${version} über MCJars geladen (offizielle Quelle: ${e.message}).`);
      return r;
    }
  };
}

module.exports = { providers, caps, registerType, unregisterType, javaFor, searchModpacks, modpackVersion, installModpack, modpackUpdates, updateModpackFiles, setKeeper, mcjarsVersions };
