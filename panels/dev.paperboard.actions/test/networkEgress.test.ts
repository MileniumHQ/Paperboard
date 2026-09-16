// The runtime's fetch check follows the panel's manifest declaration; the
// daemon CSP remains the enforcement boundary, this is the honest refusal.
import { describe, expect, it } from "bun:test";
import {
    egressRefusal,
    parseNetworkEgress,
    PANEL_EGRESS,
} from "../src/lib/networkEgress";
import manifest from "../manifest.json";

describe("parseNetworkEgress", () => {
    it("reads the panel's own manifest", () => {
        expect(PANEL_EGRESS.mode).toBe("any-https");
        expect((manifest as any).network.mode).toBe("any-https");
    });

    it("treats a missing declaration as closed", () => {
        expect(parseNetworkEgress({}).mode).toBe("closed");
        expect(parseNetworkEgress(null).mode).toBe("closed");
    });

    it("normalizes declared hosts and refuses an empty list", () => {
        const egress = parseNetworkEgress({
            network: { mode: "hosts", hosts: ["API.Example.com.", "  ", 42] },
        });
        expect(egress).toEqual({ mode: "declared-hosts", hosts: ["api.example.com"] });
        expect(parseNetworkEgress({ network: { hosts: [] } }).mode).toBe("closed");
    });
});

describe("egressRefusal", () => {
    const anyHttps = { mode: "any-https", hosts: [] } as const;
    const declared = { mode: "declared-hosts", hosts: ["api.example.com"] } as const;
    const closed = { mode: "closed", hosts: [] } as const;

    it("any-https allows https anywhere and http only to loopback", () => {
        expect(egressRefusal("https://anything.dev/x", anyHttps)).toBeNull();
        expect(egressRefusal("http://localhost:8080/x", anyHttps)).toBeNull();
        expect(egressRefusal("http://127.0.0.1/x", anyHttps)).toBeNull();
        expect(egressRefusal("http://example.com/x", anyHttps)).toMatch(/loopback/);
    });

    it("declared hosts allow exact names and their subdomains", () => {
        expect(egressRefusal("https://api.example.com/v2", declared)).toBeNull();
        expect(egressRefusal("https://cdn.api.example.com/v2", declared)).toBeNull();
        expect(egressRefusal("https://example.com/v2", declared)).toMatch(/not in/);
        expect(egressRefusal("https://evilapi.example.com.attacker.dev/", declared)).toMatch(
            /not in/,
        );
    });

    it("closed refuses https entirely", () => {
        expect(egressRefusal("https://example.com", closed)).toMatch(/no network access/);
    });

    it("refuses other schemes and malformed urls", () => {
        expect(egressRefusal("ftp://example.com", anyHttps)).toMatch(/only https/);
        expect(egressRefusal("not a url", anyHttps)).toMatch(/malformed/);
    });
});
