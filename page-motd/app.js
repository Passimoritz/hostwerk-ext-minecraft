// MOTD-Studio – Seite, Abschnitt und (für ältere Hostwerk-Versionen) Reiter: Beschreibung des Servers in der Serverliste
// gestalten, Vorschau wie im Spiel (dunkel und hell), speichern über Hostwerk (change:minecraft – Hostwerk fragt vorher).
// Seit 1.3: Platzhalter ({name}, {version}, {restart} …), Farbverläufe, MiniMessage zum Kopieren, mehrere Varianten, die
// sich bei „Jetzt neu starten“ abwechseln, und ein kompakter Abschnitt direkt in der Minecraft-Übersicht.
// Ehrlich: Minecraft liest die Beschreibung nur beim Start – Platzhalter und Varianten setzt das Studio beim Speichern und
// bei „Jetzt neu starten“ ein. Was sich zwischendurch ändert (Uhrzeit, Neustart-Termin), stimmt erst nach dem nächsten.
const { html } = Hostwerk;
const t = (k, v) => Hostwerk.t(`motd.${k}`, v); // eigene Texte (motd.…) neben denen von Minecraft
const M = Motd;
const CODES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
const FMT = [['l', 'B', 'bold'], ['o', 'I', 'italic'], ['n', 'U', 'underline'], ['m', 'S', 'strike'], ['k', '?', 'obfuscated'], ['r', '↺', 'reset']];
const MAX_VARIANTS = 5;
let servers = [];
let current = null;
let shownFor = null; // Server, dessen Text gerade im Editor steht (Liste aktualisieren, ohne Getipptes zu verlieren)
let icon = null; // { img, zoom, x, y } – Bild für das Server-Symbol, noch nicht gespeichert
let restartAt = {}; // Server → nächster geplanter Neustart (aus Hostwerks Aufgaben)
let light = false; // Vorschau auf hellem Grund
let expanded = false; // Abschnitt: Editor aufgeklappt
const savedIcons = new Map(); // Server → data-URL des zuletzt gespeicherten Symbols (für die Vorschau)
const plans = new Map(); // Server → { variants: [Vorlage …], index, rotate } (gespeichert in storage unter plan:<id>)

const $ = (id) => document.getElementById(id);
// ⓘ wie in Hostwerk (Baukasten-Klassen info-tip): Klick/Fokus zeigt die Erklärung, Esc schließt
let tipSeq = 0;
const INFO = Hostwerk.raw('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>');
const tip = (label, text) => { const id = `tip-${++tipSeq}`; return html`<span class="info-tip"><button type="button" class="info-tip-btn" aria-label="${label}" aria-describedby="${id}">${INFO}</button><span class="info-tip-pop" role="tooltip" id="${id}"><b>${label}</b><span class="info-tip-body">${text}</span></span></span>`; };
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('.info-tip-btn'); if (b) b.parentElement.classList.toggle('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const x of document.querySelectorAll('.info-tip.open')) x.classList.remove('open'); });
const server = () => servers.find((x) => x.id === current);
const isSection = () => Hostwerk.embed === 'section';
const vals = (s) => M.values({ ...s, nextRestart: restartAt[s.id] || null }, Date.now(), Hostwerk.lang);
function planOf(s) {
  if (!plans.has(s.id)) plans.set(s.id, { variants: [M.normalize(s.motd || '')], index: 0, rotate: false, edit: 0 });
  return plans.get(s.id);
}
async function loadPlans() {
  try {
    let all = (await Hostwerk.storage.all()) || {};
    // Seit Minecraft-Server 1.1: die Pläne der früheren Erweiterung „MOTD-Studio“ einmal übernehmen (replaced:motd-studio)
    const old = all['replaced:motd-studio'];
    if (old && old.storage && typeof old.storage === 'object') {
      for (const [k, v] of Object.entries(old.storage)) if (k.startsWith('plan:') && all[k] === undefined) await Hostwerk.storage.set(k, v);
      await Hostwerk.storage.remove('replaced:motd-studio');
      all = (await Hostwerk.storage.all()) || {};
    }
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith('plan:') || !v || !Array.isArray(v.variants)) continue;
      const id = k.slice(5);
      const old = plans.get(id);
      plans.set(id, { variants: v.variants.slice(0, MAX_VARIANTS).map(String), index: Number(v.index) || 0, rotate: !!v.rotate, edit: old ? old.edit : Number(v.index) || 0, drafts: old && old.drafts });
    }
  } catch { /* ohne Speicher: nur die gespeicherte Beschreibung */ }
}
const storePlan = (s) => { const p = planOf(s); return Hostwerk.storage.set(`plan:${s.id}`, { variants: p.variants, index: p.index, rotate: p.rotate }).catch(() => {}); };

