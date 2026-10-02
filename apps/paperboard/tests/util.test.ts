import { describe, it, expect } from "bun:test";
import {
    semverGt,
    RingBuffer,
    resolveRegistryUrl,
    selectNetworkIp,
    getNetworkIp,
    isUnspecifiedHost,
    getDisplayHost,
} from "../papercrane/util";
import { formatListenAddress } from "../papercrane/tui";

describe("semverGt", () => {
    it("compares major/minor/patch", () => {
        expect(semverGt("2.0.0", "1.9.9")).toBe(true);
        expect(semverGt("1.1.0", "1.0.9")).toBe(true);
        expect(semverGt("1.0.1", "1.0.0")).toBe(true);
        expect(semverGt("1.0.0", "1.0.0")).toBe(false);
        expect(semverGt("1.0.0", "1.0.1")).toBe(false);
    });

    it("strips non-numeric prefixes (v-prefix)", () => {
        expect(semverGt("v2.0.0", "1.0.0")).toBe(true);
        expect(semverGt("v1.0.0", "v1.0.0")).toBe(false);
    });

    it("handles missing patch segments", () => {
        expect(semverGt("1.1", "1.0.5")).toBe(true);
        expect(semverGt("1.0", "1.0.3")).toBe(false);
    });

    it("handles empty/garbage as zero", () => {
        expect(semverGt("", "0")).toBe(false);
        expect(semverGt("0.0.1", "")).toBe(true);
    });
});

describe("RingBuffer", () => {
    it("returns pushed content", () => {
        const rb = new RingBuffer(100);
        rb.push("hello ");
        rb.push("world");
        expect(rb.getAll()).toBe("hello world");
    });

    it("evicts oldest chunks beyond the budget (chunk granularity)", () => {
        const rb = new RingBuffer(15);
        rb.push("aaaaa");
        rb.push("bbbbbbbbbb"); // exactly full
        rb.push("c"); // evicts the first chunk entirely, not partial chars
        expect(rb.getAll()).toBe("bbbbbbbbbbc");
    });

    it("never exceeds max size", () => {
        const rb = new RingBuffer(50);
        for (let i = 0; i < 100; i++) rb.push("x".repeat(10));
        expect(rb.size).toBeLessThanOrEqual(60); // at most one chunk over budget
    });

    it("handles a single chunk larger than the budget", () => {
        const rb = new RingBuffer(4);
        rb.push("toolongstring"); // whole chunk is evicted — cannot split
        expect(rb.getAll()).toBe("");
        expect(rb.size).toBe(0);
    });
});

describe("network ip selection", () => {
    it("skips the unspecified 0.0.0.0 adapter and picks a real address", () => {
        expect(
            selectNetworkIp({
                Ethernet: [
                    { address: "0.0.0.0", family: "IPv4", internal: false },
                    { address: "192.168.1.50", family: "IPv4", internal: false },
                ],
            }),
        ).toBe("192.168.1.50");
    });

    it("returns loopback when only unspecified/loopback/IPv6 adapters exist", () => {
        expect(
            selectNetworkIp({
                Virtual: [{ address: "0.0.0.0", family: "IPv4", internal: false }],
                Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
                IPv6: [{ address: "fe80::1", family: "IPv6", internal: false }],
            }),
        ).toBe("127.0.0.1");
    });

    it("prefers a private address over a public one and tolerates numeric family", () => {
        expect(
            selectNetworkIp({
                Wan: [{ address: "8.8.8.8", family: 4, internal: false }],
                Lan: [{ address: "10.0.0.7", family: 4, internal: false }],
            }),
        ).toBe("10.0.0.7");
    });

    it("never yields an address no peer can dial", () => {
        const ip = getNetworkIp();
        expect(ip).not.toBe("");
        expect(ip).not.toBe("0.0.0.0");
    });
});

describe("display host", () => {
    it("treats every unspecified bind as needing an address", () => {
        expect(isUnspecifiedHost(undefined)).toBe(true);
        expect(isUnspecifiedHost("0.0.0.0")).toBe(true);
        expect(isUnspecifiedHost("::")).toBe(true);
        expect(isUnspecifiedHost("192.168.1.5")).toBe(false);
    });

    it("shows a concrete bind verbatim", () => {
        expect(getDisplayHost("192.168.1.5")).toBe("192.168.1.5");
        expect(getDisplayHost("10.0.0.2")).toBe("10.0.0.2");
    });

    it("resolves an unspecified bind to a dialable address", () => {
        for (const host of [undefined, "0.0.0.0", "::"]) {
            const shown = getDisplayHost(host);
            expect(shown).not.toBe("0.0.0.0");
            expect(shown).not.toBe("::");
            expect(shown.length).toBeGreaterThan(0);
        }
    });
});

describe("formatListenAddress", () => {
    it("prints a connectable URL instead of the 0.0.0.0 bind", () => {
        const url = formatListenAddress("0.0.0.0", 45464, false);
        expect(url).not.toContain("0.0.0.0");
        expect(url).toMatch(/^http:\/\/[^:]+:45464$/);
    });

    it("keeps a concrete host and scheme", () => {
        expect(formatListenAddress("10.0.0.5", 45464, true)).toBe(
            "https://10.0.0.5:45464",
        );
    });
});

describe("resolveRegistryUrl", () => {
    it("honors ORIGAMI_REGISTRY_URL outside production", () => {
        const url = resolveRegistryUrl({
            env: { NODE_ENV: "development", ORIGAMI_REGISTRY_URL: "http://dev-registry" },
            argv: [],
        });
        expect(url).toBe("http://dev-registry");
    });

    it("ignores the env override in a production daemon", () => {
        const url = resolveRegistryUrl({
            env: { NODE_ENV: "production", ORIGAMI_REGISTRY_URL: "http://evil.example" },
            argv: [],
        });
        expect(url).toBe("https://origami.ariapis.com");
    });

    it("honors the override in production only with the explicit flag", () => {
        const url = resolveRegistryUrl({
            env: { NODE_ENV: "production", ORIGAMI_REGISTRY_URL: "http://flagged.example" },
            argv: ["--allow-registry-override"],
        });
        expect(url).toBe("http://flagged.example");
    });

    it("falls back to the default when no override is set", () => {
        const url = resolveRegistryUrl({ env: {}, argv: [] });
        expect(url).toBe("https://origami.ariapis.com");
    });
});
