// Where the agent's browser may connect: the public internet, never this
// machine or the network it sits on. The proxy (proxy.ts) asks this about
// every address it is about to dial, after resolving the name itself, so a
// name that resolves to loopback is refused the same as a literal one.

import net from "node:net";
import os from "node:os";

const V4: [string, number][] = [
    ["0.0.0.0", 8], // this network, unspecified
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // carrier-grade NAT, and some clouds' metadata (100.100.100.200)
    ["127.0.0.0", 8],
    ["169.254.0.0", 16], // link-local, cloud metadata
    ["172.16.0.0", 12],
    ["192.0.0.0", 24], // IETF protocol assignments (192.0.0.192 is a metadata endpoint)
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, broadcast
];
const V4_HOSTS = ["168.63.129.16"]; // Azure's platform endpoint, outside the ranges above

const V6: [string, number][] = [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7], // unique local
    ["fe80::", 10], // link-local
    ["fec0::", 10], // site-local (deprecated, still routable on some networks)
    ["ff00::", 8], // multicast
    ["100::", 64], // discard
    ["2001:db8::", 32], // documentation
    ["fd00:ec2::", 32], // AWS metadata
];

const blocked = new net.BlockList();
for (const [a, p] of V4) blocked.addSubnet(a, p, "ipv4");
for (const a of V4_HOSTS) blocked.addAddress(a, "ipv4");
for (const [a, p] of V6) blocked.addSubnet(a, p, "ipv6");

/** The IPv4 address an IPv6 one carries: mapped, compatible, NAT64 (64:ff9b::/96) and 6to4 (2002::/16). */
export function embeddedV4(ip: string): string | null {
    const words = expandV6(ip);
    if (!words) return null;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const zero = (from: number, to: number) => words.slice(from, to).every((w) => w === 0);
    // ::ffff:a.b.c.d, ::ffff:0:a.b.c.d (translated), ::a.b.c.d (compatible; :: and ::1 are matched as themselves)
    if (zero(0, 5) && words[5] === 0xffff) return v4(words[6]!, words[7]!);
    if (zero(0, 4) && words[4] === 0xffff && words[5] === 0) return v4(words[6]!, words[7]!);
    if (zero(0, 6) && (words[6]! > 0 || words[7]! > 1)) return v4(words[6]!, words[7]!);
    if (words[0] === 0x64 && words[1] === 0xff9b && zero(2, 6)) return v4(words[6]!, words[7]!);
    if (words[0] === 0x2002) return v4(words[1]!, words[2]!);
    return null;
}

function expandV6(ip: string): number[] | null {
    if (net.isIPv6(ip) === false) return null;
    let s = ip.toLowerCase().split("%")[0]!;
    // a trailing dotted quad becomes two words
    const quad = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (quad) {
        const [a, b, c, d] = quad.slice(1).map(Number) as [number, number, number, number];
        s = s.slice(0, quad.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const [head, tail] = s.split("::") as [string, string | undefined];
    const h = head ? head.split(":") : [];
    const t = tail !== undefined && tail ? tail.split(":") : [];
    const fill = tail !== undefined ? 8 - h.length - t.length : 0;
    const words = [...h, ...Array(Math.max(0, fill)).fill("0"), ...t].map((w) => parseInt(w, 16));
    return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

/** This machine's own addresses: a service bound to 0.0.0.0 answers on them just as it does on loopback. */
function ownAddresses(): Set<string> {
    const own = new Set<string>();
    for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) own.add(i.address.toLowerCase().split("%")[0]!);
    return own;
}

/**
 * Why the agent's browser may not connect to this address, or null when it may. Anything that isn't an
 * IP address is refused: the proxy only ever asks about addresses it resolved.
 */
export function refusal(ip: string): string | null {
    const family = net.isIP(ip);
    if (family === 0) return "not an address";
    const bare = ip.toLowerCase().split("%")[0]!;
    if (family === 6) {
        const v4 = embeddedV4(bare);
        if (v4 !== null) return refusal(v4);
    }
    if (blocked.check(bare, family === 4 ? "ipv4" : "ipv6")) return "a private or local address";
    // read each time: addresses change as networks come and go
    if (ownAddresses().has(bare)) return "this computer's own address";
    return null;
}
