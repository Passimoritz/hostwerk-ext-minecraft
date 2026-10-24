import Minecraft from './Minecraft';
import MinecraftServer from './MinecraftServer';
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

export default { pages: { main: Page } };
