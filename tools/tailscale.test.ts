import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { tailscaleAddress } from "./tailscale.ts";

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal,
  cidr: `${address}/24`,
});
const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: "ffff:ffff:ffff:ffff::",
  family: "IPv6",
  mac: "00:00:00:00:00:00",
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});

describe("tailscaleAddress", () => {
  it("picks the Tailscale address over loopback and the LAN", () => {
    expect(
      tailscaleAddress({
        lo0: [v4("127.0.0.1", true), v6("::1")],
        en0: [v4("192.168.1.156"), v6("2600:4041::1")],
        utun6: [v6("fd7a:115c:a1e0::1"), v4("100.66.207.90")],
      }),
    ).toBe("100.66.207.90");
  });

  it("accepts both ends of 100.64.0.0/10", () => {
    expect(tailscaleAddress({ utun0: [v4("100.64.0.1")] })).toBe("100.64.0.1");
    expect(tailscaleAddress({ utun0: [v4("100.127.255.254")] })).toBe("100.127.255.254");
  });

  it("finds nothing when every address is outside 100.64.0.0/10", () => {
    expect(tailscaleAddress({ en0: [v4("192.168.1.156"), v4("100.63.255.255"), v4("100.128.0.1"), v4("10.100.64.1")] })).toBeNull();
    expect(tailscaleAddress({})).toBeNull();
  });
});
