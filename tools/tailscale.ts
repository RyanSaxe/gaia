// Finds this machine's Tailscale address, so a server can listen there and
// nowhere else.

import type { NetworkInterfaceInfo } from "node:os";

/**
 * The first IPv4 address in 100.64.0.0/10, the range Tailscale assigns its
 * nodes from, or null when the machine has none.
 */
export function tailscaleAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const [first, second] = info.address.split(".").map(Number);
      if (first === 100 && second !== undefined && second >= 64 && second <= 127) return info.address;
    }
  }
  return null;
}
