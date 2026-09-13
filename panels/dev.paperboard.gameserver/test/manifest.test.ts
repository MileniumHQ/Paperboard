// manifest honesty (bun test): every host the install path fetches must be
// declared in network.hosts — the vanilla jar URL that lib/software.ts
// extracts from Mojang's version JSON lands on piston-data.mojang.com, and
// an undeclared host is an enforced-permission install that fails.
import { describe, it, expect } from "bun:test";
import manifest from "../manifest.json";

// every host the panel's code paths reach: version manifests, jar
// downloads, modrinth, paper/fabric metas, avatars
const REQUIRED_HOSTS = [
    "piston-meta.mojang.com",
    "piston-data.mojang.com",
    "fill.papermc.io",
    "fill-data.papermc.io",
    "meta.fabricmc.net",
    "api.modrinth.com",
    "cdn.modrinth.com",
    "mc-heads.net",
];

describe("manifest network.hosts", () => {
    it("declares every host the panel's fetch paths use", () => {
        const hosts: string[] = manifest.network.hosts;
        for (const required of REQUIRED_HOSTS) {
            expect(hosts).toContain(required);
        }
    });

    it("declares no duplicate or malformed hosts", () => {
        const hosts: string[] = manifest.network.hosts;
        expect(new Set(hosts).size).toBe(hosts.length);
        for (const host of hosts) {
            expect(host).toMatch(/^[a-z0-9.-]+$/);
        }
    });
});