function preview(text) {
  const lines = M.parse(text);
  return html`${lines.map((line) => html`<div class="motd-line">${line.map((seg) => html`<span style="${`color:${seg.color};${seg.bold ? 'font-weight:700;' : ''}${seg.italic ? 'font-style:italic;' : ''}${seg.underline || seg.strike ? `text-decoration:${seg.underline ? 'underline ' : ''}${seg.strike ? 'line-through' : ''};` : ''}`}">${seg.obfuscated ? seg.text.replace(/\S/g, '▒') : seg.text}</span>`)}</div>`)}`;
}
/** Vorschau wie in der Serverliste: Symbol, Name, Beschreibung, Spieler. */
function listBox(s, text, id = 'pv') {
  return html`<div class="${`motd-box${light ? ' motd-light' : ''}`}"><div class="motd-icon" id="${`${id}-icon`}"></div><div class="grow"><div class="motd-name">${s.name}</div><div id="${id}">${preview(text)}</div></div><div class="motd-players">${s.state === 'running' ? `${s.players != null ? s.players : 0}/${s.maxPlayers || 20}` : '–'}</div></div>`;
}

/** Zeile unter dem Editor: läuft der Server, wirkt die Änderung erst nach einem Neustart – mit Knopf. */
function renderStatus() {
  const s = server();
  const el = $('status');
  if (!s || !el) return;
  const p = planOf(s);
  const rot = p.rotate && p.variants.filter((x) => x.trim()).length > 1;
  Hostwerk.render(el, s.state === 'running'
    ? html`<span class="muted small">${t(s.dirty ? 'restartNeeded' : rot ? 'restartRotate' : 'restartHint')}</span>${s.dirty || rot ? html` <button type="button" class="btn sm" id="restart">${t('restartNow')}</button>` : ''}`
    : html`<span class="muted small">${t('stoppedHint')}</span>`);
  const r = $('restart');
  if (r) r.addEventListener('click', restart);
}

/** Beschreibung schreiben: Vorlage mit eingesetzten Platzhaltern nach server.properties, Vorlage selbst in den Speicher. */
async function write(s, tpl) {
  const text = M.resolve(tpl, vals(s));
  await Hostwerk.put(`/mc/servers/${encodeURIComponent(s.id)}/properties`, { motd: M.toProperty(text) });
  s.motd = M.toProperty(text);
  if (s.state === 'running') s.dirty = true;
  await storePlan(s);
}

async function restart() {
  const s = server();
  if (!s) return;
  const p = planOf(s);
  try {
    // Vor dem Neustart: nächste Variante (wenn eingeschaltet) bzw. Platzhalter frisch einsetzen – greift mit dem Neustart
    const many = p.variants.filter((x) => x.trim()).length > 1;
    if (p.rotate && many) { const n = M.nextVariant(p.variants, p.index); p.index = n.index; await write(s, n.text); }
    else if (M.hasPlaceholders(p.variants[p.index] || '')) await write(s, p.variants[p.index]);
    await Hostwerk.service('minecraft', s.id).restart(); s.dirty = false;
    Hostwerk.toast(t('restarting', { name: s.name }), { kind: 'success' });
    render();
  } catch (e) { if (!/Abgelehnt|Declined/i.test(e.message)) Hostwerk.toast(e.message, { kind: 'error' }); }
}

function iconPreview(id = 'pv') {
  const s = server();
  const box = $(`${id}-icon`);
  if (!box || !s) return;
  const url = icon ? drawIcon() : savedIcons.get(s.id);
  Hostwerk.render(box, url ? html`<img src="${url}" alt="" width="48" height="48">` : html`<span aria-hidden="true">${s.name.slice(0, 1).toUpperCase()}</span>`);
}

