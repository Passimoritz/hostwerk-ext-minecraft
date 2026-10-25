'use strict';
/*
 * Änderungsprotokoll (SDK 3.5, host.contribute('audit')): verständliche Texte für Minecraft-Aktionen und Schwärzen von
 * Passwort-Befehlen (AuthMe, nLogin …) in der Konsole. Bis Hostwerk 3.1 stand das im Kern (core/audit.js).
 */
const MASK = '•••';
// Minecraft: Befehle, deren Argumente Passwörter sind (AuthMe, nLogin, LoginSecurity …)
const MC_SECRET_CMDS = new Set(['login', 'l', 'log', 'register', 'reg', 'changepassword', 'changepass', 'changepw', 'cp', 'unregister', 'unreg', 'premium', 'setpassword', 'setpw']);
const MC_ADMIN = new Set(['authme', 'am', 'nlogin', 'loginsecurity', 'lsadmin', 'opeless']);
/** Minecraft-Befehl schwärzen: Passwort-Befehle behalten nur den Befehl (und beim Admin-Befehl den Spielernamen). */
function redactCommand(cmd) {
  const s = String(cmd || '');
  const m = s.match(/^(\s*\/?)(\S+)(.*)$/s);
  if (!m) return s;
  const word = m[2].toLowerCase().replace(/^[a-z0-9_-]+:/, ''); // Namensraum wie authme:login
  if (MC_SECRET_CMDS.has(word)) return m[3].trim() ? `${m[1]}${m[2]} ${MASK}` : s;
  if (MC_ADMIN.has(word)) {
    const parts = m[3].trim().split(/\s+/);
    const sub = (parts[0] || '').toLowerCase();
    if (/^(register|reg|changepassword|changepass|cp|password|setpassword|setpw)$/.test(sub) && parts.length > 2) return `${m[1]}${m[2]} ${parts[0]} ${parts[1]} ${MASK}`;
  }
  return s;
}

/** Befehle in Texten schwärzen: KI-Werkzeuge ({"command":"login geheim"}) und „Befehl: login geheim“ */
function redact(text) {
  let s = String(text);
  s = s.replace(/("command"\s*:\s*")((?:[^"\\]|\\.)*)/g, (all, pre, v) => pre + redactCommand(v));
  s = s.replace(/^(Befehl: )(.*)$/s, (all, pre, v) => pre + redactCommand(v));
  return s;
}

const audit = {
  ignore: [/^\/mc\/servers\/[^/]+\/(ping|updates\/check|safe-upgrade\/check)/],
  redact,
  routes: [
  [/^\/mc\/servers\/([^/]+)\/command$/, (m, c, req) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: `Befehl: ${redactCommand(String((req.body || {}).command || '')).slice(0, 80)}` })],
  [/^\/mc\/servers\/([^/]+)\/(version|safe-upgrade)$/, (m, c, req) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: `Version gewechselt${req.body && req.body.version ? ` auf ${req.body.version}` : ''}` })],
  [/^\/mc\/servers\/([^/]+)\/plugins\/(upload|update|toggle)$/, (m, c, req) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: { upload: 'Plugin hochgeladen', update: 'Plugins aktualisiert', toggle: `Plugin ${((req.body || {}).file || '')} umgeschaltet` }[m[2]], undo: m[2] === 'toggle' && req.body && req.body.file ? { method: 'POST', path: `/mc/servers/${m[1]}/plugins/toggle`, body: { file: req.body.file }, label: 'zurückschalten' } : null })],
  [/^\/mc\/servers\/([^/]+)\/market\/install$/, (m, c, req) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: `Plugin installiert (${(req.body || {}).id || ''})` })],
  [/^\/mc\/servers\/([^/]+)\/(backups?|backup)$/, (m, c) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: 'Backup erstellt' })],
  [/^\/mc\/servers\/([^/]+)\/gamerules?\/?/, (m, c, req) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: `Spielregel geändert${req.body && req.body.name ? `: ${req.body.name}` : ''}` })],
  [/^\/mc\/servers\/([^/]+)\/players\/([^/]+)$/, (m, c, req) => ({ kind: 'Minecraft', target: c.kind('mc', m[1]), action: `Spielerliste ${m[2]} geändert (${(req.body || {}).name || ''})` })],
  [/^\/mc\/servers\/([^/]+)$/, (m, c, req) => (req.method === 'DELETE' ? { kind: 'Minecraft', target: m[1], action: 'Server gelöscht' } : { kind: 'Minecraft', target: c.kind('mc', m[1]), action: 'Einstellungen geändert' })],
  ],
};

module.exports = { audit, redactCommand };
