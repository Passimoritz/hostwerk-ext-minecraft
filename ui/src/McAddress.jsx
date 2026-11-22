import { Copy } from 'lucide-react';
import { toast } from '@hostwerk/ui';
import { t as T } from '@hostwerk/i18n';

// Art je Adresse: dieser PC, Heimnetz, VPN, virtuell (VM/WSL) – statt fünf nackter IP-Adressen
const KIND = { local: 'This PC', lan: 'Home network', vpn: 'VPN', virtual: 'Virtual (VM/WSL)' };
const HINT = {
  local: 'Only for Minecraft on this PC.',
  lan: 'For players in your home network (same router).',
  vpn: 'For players in the same VPN (e.g. Tailscale, ZeroTier).',
  virtual: 'Adapter of a virtual machine or WSL – usually not reachable for other players.',
};

export function addressRows(s) {
  const a = s.address || {};
  const kinds = a.kinds || [];
  return [{ addr: a.local, kind: 'local' }, ...(a.lan || []).map((addr, i) => ({ addr, kind: kinds[i] || 'lan' }))].filter((x) => x.addr);
}

export function AddressRows({ s, extra }) {
  return addressRows(s).map(({ addr, kind }) => (
    <div key={addr} className={`row-tight mc-addr${kind === 'virtual' ? ' mc-addr-virtual' : ''}`}>
      <code className="grow ellipsis">{addr}</code>
      <span className="badge mc-addr-kind" title={T(HINT[kind])}>{T(KIND[kind])}</span>
      {extra}
      <button className="btn ghost xs icon" title={T('Copy')} aria-label={T('Copy')} onClick={() => { navigator.clipboard.writeText(addr); toast.success('Address copied'); }}><Copy /></button>
    </div>
  ));
}