/** Zuschnitt auf 64×64 zeichnen → data-URL (PNG), wie Minecraft das Symbol verlangt. */
function drawIcon() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const { sx, sy, size } = M.crop(icon.img.naturalWidth, icon.img.naturalHeight, icon.zoom, icon.x, icon.y);
  g.imageSmoothingQuality = 'high';
  g.drawImage(icon.img, sx, sy, size, size, 0, 0, 64, 64);
  return c.toDataURL('image/png');
}

function renderIconTools() {
  const el = $('icon-tools');
  if (!el) return;
  Hostwerk.render(el, icon
    ? html`<div class="stack icon-crop">
        <label class="label" for="zoom">${t('iconZoom')}</label><input type="range" id="zoom" min="1" max="4" step="0.05" value="${icon.zoom}">
        <label class="label" for="ix">${t('iconX')}</label><input type="range" id="ix" min="-1" max="1" step="0.02" value="${icon.x}">
        <label class="label" for="iy">${t('iconY')}</label><input type="range" id="iy" min="-1" max="1" step="0.02" value="${icon.y}">
        <div class="row"><button type="button" class="btn" id="icon-cancel">${t('cancel')}</button><button type="button" class="btn primary" id="icon-save">${t('iconSave')}</button></div>
      </div>`
    : html`<button type="button" class="btn" id="icon-btn">${t('iconPick')}</button><input type="file" id="icon-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>`);
  const f = $('icon-file');
  if (f) f.addEventListener('change', () => pickIcon(f.files && f.files[0]));
  const fb = $('icon-btn'); if (fb && f) fb.addEventListener('click', () => f.click());
  for (const [id, key] of [['zoom', 'zoom'], ['ix', 'x'], ['iy', 'y']]) { const r = $(id); if (r) r.addEventListener('input', () => { icon[key] = Number(r.value); iconPreview(); }); }
  const c = $('icon-cancel'); if (c) c.addEventListener('click', () => { icon = null; renderIconTools(); iconPreview(); });
  const sv = $('icon-save'); if (sv) sv.addEventListener('click', saveIcon);
}

function pickIcon(file) {
  if (!file) return;
  if (file.size > 15 * 1048576) { Hostwerk.toast(t('iconTooBig'), { kind: 'error' }); return; }
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => { icon = { img, zoom: 1, x: 0, y: 0 }; renderIconTools(); iconPreview(); };
    img.onerror = () => Hostwerk.toast(t('iconBroken'), { kind: 'error' });
    img.src = String(r.result);
  };
  r.readAsDataURL(file);
}

async function saveIcon() {
  const s = server();
  if (!s || !icon) return;
  const png = drawIcon();
  try {
    await Hostwerk.put(`/mc/servers/${encodeURIComponent(s.id)}/icon`, { png });
    savedIcons.set(s.id, png); icon = null;
    if (s.state === 'running') s.dirty = true;
    Hostwerk.toast(t('iconSaved'), { kind: 'success' });
    renderIconTools(); iconPreview(); renderStatus();
  } catch (e) { if (!/Abgelehnt|Declined/i.test(e.message)) Hostwerk.toast(e.message, { kind: 'error' }); }
}

/** Kompakter Abschnitt (Minecraft-Übersicht): Vorschau, Varianten-Hinweis, „Bearbeiten“ klappt den Editor auf. */
function renderSection() {
  const s = server();
  if (!s) { Hostwerk.render('#editor', html`<p class="muted small">${t('noServer')}</p>`); return; }
  if (expanded) { renderEditor(); return; }
  shownFor = null;
  const p = planOf(s);
  const active = p.variants[p.index] || M.normalize(s.motd || '');
  const n = p.variants.filter((x) => x.trim()).length;
  Hostwerk.render('#editor', html`
    <div class="stack motd-section">
      ${listBox(s, M.resolve(active, vals(s)), 'spv')}
      <div class="row motd-section-foot">
        <span class="grow muted small">${n > 1 ? t(p.rotate ? 'variantsRotate' : 'variantsCount', { n }) : M.hasPlaceholders(active) ? t('placeholdersOn') : t('sectionHint')}</span>
        <button type="button" class="btn sm ghost" id="big" title="${t('openBig')}">${t('openBig')}</button>
        <button type="button" class="btn sm primary" id="edit">${t('edit')}</button>
      </div>
    </div>`);
  iconPreview('spv');
  $('edit').addEventListener('click', () => { expanded = true; renderEditor(); const ta = $('motd'); if (ta) ta.focus(); });
  $('big').addEventListener('click', () => Hostwerk.navigate('/mc/x-minecraft-motd').catch(() => {}));
}

