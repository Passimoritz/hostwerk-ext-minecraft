'use strict';
/*
 * Netzwerk-Adressen für „Verbinden“ einordnen: Heimnetz (LAN), VPN (Tailscale, ZeroTier, WireGuard, Hamachi …) oder
 * virtuell (Hyper-V/WSL, VirtualBox, VMware, Docker). Fünf nackte IP-Adressen verwirren sonst – Freunde im Heimnetz
 * brauchen die LAN-Adresse, VPN-Mitspieler die VPN-Adresse, virtuelle Adressen nützen fast nie.
 */
const VIRTUAL = /vethernet|hyper-?v|wsl|virtualbox|vbox|vmware|vmnet|docker|virbr|veth|^br-|default switch|loopback pseudo/i;
const VPN = /tailscale|zerotier|wireguard|^wg\d*|^tun|^tap|openvpn|hamachi|nordlynx|radmin|vpn|^utun|proton|mullvad/i;

function ipNum(ip) { const p = String(ip).split('.').map(Number); return p.length === 4 && p.every((n) => n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; }
const inRange = (ip, base, bits) => { const n = ipNum(ip); const b = ipNum(base); if (n === null) return false; const mask = bits ? (~0 << (32 - bits)) >>> 0 : 0; return ((n & mask) >>> 0) === ((b & mask) >>> 0); };

/** 'lan' | 'vpn' | 'virtual' für eine Schnittstelle (Name wie in os.networkInterfaces()) und ihre IPv4-Adresse. */
function classifyIface(name, ip) {
  const n = String(name || '');
  if (VPN.test(n)) return 'vpn';
  if (VIRTUAL.test(n)) return 'virtual';
  // Typische VPN-Bereiche: Tailscale (100.64.0.0/10), Hamachi (25.0.0.0/8), Radmin (26.0.0.0/8)
  if (inRange(ip, '100.64.0.0', 10) || inRange(ip, '25.0.0.0', 8) || inRange(ip, '26.0.0.0', 8)) return 'vpn';
  if (inRange(ip, '169.254.0.0', 16)) return 'virtual'; // ohne DHCP-Antwort – nicht erreichbar
  return 'lan';
}

const RANK = { lan: 0, vpn: 1, virtual: 2 };
/** Alle externen IPv4-Adressen mit Art, Heimnetz zuerst. */
function lanAddresses(ifaces) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces || {})) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push({ ip: n.address, kind: classifyIface(name, n.address), iface: name });
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

module.exports = { classifyIface, lanAddresses };
