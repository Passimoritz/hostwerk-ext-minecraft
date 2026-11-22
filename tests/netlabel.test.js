'use strict';
// Adressen in „Verbinden“ bekommen eine Art (Heimnetz/VPN/virtuell), Heimnetz zuerst.
const test = require('node:test');
const assert = require('node:assert');
const { classifyIface, lanAddresses } = require('../server/netlabel');

test('classifyIface ordnet typische Schnittstellen ein', () => {
  assert.strictEqual(classifyIface('Ethernet', '192.168.1.20'), 'lan');
  assert.strictEqual(classifyIface('WLAN', '10.0.0.5'), 'lan');
  assert.strictEqual(classifyIface('vEthernet (WSL)', '172.24.16.1'), 'virtual');
  assert.strictEqual(classifyIface('VirtualBox Host-Only Network', '192.168.56.1'), 'virtual');
  assert.strictEqual(classifyIface('VMware Network Adapter VMnet8', '192.168.80.1'), 'virtual');
  assert.strictEqual(classifyIface('Tailscale', '100.101.1.2'), 'vpn');
  assert.strictEqual(classifyIface('Ethernet 3', '100.70.0.1'), 'vpn');
  assert.strictEqual(classifyIface('ZeroTier One [abc]', '10.147.17.3'), 'vpn');
  assert.strictEqual(classifyIface('wg0', '10.8.0.2'), 'vpn');
  assert.strictEqual(classifyIface('Ethernet 2', '169.254.10.1'), 'virtual');
});

test('lanAddresses: nur externe IPv4, Heimnetz zuerst', () => {
  const r = lanAddresses({
    'vEthernet (Default Switch)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
    Tailscale: [{ family: 'IPv4', address: '100.100.1.1', internal: false }],
    Ethernet: [{ family: 'IPv6', address: 'fe80::1', internal: false }, { family: 'IPv4', address: '192.168.0.10', internal: false }],
    'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  });
  assert.deepStrictEqual(r.map((x) => [x.ip, x.kind]), [['192.168.0.10', 'lan'], ['100.100.1.1', 'vpn'], ['172.20.0.1', 'virtual']]);
});
