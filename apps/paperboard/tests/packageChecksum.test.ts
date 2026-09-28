// Registry checksum resolution proofs (bun test): the daemon resolves
// ad-hoc package checksums from registry metadata so Setup-style callers
// without a plan still install verified bytes. A failed lookup refuses
// loudly — sha256: undefined must never reach the engine.
import { describe, it, expect } from "bun:test";
import {
    platformKeyFor,
    resolvePackageSha256,
    validSha256,
} from "../papercrane/packageChecksum";
import { PAPERBOARD_USER_AGENT } from "../papercrane/userAgent";

const SHA = "e58fcdcd637b25c03ca84cbbcefc70d11efb8f4b4cbd05decc9f661769d77f94";

function stubFetch(body: unknown, status = 200): any {
    return async () => ({
        ok: status >= 200 && status < 300,
        status,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    });
}

const META = {
    name: "java-25",
    version: "25.0.4+7",
    platforms: {
        "linux-x64": { url: "https://example.invalid/jdk.tar.gz", sha256: SHA },
        "windows-x64": { url: "https://example.invalid/jdk.zip", sha256: SHA },
    },
};

describe("platformKeyFor", () => {
    it("maps node platforms to registry keys", () => {
        expect(platformKeyFor("linux", "x64")).toBe("linux-x64");
        expect(platformKeyFor("linux", "arm64")).toBe("linux-arm64");
        expect(platformKeyFor("linux", "aarch64")).toBe("linux-arm64");
        expect(platformKeyFor("darwin", "arm64")).toBe("macos-arm64");
        expect(platformKeyFor("darwin", "x64")).toBe("macos-x64");
        expect(platformKeyFor("win32", "x64")).toBe("windows-x64");
    });

    it("returns null for unmapped platforms", () => {
        expect(platformKeyFor("freebsd", "x64")).toBeNull();
        expect(platformKeyFor("linux", "mips")).toBeNull();
    });
});

describe("validSha256", () => {
    it("accepts 64 hex only", () => {
        expect(validSha256(SHA)).toBe(true);
        expect(validSha256(SHA.toUpperCase())).toBe(true);
        expect(validSha256("abc")).toBe(false);
        expect(validSha256(undefined)).toBe(false);
        expect(validSha256("g".repeat(64))).toBe(false);
    });
});

describe("resolvePackageSha256", () => {
    it("returns the platform checksum from registry metadata", async () => {
        const sha = await resolvePackageSha256("java-25", {
            fetchFn: stubFetch(META),
            platform: "linux",
            arch: "x64",
        });
        expect(sha).toBe(SHA);
    });

    it("refuses when the platform entry has no checksum", async () => {
        await expect(
            resolvePackageSha256("java-25", {
                fetchFn: stubFetch({ platforms: { "linux-x64": { url: "https://example.invalid/x" } } }),
                platform: "linux",
                arch: "x64",
            }),
        ).rejects.toThrow(/did not provide a sha256/);
    });

    it("refuses when the registry has no metadata", async () => {
        await expect(
            resolvePackageSha256("nope", {
                fetchFn: stubFetch({}, 404),
                platform: "linux",
                arch: "x64",
            }),
        ).rejects.toThrow(/no metadata.*404/);
    });

    it("refuses when the registry is unreachable", async () => {
        await expect(
            resolvePackageSha256("java-25", {
                fetchFn: async () => {
                    throw new Error("socket hang up");
                },
                platform: "linux",
                arch: "x64",
            }),
        ).rejects.toThrow(/unreachable/);
    });

    it("identifies Paperboard on the registry request", async () => {
        let seen: string | null = null;
        const fetchFn: any = async (_url: string, init?: RequestInit) => {
            seen = new Headers(init?.headers).get("User-Agent");
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(META),
            };
        };
        await resolvePackageSha256("java-25", {
            fetchFn,
            platform: "linux",
            arch: "x64",
        });
        expect(seen).toBe(PAPERBOARD_USER_AGENT);
    });

    it("refuses invalid package names before any fetch", async () => {
        let fetched = false;
        const fetchFn: any = async () => {
            fetched = true;
            return { ok: true, status: 200, text: async () => "{}" };
        };
        await expect(
            resolvePackageSha256("", { fetchFn, platform: "linux", arch: "x64" }),
        ).rejects.toThrow(/invalid package name/);
        expect(fetched).toBe(false);
    });
});
