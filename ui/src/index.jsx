import { Sparkles } from 'lucide-react';
import { useApi } from '@hostwerk/api';
import { Loading } from '@hostwerk/ui';
import { ExtTabView } from '@hostwerk/kit';
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
  // 1.1: „MOTD gestalten …“ (Rechtsklick, Schnellsuche – früher Erweiterung „MOTD-Studio“) → Übersicht des Servers, dort steht der Abschnitt
  const q = new URLSearchParams(String(query || '').replace(/^\?/, ''));
  if (!first && q.get('action') === 'edit' && /^[\w-]+$/.test(q.get('target') || '')) { location.replace(`#/mc/${q.get('target')}`); return null; }
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

/** 1.1: Reiter „MOTD-Studio“ in der Serverliste – der große Editor (bis 1.5 eigene Erweiterung „MOTD-Studio“), im Rahmen. */
function MotdTab() {
  const m = useApi('/extmarket', [], { live: false });
  const ext = m.data && (m.data.installed || []).find((x) => x.id === 'minecraft');
  if (!ext) return <Loading />;
  return <ExtTabView item={{ ext, tab: { file: 'page-motd/index.html' } }} kind="minecraft" id={null} />;
}

const slots = {
  // Dateivorschau: Minecraft-Daten (level.dat, Spieler, Strukturen, Schematics) als NBT-Baum
  'files.preview': [{ id: 'mc-nbt', title: t('NBT tree'), match: NBT_FILES, Component: McNbtView }],
  'minecraft.tabs': [{ id: 'motd', title: 'MOTD studio', icon: Sparkles, Component: MotdTab, order: 80 }],
};

export default { pages: { main: Page }, nav, slots };
