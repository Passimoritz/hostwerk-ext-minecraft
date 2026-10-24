package de.passimoritz.hostwerk.bridge;

import java.io.Closeable;
import java.io.File;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryPoolMXBean;
import java.lang.management.MemoryType;
import java.lang.management.MemoryUsage;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collection;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipFile;

import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandMap;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.PluginIdentifiableCommand;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerListPingEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.scheduler.BukkitWorker;
import org.bukkit.util.CachedServerIcon;

/**
 * Hostwerk-Bridge: lädt ein Plugin im laufenden Server vollständig neu.
 *
 * Ablauf von „hostwerk reload &lt;Name&gt; &lt;neue.jar&gt;“:
 *   1. prüfen, ob das sicher geht (keine abhängigen Plugins, kein Paper-Plugin mit Bootstrapper)
 *   2. altes Plugin deaktivieren und restlos entladen (Befehle, Listener, Aufgaben, Dienste, Kanäle, Klassenlader)
 *   3. alte JAR durch die neue ersetzen, laden und aktivieren, Befehle an die Spieler neu senden
 *
 * „hostwerk tps“ meldet die Ticks pro Sekunde (1, 5, 15 Minuten) und die mittlere Tick-Dauer – Hostwerk fragt das
 * regelmäßig ab und versteckt die Zeile in der Konsole (Verlauf unter „Übersicht“).
 *
 * Ab 1.2: „hostwerk stats [full]“ liefert die Aufschlüsselung für Hostwerks Zustand-Ansicht (Speicher, CPU je Thread-Gruppe,
 * Welten, Plugins), „hostwerk motd &lt;Base64&gt;“ und „hostwerk icon [clear]“ ändern Beschreibung und Symbol in der Serverliste
 * sofort – ohne Neustart (Minecraft selbst liest beides nur beim Start).
 *
 * Ergebnisse stehen als Zeile „[HW] …“ in der Konsole – Hostwerk liest sie mit.
 * Geht etwas schief, meldet die Bridge „RELOAD FAIL“ und Hostwerk startet den Server sicher neu.
 */
public final class HostwerkBridge extends JavaPlugin implements Listener {

    /** Live gesetzte Beschreibung bzw. neu geladenes Server-Symbol – gelten für die Serverliste bis zum nächsten Neustart. */
    private volatile String motdOverride;
    private volatile CachedServerIcon iconOverride;
    private volatile boolean iconCleared;
    /** Letzte CPU-Zeiten je Thread (für „hostwerk stats“: Anteil seit der letzten Abfrage). */
    private final Map<Long, Long> lastCpu = new HashMap<>();
    private long lastStatsAt;
    private final Map<String, Long> lastGc = new HashMap<>();

    @Override
    public void onEnable() {
        if (getCommand("hostwerk") != null) getCommand("hostwerk").setExecutor(this);
        getServer().getPluginManager().registerEvents(this, this);
        report("READY " + getDescription().getVersion());
    }

    /** Serverliste: live gesetzte MOTD und das neue Symbol einsetzen (früh, damit MOTD-Plugins es weiter überschreiben dürfen). */
    @EventHandler(priority = EventPriority.LOWEST)
    public void onPing(ServerListPingEvent e) {
        if (motdOverride != null) e.setMotd(motdOverride);
        try {
            if (iconOverride != null) e.setServerIcon(iconOverride);
            else if (iconCleared) e.setServerIcon(null);
        } catch (Throwable ignored) {
            // Server erlaubt kein Symbol in diesem Ereignis
        }
    }

