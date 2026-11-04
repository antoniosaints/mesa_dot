import { isIP } from 'node:net';
/** Trust explicit peers only; never accept a client-supplied forwarding chain globally. */
export function trustedProxyAddresses(value: string): string[] | false {
  if (value.trim() === 'none') return false;
  const addresses = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!addresses.length) throw new Error('TRUSTED_PROXIES exige IPs/CIDRs ou none.');
  for (const entry of addresses) {
    if (entry === 'loopback') continue;
    const [address, bits, extra] = entry.split('/');
    const version = isIP(address);
    if (
      !version ||
      extra !== undefined ||
      (bits !== undefined &&
        (!/^\d+$/.test(bits) || Number(bits) < 1 || Number(bits) > (version === 4 ? 32 : 128)))
    )
      throw new Error('TRUSTED_PROXIES contém um IP/CIDR inválido ou irrestrito.');
  }
  return addresses;
}
