package de.hostwerk.{{PKG}};

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** {{TITLE}} – angelegt mit Hostwerk. Jede neu gebaute Version spielt Hostwerk live in den Server ein. */
public final class {{CLASS}} extends JavaPlugin implements Listener {

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("{{TITLE}} " + getPluginMeta().getVersion() + " ist aktiv.");
    }

    @Override
    public void onDisable() {
        getLogger().info("{{TITLE}} wurde beendet.");
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        String text = getConfig().getString("greeting", "Willkommen!").replace("%player%", event.getPlayer().getName());
        event.getPlayer().sendMessage(ChatColor.translateAlternateColorCodes('&', text));
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String name = args.length > 0 ? args[0] : sender.getName();
        sender.sendMessage(ChatColor.GREEN + "Hallo " + name + "! " + ChatColor.GRAY + "(Version " + getPluginMeta().getVersion() + ")");
        return true;
    }
}
