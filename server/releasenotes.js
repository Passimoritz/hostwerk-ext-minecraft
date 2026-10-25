'use strict';
/*
 * Versionshinweise („Was ist neu?“) für Minecraft, Paper, Purpur und Spigot – Hostwerk fragt sie über
 * contribute('releaseNotes') ab und gibt die Helfer mit (json, text, decode). Bis Hostwerk 3.1 im Kern.
 */
const sources = {
  minecraft: {
    label: 'Minecraft', link: (v) => `https://www.minecraft.net/de-de/search?q=${encodeURIComponent(v)}`,
    async fetch(v, { json, decode }) {
      const list = (await json('https://launchercontent.mojang.com/v2/javaPatchNotes.json')).entries || [];
      const e = list.find((x) => x.version === v) || list.find((x) => x.version === v.replace(/-.*/, '') && x.type === 'release');
      if (!e) return null;
      const body = (await json(`https://launchercontent.mojang.com/v2/${e.contentPath}`)).body || '';
      const items = [];
      let group = null;
      for (const m of body.matchAll(/<h[1-3]>([\s\S]*?)<\/h[1-3]>|<li>([\s\S]*?)(?=<li>|<\/ul>|<\/li>)/g)) {
        if (m[1]) group = decode(m[1]);
        else if (m[2] && decode(m[2])) items.push({ kind: group, text: decode(m[2]).slice(0, 400) });
      }
      return { title: e.title, date: e.date, summary: e.shortText, items };
    },
  },
  paper: {
    label: 'Paper', link: (v) => `https://papermc.io/downloads/all?project=paper#${v}`,
    async fetch(v, { json, decode }) {
      const builds = await json(`https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(v)}/builds`);
      const items = [];
      for (const b of builds.slice(0, 12)) for (const c of b.commits || []) items.push({ kind: `Build ${b.id}`, text: String(c.message).split('\n')[0].slice(0, 300) });
      return { date: builds[0] && builds[0].time, items };
    },
  },
  purpur: {
    label: 'Purpur', link: (v) => `https://purpurmc.org/downloads?v=${v}`,
    async fetch(v, { json, decode }) {
      const b = await json(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(v)}/latest`);
      return { date: b.timestamp ? new Date(b.timestamp).toISOString() : null, items: (b.commits || []).map((c) => ({ kind: `Build ${b.build}`, text: String(c.description).split('\n')[0].replace(/^\[ci skip\]\s*/i, '').slice(0, 300) })).filter((x) => x.text && !/^rebuild patches$/i.test(x.text)) };
    },
  },
  spigot: { label: 'Spigot', link: () => 'https://www.spigotmc.org/wiki/buildtools/' },
};

module.exports = { sources };