    private void report(String msg) {
        // Eigene Zeile, die Hostwerk sicher erkennt (unabhängig vom Logformat)
        getLogger().info("[HW] " + msg);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender)) {
            sender.sendMessage("Dieser Befehl ist nur für Hostwerk (Konsole).");
            return true;
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("ping")) {
            report("PONG " + getDescription().getVersion());
            return true;
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("tps")) {
            report(tps());
            return true;
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("stats")) {
            report("STATS " + stats(args.length >= 2 && args[1].equalsIgnoreCase("full")));
            return true;
        }
        if (args.length >= 2 && args[0].equalsIgnoreCase("motd")) {
            // Text kommt Base64-kodiert (UTF-8), damit Farbcodes, Leerzeichen und Zeilenumbrüche heil ankommen
            String motd = new String(Base64.getDecoder().decode(args[1]), StandardCharsets.UTF_8);
            motdOverride = motd;
            boolean server = false;
            try {
                Method m = Bukkit.getServer().getClass().getMethod("setMotd", String.class);
                m.invoke(Bukkit.getServer(), motd);
                server = true;
            } catch (Throwable ignored) {
                // ältere Server: nur über die Serverliste (onPing)
            }
            report("MOTD OK " + (server ? "server" : "ping"));
            return true;
        }
        if (args.length >= 1 && args[0].equalsIgnoreCase("icon")) {
            File f = new File(Bukkit.getWorldContainer(), "server-icon.png");
            try {
                if (args.length >= 2 && args[1].equalsIgnoreCase("clear")) { iconOverride = null; iconCleared = true; report("ICON OK clear"); return true; }
                if (!f.isFile()) { report("ICON FAIL Datei fehlt"); return true; }
                iconOverride = Bukkit.loadServerIcon(f);
                iconCleared = false;
                report("ICON OK");
            } catch (Throwable t) {
                report("ICON FAIL " + t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage()).replace('\n', ' '));
            }
            return true;
        }
        if (args.length >= 2 && args[0].equalsIgnoreCase("check")) {
            String reason = blocker(Bukkit.getPluginManager().getPlugin(args[1]), null);
            report(reason == null ? "CHECK OK " + args[1] : "CHECK NO " + args[1] + " " + reason);
            return true;
        }
        if (args.length >= 3 && args[0].equalsIgnoreCase("reload")) {
            String name = args[1];
            File staged = new File(String.join(" ", Arrays.copyOfRange(args, 2, args.length)));
            try {
                reload(name, staged);
            } catch (Throwable t) {
                report("RELOAD FAIL " + name + " " + t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage()).replace('\n', ' '));
                getLogger().log(java.util.logging.Level.WARNING, "Live-Update fehlgeschlagen", t);
            }
            return true;
        }
        sender.sendMessage("Verwendung: hostwerk <ping|tps|stats [full]|motd <Base64>|icon [clear]|check <Plugin>|reload <Plugin> <Datei>>");
        return true;
    }

    /*
     * Aufschlüsselung für Hostwerks Zustand-Ansicht (eine JSON-Zeile): Java-Speicher (Heap, Bereiche), Müllsammler,
     * CPU je Thread-Gruppe seit der letzten Abfrage (100 = ein voller Kern), Welten (Chunks, Kreaturen, Blockobjekte)
     * und je Plugin die geplanten Aufgaben, Hintergrund-Threads und Listener. „full“ zählt zusätzlich die Kreaturen nach Art.
     */
    private String stats(boolean full) {
        StringBuilder j = new StringBuilder(2048).append('{');
        MemoryMXBean mem = ManagementFactory.getMemoryMXBean();
        MemoryUsage heap = mem.getHeapMemoryUsage();
        MemoryUsage non = mem.getNonHeapMemoryUsage();
        j.append("\"heap\":{\"used\":").append(heap.getUsed()).append(",\"committed\":").append(heap.getCommitted()).append(",\"max\":").append(heap.getMax()).append('}');
        j.append(",\"nonHeap\":{\"used\":").append(non.getUsed()).append(",\"committed\":").append(non.getCommitted()).append('}');
        j.append(",\"pools\":[");
        boolean first = true;
        for (MemoryPoolMXBean p : ManagementFactory.getMemoryPoolMXBeans()) {
            MemoryUsage u = p.getUsage();
            if (u == null) continue;
            if (!first) j.append(',');
            first = false;
            j.append("{\"name\":").append(q(p.getName())).append(",\"heap\":").append(p.getType() == MemoryType.HEAP).append(",\"used\":").append(u.getUsed()).append(",\"committed\":").append(u.getCommitted()).append('}');
        }
        j.append(']');

        long now = System.nanoTime();
        long wall = lastStatsAt == 0 ? 0 : now - lastStatsAt;
        j.append(",\"gc\":[");
        first = true;
        for (GarbageCollectorMXBean g : ManagementFactory.getGarbageCollectorMXBeans()) {
            long t = Math.max(0, g.getCollectionTime());
            Long before = lastGc.put(g.getName(), t);
            if (!first) j.append(',');
            first = false;
            j.append("{\"name\":").append(q(g.getName())).append(",\"count\":").append(g.getCollectionCount()).append(",\"ms\":").append(t)
                .append(",\"pct\":").append(wall > 0 && before != null ? pct((t - before) * 1_000_000L, wall) : "null").append('}');
        }
        j.append(']');

        // CPU je Thread – nach Aufgabe gruppiert; Plugin-Threads tragen meist den Plugin-Namen
        ThreadMXBean tb = ManagementFactory.getThreadMXBean();
        Map<String, long[]> groups = new LinkedHashMap<>();
        List<Object[]> top = new ArrayList<>();
        Map<Long, Long> seen = new HashMap<>();
        List<String> pluginNames = new ArrayList<>();
        for (Plugin p : Bukkit.getPluginManager().getPlugins()) pluginNames.add(p.getName());
        if (tb.isThreadCpuTimeSupported()) {
            if (!tb.isThreadCpuTimeEnabled()) { try { tb.setThreadCpuTimeEnabled(true); } catch (Throwable ignored) { /* nicht erlaubt */ } }
            for (ThreadInfo ti : tb.getThreadInfo(tb.getAllThreadIds())) {
                if (ti == null) continue;
                long cpu = tb.getThreadCpuTime(ti.getThreadId());
                if (cpu < 0) continue;
                seen.put(ti.getThreadId(), cpu);
                Long before = lastCpu.get(ti.getThreadId());
                long d = wall > 0 && before != null ? Math.max(0, cpu - before) : 0;
                String g = groupOf(ti.getThreadName(), pluginNames);
                long[] acc = groups.computeIfAbsent(g, k -> new long[2]);
                acc[0] += d;
                acc[1]++;
                if (d > 0) top.add(new Object[] { ti.getThreadName(), d, g });
            }
        }
        lastCpu.clear();
        lastCpu.putAll(seen);
        lastStatsAt = now;
        j.append(",\"wallMs\":").append(wall / 1_000_000L);
        j.append(",\"cores\":").append(Runtime.getRuntime().availableProcessors());
        j.append(",\"threads\":[");
        first = true;
        for (Map.Entry<String, long[]> e : groups.entrySet()) {
            if (!first) j.append(',');
            first = false;
            j.append("{\"group\":").append(q(e.getKey())).append(",\"count\":").append(e.getValue()[1]).append(",\"pct\":").append(wall > 0 ? pct(e.getValue()[0], wall) : "null").append('}');
        }
        j.append("],\"topThreads\":[");
        top.sort((a, b) -> Long.compare((Long) b[1], (Long) a[1]));
        for (int i = 0; i < Math.min(8, top.size()); i++) {
            if (i > 0) j.append(',');
            j.append("{\"name\":").append(q((String) top.get(i)[0])).append(",\"group\":").append(q((String) top.get(i)[2])).append(",\"pct\":").append(pct((Long) top.get(i)[1], wall)).append('}');
        }
        j.append(']');

        // Welten: geladene Chunks, Kreaturen, Blockobjekte (Truhen, Öfen …), Spieler
        j.append(",\"worlds\":[");
        first = true;
        Map<String, Integer> types = new HashMap<>();
        for (World w : Bukkit.getWorlds()) {
            if (!first) j.append(',');
            first = false;
            int chunks = -1, entities = -1, tiles = -1;
            try { chunks = w.getLoadedChunks().length; } catch (Throwable ignored) { /* Folia: nur im Regions-Thread */ }
            try { entities = (int) call(w, "getEntityCount"); } catch (Throwable e) { try { entities = w.getEntities().size(); } catch (Throwable ignored) { /* Folia */ } }
            try { tiles = (int) call(w, "getTileEntityCount"); } catch (Throwable ignored) { /* nur Paper */ }
            if (full) {
                try { for (org.bukkit.entity.Entity en : w.getEntities()) types.merge(en.getType().name().toLowerCase(java.util.Locale.ROOT), 1, Integer::sum); } catch (Throwable ignored) { /* Folia */ }
            }
            String key = w.getName();
            try { key = String.valueOf(call(w, "getKey")); } catch (Throwable ignored) { /* vor 1.16 */ }
            j.append("{\"name\":").append(q(w.getName())).append(",\"key\":").append(q(key)).append(",\"env\":").append(q(w.getEnvironment().name().toLowerCase(java.util.Locale.ROOT)))
                .append(",\"chunks\":").append(chunks).append(",\"entities\":").append(entities).append(",\"tiles\":").append(tiles).append(",\"players\":").append(w.getPlayers().size()).append('}');
        }
        j.append(']');
        if (full) {
            j.append(",\"entityTypes\":[");
            List<Map.Entry<String, Integer>> list = new ArrayList<>(types.entrySet());
            list.sort((a, b) -> b.getValue() - a.getValue());
            for (int i = 0; i < Math.min(10, list.size()); i++) {
                if (i > 0) j.append(',');
                j.append("{\"type\":").append(q(list.get(i).getKey())).append(",\"count\":").append(list.get(i).getValue()).append('}');
            }
            j.append(']');
        }

        // Plugins: geplante Aufgaben, laufende Hintergrund-Aufgaben, Listener
        Map<Plugin, int[]> per = new LinkedHashMap<>();
        for (Plugin p : Bukkit.getPluginManager().getPlugins()) per.put(p, new int[3]);
        try { for (BukkitTask t : Bukkit.getScheduler().getPendingTasks()) { int[] a = per.get(t.getOwner()); if (a != null) a[0]++; } } catch (Throwable ignored) { /* Folia */ }
        try { for (BukkitWorker w : Bukkit.getScheduler().getActiveWorkers()) { int[] a = per.get(w.getOwner()); if (a != null) a[1]++; } } catch (Throwable ignored) { /* Folia */ }
        for (Map.Entry<Plugin, int[]> e : per.entrySet()) { try { e.getValue()[2] = HandlerList.getRegisteredListeners(e.getKey()).size(); } catch (Throwable ignored) { /* egal */ } }
        j.append(",\"plugins\":[");
        first = true;
        for (Map.Entry<Plugin, int[]> e : per.entrySet()) {
            if (!first) j.append(',');
            first = false;
            j.append("{\"name\":").append(q(e.getKey().getName())).append(",\"enabled\":").append(e.getKey().isEnabled()).append(",\"tasks\":").append(e.getValue()[0]).append(",\"workers\":").append(e.getValue()[1]).append(",\"listeners\":").append(e.getValue()[2]).append('}');
        }
        j.append(']');
        j.append(",\"players\":").append(Bukkit.getOnlinePlayers().size());
        return j.append('}').toString();
    }

    /** Thread-Name → Gruppe: main, chunks, network, async, plugin:&lt;Name&gt;, log, other. */
    private static String groupOf(String name, List<String> plugins) {
        String n = name.toLowerCase(java.util.Locale.ROOT);
        if (n.equals("server thread") || n.startsWith("region scheduler")) return "main";
        for (String p : plugins) if (p.length() >= 4 && n.contains(p.toLowerCase(java.util.Locale.ROOT))) return "plugin:" + p;
        if (n.contains("chunk") || n.startsWith("worker-main") || n.contains("worldgen") || n.contains("c2me") || n.contains("moonrise") || n.contains("tuinity")) return "chunks";
        if (n.contains("netty") || n.contains("server io") || n.contains("epoll") || n.contains("nio") || n.contains("query") || n.contains("rcon") || n.contains("user authenticator") || n.contains("velocity")) return "network";
        if (n.contains("craft scheduler") || n.contains("async task") || n.contains("craft async")) return "async";
        if (n.contains("log4j") || n.contains("console") || n.contains("terminal")) return "log";
        return "other";
    }

    private static Object call(Object o, String method) throws Exception {
        return o.getClass().getMethod(method).invoke(o);
    }

    private static String pct(long cpuNanos, long wallNanos) {
        return String.format(java.util.Locale.ROOT, "%.1f", wallNanos > 0 ? cpuNanos * 100.0 / wallNanos : 0.0);
    }

    private static String q(String s) {
        StringBuilder b = new StringBuilder(s.length() + 2).append('"');
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    /** TPS und MSPT (nur Paper und Abkömmlinge kennen sie – Spigot meldet „TPS NA“). */
    private String tps() {
        try {
            double[] t = Bukkit.getTPS();
            double mspt = Bukkit.getAverageTickTime();
            return String.format(java.util.Locale.ROOT, "TPS %.2f %.2f %.2f MSPT %.2f", Math.min(20, t[0]), Math.min(20, t[1]), Math.min(20, t[2]), mspt);
        } catch (Throwable e) {
            return "TPS NA";
        }
    }

    /** Gründe, warum ein Plugin nicht im laufenden Betrieb getauscht werden sollte (null = geht). */
    private String blocker(Plugin old, File newJar) {
        if (old == this) return "Die Bridge kann sich nicht selbst neu laden";
        if (newJar != null) {
            try (ZipFile zip = new ZipFile(newJar)) {
                if (zip.getEntry("paper-plugin.yml") != null) return "Paper-Plugin (paper-plugin.yml) – nur per Neustart austauschbar";
                if (zip.getEntry("plugin.yml") == null) return "Keine plugin.yml in der JAR";
            } catch (Exception e) {
                return "JAR nicht lesbar: " + e.getMessage();
            }
        }
        if (old == null) return null;
        if (isPaperPlugin(old)) return "Paper-Plugin – nur per Neustart austauschbar";
        // Abhängige Plugins (depend/softdepend) werden ab 1.2 mit neu geladen – nur Paper-Plugins und solche ohne Datei nicht
        for (Plugin p : dependents(old)) {
            if (p == this) return "Die Bridge hängt davon ab";
            if (isPaperPlugin(p)) return "Paper-Plugin " + p.getName() + " hängt davon ab – nur per Neustart austauschbar";
            if (fileOf(p) == null) return "Plugin " + p.getName() + " hängt davon ab und lässt sich nicht neu laden";
        }
        return null;
    }

    private static boolean isPaperPlugin(Plugin p) {
        return p.getClass().getClassLoader().getClass().getName().contains("PaperPluginClassLoader");
    }

    /**
     * Alle eingeschalteten Plugins, die (auch über Umwege) von target abhängen – in Entlade-Reihenfolge:
     * wer von einem Abhängigen abhängt, steht vor ihm. Geladen wird später in umgekehrter Reihenfolge.
     */
    private static List<Plugin> dependents(Plugin target) {
        List<Plugin> out = new ArrayList<>();
        collect(target, out);
        return out;
    }

    private static void collect(Plugin target, List<Plugin> out) {
        for (Plugin p : Bukkit.getPluginManager().getPlugins()) {
            if (p == target || out.contains(p) || !p.isEnabled()) continue;
            List<String> deps = new ArrayList<>(p.getDescription().getDepend());
            deps.addAll(p.getDescription().getSoftDepend());
            if (deps.stream().anyMatch(d -> d.equalsIgnoreCase(target.getName()))) {
                collect(p, out);
                if (!out.contains(p)) out.add(p);
            }
        }
    }

    private void reload(String name, File staged) throws Exception {
        if (!staged.isFile()) throw new IllegalArgumentException("Datei nicht gefunden: " + staged);
        PluginManager pm = Bukkit.getPluginManager();
        Plugin old = pm.getPlugin(name);
        String reason = blocker(old, staged);
        if (reason != null) { report("RELOAD NO " + name + " " + reason); return; }

        File pluginsDir = getDataFolder().getParentFile();
        File oldFile = old != null ? fileOf(old) : null;
        String oldVersion = old != null ? old.getDescription().getVersion() : "-";
        // Abhängige zuerst entladen (Dateien merken), nach dem Austausch in umgekehrter Reihenfolge wieder laden
        List<Plugin> deps = old != null ? dependents(old) : new ArrayList<>();
        List<File> depFiles = new ArrayList<>();
        for (Plugin p : deps) depFiles.add(fileOf(p));
        for (Plugin p : deps) unload(p);
        if (old != null) unload(old);

        // Alte JAR weg, neue an ihren Platz (Dateiname ohne Hostwerk-Präfix)
        if (oldFile != null && oldFile.exists() && !oldFile.delete()) {
            System.gc();
            Thread.sleep(150);
            if (oldFile.exists() && !oldFile.delete()) throw new IllegalStateException("Alte JAR ist noch gesperrt: " + oldFile.getName());
        }
        File dest = new File(pluginsDir, staged.getName().replaceFirst("^hw-staged-", ""));
        Files.move(staged.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING);

        Plugin fresh = pm.loadPlugin(dest);
        if (fresh == null) throw new IllegalStateException("Plugin ließ sich nicht laden");
        // Paper ruft onLoad beim Laden zur Laufzeit selbst auf, Spigot nicht
        if (!isPaper()) fresh.onLoad();
        pm.enablePlugin(fresh);
        if (!fresh.isEnabled()) throw new IllegalStateException("Plugin wurde geladen, aber nicht aktiviert (Fehler im onEnable? Siehe Konsole)");
        List<String> again = new ArrayList<>();
        for (int i = depFiles.size() - 1; i >= 0; i--) {
            Plugin p = pm.loadPlugin(depFiles.get(i));
            if (p == null) throw new IllegalStateException("Abhängiges Plugin ließ sich nicht wieder laden: " + depFiles.get(i).getName());
            if (!isPaper()) p.onLoad();
            pm.enablePlugin(p);
            if (!p.isEnabled()) throw new IllegalStateException("Abhängiges Plugin " + p.getName() + " wurde nicht wieder aktiviert (siehe Konsole)");
            again.add(p.getName());
        }
        syncCommands();
        report("RELOAD OK " + fresh.getName() + " " + oldVersion + " -> " + fresh.getDescription().getVersion() + (again.isEmpty() ? "" : " +" + String.join(",", again)));
    }

    private static boolean isPaper() {
        try { Class.forName("io.papermc.paper.plugin.manager.PaperPluginManagerImpl"); return true; } catch (ClassNotFoundException e) { return false; }
    }

    private static File fileOf(Plugin p) {
        try {
            Method m = JavaPlugin.class.getDeclaredMethod("getFile");
            m.setAccessible(true);
            return (File) m.invoke(p);
        } catch (Exception e) {
            return null;
        }
    }

    /** Plugin restlos entfernen, damit Klassen und JAR freigegeben werden. */
    private void unload(Plugin plugin) throws Exception {
        PluginManager pm = Bukkit.getPluginManager();
        if (plugin.isEnabled()) pm.disablePlugin(plugin);
        Bukkit.getScheduler().cancelTasks(plugin);
        HandlerList.unregisterAll(plugin);
        Bukkit.getServicesManager().unregisterAll(plugin);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(plugin);
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin);
        removeCommands(plugin);

        ClassLoader cl = plugin.getClass().getClassLoader();
        // Aus allen Listen/Maps des Plugin-Managers (Bukkit + Paper) entfernen
        Set<Object> seen = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
        scrub(pm, plugin, cl, seen, 0);
        // Paper: globale Klassenlader-Registrierung
        try {
            Class<?> storage = Class.forName("io.papermc.paper.plugin.provider.classloader.PaperClassLoaderStorage");
            Object inst = storage.getMethod("instance").invoke(null);
            for (Method m : inst.getClass().getMethods()) {
                if (m.getName().equals("unregisterClassloader") && m.getParameterCount() == 1 && m.getParameterTypes()[0].isInstance(cl)) m.invoke(inst, cl);
            }
        } catch (ClassNotFoundException ignored) {
            // kein Paper
        }
        // Paper: Liste der „Provider“ (zeigt /plugins) – sonst steht das Plugin nach dem Austausch doppelt darin
        try {
            Class<?> h = Class.forName("io.papermc.paper.plugin.entrypoint.LaunchEntryPointHandler");
            Object inst = h.getField("INSTANCE").get(null);
            scrubProviders(inst, plugin.getName(), java.util.Collections.newSetFromMap(new IdentityHashMap<>()), 0);
        } catch (Throwable ignored) {
            // kein Paper oder anderer Aufbau – nur die Anzeige von /plugins betroffen
        }
        if (cl instanceof Closeable c) c.close();
        System.gc();
    }

    /** Provider mit diesem Plugin-Namen aus Paper-Listen entfernen (sucht bis drei Ebenen tief, nur Paper-Klassen). */
    private static void scrubProviders(Object obj, String name, Set<Object> seen, int depth) {
        if (obj == null || depth > 3 || !seen.add(obj)) return;
        if (obj instanceof Map<?, ?> map) { for (Object v : new ArrayList<>(map.values())) scrubProviders(v, name, seen, depth + 1); return; }
        if (obj instanceof Collection<?> col) {
            try { col.removeIf(x -> name.equalsIgnoreCase(providerName(x))); } catch (Exception ignored) { /* unveränderlich */ }
            return;
        }
        if (!obj.getClass().getName().startsWith("io.papermc")) return;
        for (Class<?> c = obj.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers()) || f.getType().isPrimitive()) continue;
                try { f.setAccessible(true); scrubProviders(f.get(obj), name, seen, depth + 1); } catch (Exception ignored) { /* nicht lesbar */ }
            }
        }
    }

    /** Name eines Paper-PluginProviders (getMeta().getName()), sonst null. */
    private static String providerName(Object provider) {
        if (provider == null || !provider.getClass().getName().startsWith("io.papermc")) return null;
        try {
            Object meta = provider.getClass().getMethod("getMeta").invoke(provider);
            return meta == null ? null : String.valueOf(meta.getClass().getMethod("getName").invoke(meta));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Durchsucht die Felder des Plugin-Managers (und dessen Paper-Unterobjekte) nach Listen, Maps und
     * Graphen, die das Plugin oder seinen Klassenlader enthalten, und entfernt die Einträge.
     */
    private static void scrub(Object obj, Plugin plugin, ClassLoader cl, Set<Object> seen, int depth) {
        if (obj == null || depth > 3 || !seen.add(obj)) return;
        String pkg = obj.getClass().getName();
        if (!(pkg.startsWith("org.bukkit") || pkg.startsWith("io.papermc") || pkg.startsWith("com.destroystokyo"))) return;
        String name = plugin.getName();
        for (Class<?> c = obj.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers()) || f.getType().isPrimitive()) continue;
                Object v;
                try { f.setAccessible(true); v = f.get(obj); } catch (Exception e) { continue; }
                if (v == null) continue;
                if (v instanceof Collection<?> col) {
                    try { col.removeIf(x -> x == plugin || x == cl); } catch (Exception ignored) { /* unveränderlich */ }
                } else if (v instanceof Map<?, ?> map) {
                    try {
                        map.entrySet().removeIf(e -> e.getValue() == plugin || e.getKey() == plugin || e.getValue() == cl
                            || (e.getKey() instanceof String k && k.equalsIgnoreCase(name) && e.getValue() instanceof Plugin));
                    } catch (Exception ignored) { /* unveränderlich */ }
                } else if (v.getClass().getName().startsWith("com.google.common.graph")) {
                    // Paper-Abhängigkeitsgraph: Knoten mit dem Plugin-Namen entfernen
                    for (String n : new String[] { name, name.toLowerCase() }) {
                        try { v.getClass().getMethod("removeNode", Object.class).invoke(v, n); } catch (Exception ignored) { /* nicht vorhanden */ }
                    }
                } else {
                    scrub(v, plugin, cl, seen, depth + 1);
                }
            }
        }
    }

    private static void removeCommands(Plugin plugin) {
        CommandMap map = Bukkit.getCommandMap();
        Map<String, Command> known = map.getKnownCommands();
        // Paper: die Map ist eine Brigadier-Ansicht – Iterator.remove geht nicht, map.remove(key) schon
        List<String> keys = new ArrayList<>();
        for (Map.Entry<String, Command> e : known.entrySet()) {
            if (e.getValue() instanceof PluginIdentifiableCommand pic && pic.getPlugin() == plugin) keys.add(e.getKey());
        }
        for (String k : keys) {
            Command cmd = known.get(k);
            try { known.remove(k); } catch (UnsupportedOperationException ignored) { /* nur lesbar */ }
            if (cmd != null) { try { cmd.unregister(map); } catch (Exception ignored) { /* egal */ } }
        }
    }

    /** Befehlsliste (Tab-Vervollständigung) an alle Spieler neu senden. */
    private static void syncCommands() {
        try {
            Method m = Bukkit.getServer().getClass().getDeclaredMethod("syncCommands");
            m.setAccessible(true);
            m.invoke(Bukkit.getServer());
        } catch (Exception ignored) {
            // ältere Server: Spieler sehen neue Befehle nach dem Neuverbinden
        }
    }
}
