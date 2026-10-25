/* Live – gemeinsame Helfer für Seite und Kachel (ohne DOM testbar, tests/live.test.js):
 *   every()     regelmäßig abfragen – aber nicht, solange der Reiter versteckt ist; beim Zurückkommen sofort einmal
 *   throttle()  viele Ereignisse kurz hintereinander → ein Aufruf (z. B. „Spieler kamen/gingen“)
 *   failed()    Fehlerzustand mit „Erneut versuchen“ statt ewigem Skelett oder „–“ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Live = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const docOf = (d) => (d !== undefined ? d : (typeof document !== 'undefined' ? document : null));

  /**
   * fn alle ms Millisekunden aufrufen, solange die Seite sichtbar ist. War sie versteckt und ist ein Takt ausgefallen,
   * läuft fn beim Zurückkommen sofort. → { stop(), every(ms) zum Ändern des Takts }
   */
  function every(ms, fn, doc) {
    const d = docOf(doc);
    let missed = false;
    let timer = null;
    const tick = () => { if (d && d.hidden) { missed = true; return; } fn(); };
    const start = () => { clearInterval(timer); timer = setInterval(tick, Math.max(1000, Number(ms) || 0)); };
    const onVisible = () => { if (d && !d.hidden && missed) { missed = false; fn(); } };
    if (d && d.addEventListener) d.addEventListener('visibilitychange', onVisible);
    start();
    return {
      stop() { clearInterval(timer); if (d && d.removeEventListener) d.removeEventListener('visibilitychange', onVisible); },
      every(next) { ms = next; start(); },
    };
  }

  /** Höchstens ein Aufruf je wait ms: der erste sofort, weitere werden zu einem am Ende zusammengefasst. */
  function throttle(fn, wait) {
    let last = -Infinity; let timer = null;
    return function throttled(...args) {
      const now = Date.now();
      const left = last + wait - now;
      if (left <= 0) { clearTimeout(timer); timer = null; last = now; fn(...args); return; }
      if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...args); }, left);
    };
  }

  /**
   * Fehlerzustand zeichnen: Meldung und Knopf „Erneut versuchen“, der retry() aufruft. compact = Kachel (kleiner).
   * Texte kommen aus locales (loadError, retry); fehlen sie, steht der Schlüssel da – die Prüfung meldet das.
   */
  function failed(H, target, err, retry, { compact = false } = {}) {
    const msg = String((err && err.message) || err || '');
    const node = typeof target === 'string' ? document.querySelector(target) : target;
    if (!node) return;
    H.render(node, compact
      ? H.html`<div class="live-failed small" role="alert"><span class="c-err">${H.t('loadError')}</span> <button type="button" class="btn xs" data-live-retry>${H.t('retry')}</button></div>`
      : H.html`<div class="empty" role="alert"><h3>${H.t('loadError')}</h3><p class="muted small">${msg}</p><div class="empty-action"><button type="button" class="btn primary" data-live-retry>${H.t('retry')}</button></div></div>`);
    const b = node.querySelector('[data-live-retry]');
    if (b) b.addEventListener('click', () => { b.disabled = true; Promise.resolve().then(retry).catch(() => {}); });
  }

  /** Gemeinsamer Ablauf: load() ausführen, bei Fehler failed() in target zeichnen. Gibt true/false zurück. */
  async function guard(H, target, load, opts) {
    try { await load(); return true; } catch (e) { failed(H, target, e, () => guard(H, target, load, opts), opts); return false; }
  }

  return { every, throttle, failed, guard };
}));
