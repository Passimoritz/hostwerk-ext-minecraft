import { t } from '@hostwerk/i18n';
import Minecraft from './Minecraft';
import MinecraftServer from './MinecraftServer';
import McNbtView, { NBT_FILES } from './McNbtView';
import './style.css';

/*
 * Seite der Erweiterung „Minecraft-Server“. Hostwerk zeigt sie unter den gewohnten Adressen #/mc/… (App.jsx reicht den
 * Rest der Adresse als path durch) und unter #/ext/minecraft/…:
 *   #/mc                     → Serverliste            #/mc/import, #/mc/x-<erw>-<reiter> → Reiter der Liste
 *   #/mc/<server>/<reiter>   → ein Server (Übersicht, Konsole, Spieler, Plugins, Welt …)
 */
function Page({ path = [], query = '' }) {
  const [first, second] = path;
  if (first && first !== 'import' && !first.startsWith('x-')) return <MinecraftServer id={first} tab={second} query={query} />;
  return <Minecraft tab={first} />;
}

// Seitenleiste: Punkt je Server, Spieler und Port im Tipp; leere Liste = „noch keiner eingerichtet“
const nav = {
  tip: (o) => {
    const list = (o && o.kinds && o.kinds.mc && o.kinds.mc.items) || [];
    return {
      text: t('Minecraft servers with plugins, worlds and players.'),
      lines: list.map((s) => {
        const p = s.proc || {}; const n = ((p.extra || {}).players || []).length;
        return { name: s.name, state: p.state || 'stopped', text: p.state === 'error' ? (p.hint && p.hint.title) || p.error || t('Error') : [[s.typeLabel, s.version].filter(Boolean).join(' '), p.state === 'running' && t('{n} players', { n }), s.port && `:${s.port}`].filter(Boolean).join(' · ') };
      }),
    };
  },
};

// Dateivorschau: Minecraft-Daten (level.dat, Spieler, Strukturen, Schematics) als NBT-Baum
const slots = { 'files.preview': [{ id: 'mc-nbt', title: t('NBT tree'), match: NBT_FILES, Component: McNbtView }] };

export default { pages: { main: Page }, nav, slots };
