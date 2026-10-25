// Reiter „Farbcodes“: Übersicht aller §-Codes mit Beispiel
const { html: h } = Hostwerk;
const tt = (k, v) => Hostwerk.t(`motd.${k}`, v); // eigene Texte (motd.…) neben denen von Minecraft
function codes() {
  const rows = [...'0123456789abcdef'].map((c) => h`<tr><td class="mono">§${c}</td><td><span class="swatch" aria-hidden="true" style="${`display:inline-block;background:${Motd.COLORS[c]}`}"></span></td><td>${tt('color.' + c)}</td></tr>`);
  const fmt = [['l', 'bold'], ['o', 'italic'], ['n', 'underline'], ['m', 'strike'], ['k', 'obfuscated'], ['r', 'reset']].map(([c, k]) => h`<tr><td class="mono">§${c}</td><td></td><td>${tt('fmt.' + k)}</td></tr>`);
  Hostwerk.render('#codes', h`${rows}${fmt}`);
}
Hostwerk.ready().then(() => { codes(); Hostwerk.on('lang', codes); });