function renderEditor() {
  const s = server();
  if (!s) { shownFor = null; Hostwerk.render('#editor', html`<div class="empty"><h3>${t('noServer')}</h3><p class="muted small">${t('noServerHint')}</p></div>`); return; }
  shownFor = s.id;
  const p = planOf(s);
  if (!p.drafts) p.drafts = p.variants.slice();
  if (p.edit >= p.drafts.length) p.edit = 0;
  const value = p.drafts[p.edit] != null ? p.drafts[p.edit] : '';
  Hostwerk.render('#editor', html`
    <div class="grid grid-2 motd-grid">
      <div class="card card-pad stack">
        <div class="row motd-variants">
          <span class="row" role="tablist" aria-label="${t('variants')}">${p.drafts.map((_, i) => html`<button type="button" role="tab" class="${`btn sm ${i === p.edit ? 'primary' : 'ghost'}`}" aria-selected="${i === p.edit ? 'true' : 'false'}" data-variant="${i}">${t('variant', { n: i + 1 })}${i === p.index ? ' ●' : ''}</button>`)}</span>
          ${p.drafts.length < MAX_VARIANTS ? html`<button type="button" class="btn sm ghost" id="add-variant" title="${t('variantAdd')}" aria-label="${t('variantAdd')}">+</button>` : ''}
          ${p.drafts.length > 1 ? html`<button type="button" class="btn sm ghost" id="del-variant">${t('variantRemove')}</button>` : ''}
        </div>
        <label class="label" for="motd">${t('text')}</label>
        <textarea class="input mono" id="motd" rows="3">${value}</textarea>
        <div class="motd-tools" role="toolbar" aria-label="${t('toolbar')}">${CODES.map((c) => html`<button type="button" class="swatch" data-code="${c}" title="${`§${c} ${t('color.' + c)}`}" aria-label="${t('color.' + c)}" style="${`background:${M.COLORS[c]}`}"></button>`)}${FMT.map(([c, l, k]) => html`<button type="button" class="btn sm ghost" data-code="${c}" title="${`§${c} ${t('fmt.' + k)}`}" aria-label="${t('fmt.' + k)}">${l}</button>`)}</div>
        <div class="motd-tools" role="toolbar" aria-label="${t('placeholders')}">
          <span class="label">${t('placeholders')}</span>
          ${M.PLACEHOLDERS.map((k) => html`<button type="button" class="btn xs ghost mono" data-ph="${k}" title="${t('ph.' + k)}">{${k}}</button>`)}
          ${tip(t('placeholders'), t('placeholdersInfo'))}
        </div>
        <div class="row motd-more">
          <label class="label" for="g-from">${t('gradient')}</label>
          <input type="color" id="g-from" value="#ffaa00" aria-label="${t('gradientFrom')}">
          <input type="color" id="g-to" value="#ff55ff" aria-label="${t('gradientTo')}">
          <label class="row-tight small"><input type="checkbox" id="g-bold"> ${t('fmt.bold')}</label>
          <button type="button" class="btn sm" id="gradient" title="${t('gradientInfo')}">${t('gradientApply')}</button>
          ${tip(t('gradient'), t('gradientInfo'))}
        </div>
        <div class="row motd-more">
          <label class="label" for="tpl">${t('template')}</label>
          <select class="select" id="tpl"><option value="">${t('templatePick')}</option>${M.TEMPLATES.map((x) => html`<option value="${x.id}">${t('tpl.' + x.id)}</option>`)}</select>
          <button type="button" class="btn sm" id="center">${t('center')}</button>
          <button type="button" class="btn sm ghost" id="mini" title="${t('miniInfo')}">${t('miniCopy')}</button>
        </div>
        <label class="row-tight small"><input type="checkbox" id="rotate" ${p.rotate ? Hostwerk.raw('checked') : ''} ${p.drafts.length < 2 ? Hostwerk.raw('disabled') : ''}> ${t('rotate')}</label>
        <div id="problems" class="small" aria-live="polite"></div>
        <div class="row"><span class="grow" id="status"></span>${isSection() ? html`<button type="button" class="btn ghost" id="collapse">${t('close')}</button>` : ''}<button type="button" class="btn primary" id="save">${t('save')}</button></div>
      </div>
      <div class="card card-pad stack">
        <div class="row"><span class="label grow">${t('preview')}</span>
          <div class="seg" role="group" aria-label="${t('previewBg')}"><button type="button" class="${light ? '' : 'on'}" aria-pressed="${light ? 'false' : 'true'}" data-bg="dark">${t('dark')}</button><button type="button" class="${light ? 'on' : ''}" aria-pressed="${light ? 'true' : 'false'}" data-bg="light">${t('light')}</button></div></div>
        <div id="pv-wrap">${listBox(s, M.resolve(value, vals(s)))}</div>
        ${isSection() ? '' : html`<div class="label">${t('icon')}</div><p class="tiny muted">${t('iconHint')}</p><div id="icon-tools"></div>`}
      </div>
    </div>`);
  const ta = $('motd');
  const update = () => {
    p.drafts[p.edit] = ta.value; // Entwurf überlebt Sprachwechsel und neue Serverliste
    Hostwerk.render('#pv-wrap', listBox(s, M.resolve(ta.value, vals(s))));
    iconPreview();
    const probs = M.check(M.resolve(ta.value, vals(s)));
    const unknown = M.unknownPlaceholders(ta.value);
    Hostwerk.render('#problems', probs.length || unknown.length
      ? html`${probs.map((x) => html`<div class="c-warn">${t('problem.' + x.code, { line: x.line, n: x.length })}</div>`)}${unknown.map((k) => html`<div class="c-warn">${t('problem.placeholder', { name: k })}</div>`)}`
      : html`<span class="muted">${t('ok')}</span>`);
  };
  const put = (txt, cursor) => { ta.value = txt; ta.focus(); if (cursor != null) ta.setSelectionRange(cursor, cursor); update(); };
  ta.addEventListener('input', update);
  for (const b of document.querySelectorAll('[data-code]')) b.addEventListener('click', () => { const r = M.insert(ta.value, ta.selectionStart, ta.selectionEnd, b.dataset.code); put(r.text, r.cursor); });
  for (const b of document.querySelectorAll('[data-ph]')) b.addEventListener('click', () => { const a = ta.selectionStart; const piece = `{${b.dataset.ph}}`; put(ta.value.slice(0, a) + piece + ta.value.slice(ta.selectionEnd), a + piece.length); });
  for (const b of document.querySelectorAll('[data-variant]')) b.addEventListener('click', () => { p.edit = Number(b.dataset.variant); renderEditor(); });
  for (const b of document.querySelectorAll('[data-bg]')) b.addEventListener('click', () => { light = b.dataset.bg === 'light'; renderEditor(); });
  const add = $('add-variant'); if (add) add.addEventListener('click', () => { p.drafts.push(''); p.edit = p.drafts.length - 1; renderEditor(); });
  const delV = $('del-variant'); if (delV) delV.addEventListener('click', () => { p.drafts.splice(p.edit, 1); if (p.index >= p.drafts.length) p.index = 0; p.edit = Math.min(p.edit, p.drafts.length - 1); renderEditor(); });
  $('rotate').addEventListener('change', (e) => { p.rotate = e.target.checked; renderStatus(); });
  $('gradient').addEventListener('click', () => {
    const a = ta.selectionStart; const b = ta.selectionEnd;
    const sel = a !== b ? ta.value.slice(a, b) : M.plain(ta.value).split('\n')[0];
    const g = M.gradient(sel, $('g-from').value, $('g-to').value, $('g-bold').checked ? 'l' : '');
    if (a !== b) put(ta.value.slice(0, a) + g + ta.value.slice(b), a + g.length);
    else { const lines = M.normalize(ta.value).split('\n'); lines[0] = g; put(lines.join('\n')); }
  });
  $('mini').addEventListener('click', () => Hostwerk.copy(M.toMiniMessage(M.resolve(ta.value, vals(s)))).then(() => Hostwerk.toast(t('miniCopied'), { kind: 'success' })).catch((e) => Hostwerk.toast(e.message, { kind: 'error' })));
  $('tpl').addEventListener('change', (e) => { if (!e.target.value) return; const v = M.template(e.target.value, '{name}', Hostwerk.lang); e.target.value = ''; put(v); });
  $('center').addEventListener('click', () => put(M.center(ta.value)));
  const col = $('collapse'); if (col) col.addEventListener('click', () => { expanded = false; render(); });
  $('save').addEventListener('click', async () => {
    try {
      p.variants = p.drafts.map((x) => String(x || '')).filter((x, i) => x.trim() || i === p.edit).slice(0, MAX_VARIANTS);
      p.drafts = p.variants.slice();
      p.index = Math.min(p.edit, p.variants.length - 1); p.edit = p.index;
      await write(s, p.variants[p.index]);
      Hostwerk.toast(t('saved'), { kind: 'success' });
      if (isSection()) { expanded = false; render(); } else renderEditor();
    } catch (e) { if (!/Abgelehnt|Declined/i.test(e.message)) Hostwerk.toast(e.message, { kind: 'error' }); }
  });
  update(); renderStatus(); iconPreview(); renderIconTools();
}
const render = () => (isSection() ? renderSection() : renderEditor());
function renderPicker() {
  const pick = $('server');
  if (!pick) return;
  Hostwerk.render(pick, html`${servers.map((s) => html`<option value="${s.id}" ${s.id === current ? Hostwerk.raw('selected') : ''}>${s.name}</option>`)}`);
  pick.setAttribute('aria-label', t('server'));
  pick.onchange = () => { current = pick.value; icon = null; render(); };
}
async function load() {
  const list = await Hostwerk.get('/mc/servers');
  const before = new Map(servers.map((s) => [s.id, s]));
  servers = (Array.isArray(list) ? list : []).map((s) => ({ id: s.id, name: s.name, motd: s.motd || '', version: s.version, typeLabel: s.typeLabel, state: (s.proc && s.proc.state) || 'stopped', players: s.proc && s.proc.extra && s.proc.extra.players ? s.proc.extra.players.length : null, maxPlayers: s.maxPlayers, dirty: !!(before.get(s.id) && before.get(s.id).dirty && ((s.proc && s.proc.state) || 'stopped') === 'running') }));
  // Nächster geplanter Neustart je Server ({restart}) – ohne Aufgaben-Recht einfach „nicht geplant“
  try { const tasks = await Hostwerk.get('/tasks'); restartAt = Object.fromEntries(servers.map((s) => [s.id, M.nextRestart(tasks, s.id)])); } catch { restartAt = {}; }
  await loadPlans();
  const ctx = Hostwerk.context;
  if (ctx && ctx.kind === 'minecraft') current = ctx.id;
  if (!current || !servers.some((s) => s.id === current)) current = servers[0] && servers[0].id;
  renderPicker();
  // Liste live halten, aber den Editor nur neu zeichnen, wenn ein anderer Server dran ist – sonst wäre Getipptes weg
  if (shownFor !== current || !$('motd')) render(); else renderStatus();
}
const reload = () => Live.guard(Hostwerk, '#editor', load);
function showTab(tab) { for (const el of document.querySelectorAll('[data-tab]')) el.hidden = el.dataset.tab !== (tab || 'editor'); }
Hostwerk.ready().then((info) => {
  showTab(info.tab);
  Hostwerk.on('tab', showTab);
  // Aus dem Rechtsklick-Menü eines Minecraft-Servers, der Schnellsuche oder „Großer Editor“ im Abschnitt: diesen Server bearbeiten
  let lastAction = '';
  const act = (a) => { if (!a || a.id !== 'edit' || !a.target || `${a.target}@${a.at}` === lastAction) return; lastAction = `${a.target}@${a.at}`; current = a.target; icon = null; renderPicker(); render(); };
  Hostwerk.on('action', act);
  reload().then(() => act(info.action));
  // Server gestartet/gestoppt, neue Server: Liste und Neustart-Hinweis aktualisieren (Getipptes bleibt)
  Hostwerk.on('service', Live.throttle((s) => { if (!s || s.kind === 'minecraft') reload(); }, 2000));
  Hostwerk.on('minecraft', Live.throttle(() => reload(), 5000));
  Hostwerk.on('lang', () => { shownFor = null; reload(); });
  Live.every(60000, reload);
});
