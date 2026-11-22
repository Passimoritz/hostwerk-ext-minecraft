'use strict';
/*
 * Sicherung vor dem Wiederherstellen prüfen: lässt sich das ZIP öffnen und hat es lesbare Einträge? Liest nur das
 * Inhaltsverzeichnis (kein Entpacken) – ein abgeschnittenes oder beschädigtes Backup fällt so auf, bevor Hostwerk
 * etwas am Server ändert.
 */
const yauzl = require('./hw').lib('yauzl');
const T = (text, vars) => require('./hw').t(text, vars);

function checkZip(file) {
  return new Promise((resolve) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return resolve({ ok: false, entries: 0, error: T('The backup is damaged or not a ZIP file. ({error})', { error: err.message }) });
      let entries = 0;
      let done = false;
      const finish = (r) => { if (done) return; done = true; try { zip.close(); } catch { /* schon zu */ } resolve(r); };
      zip.on('entry', () => { entries++; zip.readEntry(); });
      zip.on('end', () => finish(entries ? { ok: true, entries } : { ok: false, entries: 0, error: T('The backup is empty.') }));
      zip.on('error', (e) => finish({ ok: false, entries, error: T('The backup is damaged or not a ZIP file. ({error})', { error: e.message }) }));
      zip.readEntry();
    });
  });
}

module.exports = { checkZip };
