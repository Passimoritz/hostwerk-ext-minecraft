'use strict';
/*
 * Schnellbefehle im Terminal für einen Minecraft-Server-Ordner (SDK 3.5, contribute('terminal')): server.properties
 * oder eine Server-Jar zusammen mit typischen Server-Dateien. Bis Hostwerk 3.1 im Kern.
 */
const JAR = /^(paper|purpur|spigot|folia|fabric-server|forge|velocity|bungeecord|waterfall|minecraft_server|server)[\w.+-]*\.jar$/i;

function detect(names, has) {
  let jar = names.find((n) => JAR.test(n)) || '';
  // Server-Jar nur zusammen mit typischen Server-Dateien als Minecraft werten (sonst irgendeine server.jar)
  if (jar && !has.has('server.properties') && !has.has('eula.txt') && !has.has('plugins') && !has.has('mods')) jar = '';
  if (!has.has('server.properties') && !jar) return null;
  const j = jar || 'server.jar';
  const dir = (d) => ({ label: d, cmd: `ls -la ${d}`, ps: `Get-ChildItem ${d}`, win: `dir ${d}` });
  return {
    id: 'minecraft', label: 'Minecraft', reason: 'Minecraft-Server in diesem Ordner', first: true,
    recent: /^java\s.*-jar\s+\S*(paper|purpur|spigot|folia|fabric|forge|velocity|bungee|waterfall|minecraft|server)\S*\.jar|^(\.[\\/])?mcrcon(\.exe)?(\s|$)/i,
    commands: [
      { label: 'start', cmd: `java -Xms2G -Xmx4G -jar ${j} nogui` },
      { label: 'log', cmd: 'tail -f logs/latest.log', ps: 'Get-Content -Wait -Tail 50 logs\\latest.log', win: 'type logs\\latest.log' },
      { label: 'properties', cmd: 'cat server.properties', ps: 'Get-Content server.properties', win: 'type server.properties' },
      ...(has.has('plugins') ? [dir('plugins')] : []), ...(has.has('mods') ? [dir('mods')] : []),
      { label: 'java -version', cmd: 'java -version' },
      { label: 'eula', cmd: 'echo eula=true> eula.txt', ps: "Set-Content eula.txt 'eula=true'" },
    ],
  };
}

module.exports = { detect };
