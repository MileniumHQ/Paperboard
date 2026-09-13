// gameserver plugin honesty (bun test): Modrinth hashes ride through to
// fileApi.download, and a version-filtered miss surfaces the explicit
// confirm state instead of a silent cross-version install.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { pickVersionFile } from "../src/core/plugins";

describe("pickVersionFile (pure)", () => {
    it("picks the primary file from the exact list with hashes intact", () => {
        const pick = pickVersionFile(
            [
                {
                    version_number: "2.0",
                    game_versions: ["1.21"],
                    files: [
                        {
                            url: "https://x/exact.jar",
                            filename: "exact.jar",
                            primary: true,
                            hashes: { sha1: "aaa", sha512: "bbb" },
                        },
                    ],
                },
            ],
            [
                {
                    version_number: "1.0",
                    game_versions: ["1.20.1"],
                    files: [{ url: "https://x/old.jar", filename: "old.jar" }],
                },
            ],
        );
        expect(pick.exactMatch).toBe(true);
        expect(pick.url).toBe("https://x/exact.jar");
        expect(pick.sha1).toBe("aaa");
        expect(pick.sha512).toBe("bbb");
        expect(pick.gameVersions).toEqual(["1.21"]);
    });

    it("falls back with exactMatch:false (confirm state data, not an install)", () => {
        const pick = pickVersionFile(
            [],
            [
                {
                    version_number: "1.0",
                    game_versions: ["1.20.1"],
                    files: [
                        {
                            url: "https://x/old.jar",
                            filename: "old.jar",
                            primary: true,
                            hashes: { sha1: "ccc", sha512: "ddd" },
                        },
                    ],
                },
            ],
        );
        expect(pick.exactMatch).toBe(false);
        expect(pick.url).toBe("https://x/old.jar");
        expect(pick.sha1).toBe("ccc");
        expect(pick.sha512).toBe("ddd");
        expect(pick.gameVersions).toEqual(["1.20.1"]);
    });

    it("throws when neither list has a downloadable file", () => {
        expect(() => pickVersionFile([], [])).toThrow();
        expect(() => pickVersionFile([{ version_number: "x", files: [] }], [])).toThrow();
    });
});

describe("installProject (mocked network + fileApi)", () => {
    const downloadCalls: any[] = [];
    let exactVersions: any[];
    let fallbackVersions: any[];

    mock.module("@paperboard-dev/paperapi", () => ({
        fileApi: {
            download: async (opts: any) => {
                downloadCalls.push(opts);
                return "/fake/plugins/x.jar";
            },
            exists: async () => false,
            delete: async () => true,
            read: async () => null,
            write: async () => "/fake/x",
        },
        files: {
            download: async (opts: any) => {
                downloadCalls.push(opts);
                return "/fake/plugins/x.jar";
            },
            exists: async () => false,
            read: async () => null,
        },
        config: {
            get: async () => ({}),
            set: async () => true,
        },
        processApi: {},
        system: { getInfo: async () => ({ os: "linux" }) },
        createPanelBridge: () => ({
            onStateChange: () => {},
            refreshState: async () => ({}),
            actions: {
                loadServerConfig: async () => ({}),
                updatePanelConfig: async () => ({}),
            },
            call: async () => ({}),
        }),
    }));

    const stubFetch = () => {
        (globalThis as any).fetch = async (url: string) => {
            const text = async () => {
                if (url.includes("/version")) {
                    return JSON.stringify(
                        url.includes("game_versions") ? exactVersions : fallbackVersions,
                    );
                }
                return JSON.stringify({
                    id: "proj1",
                    slug: "proj1",
                    title: "Proj",
                });
            };
            return { ok: true, status: 200, text };
        };
    };

    beforeEach(() => {
        downloadCalls.length = 0;
        stubFetch();
    });

    it("passes Modrinth sha1/sha512 through to fileApi.download on exact match", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        exactVersions = [
            {
                version_number: "2.0",
                game_versions: ["1.21"],
                files: [
                    {
                        url: "https://cdn/exact.jar",
                        filename: "exact.jar",
                        primary: true,
                        hashes: { sha1: "aaa111", sha512: "bbb222" },
                    },
                ],
            },
        ];
        fallbackVersions = [];

        const { installProject } = await import("../src/lib/plugins");
        const res = await installProject("proj1");
        expect(res.filename).toBe("exact.jar");
        expect(downloadCalls).toHaveLength(1);
        expect(downloadCalls[0].url).toBe("https://cdn/exact.jar");
        expect(downloadCalls[0].sha1).toBe("aaa111");
        expect(downloadCalls[0].checksum).toEqual({ algorithm: "sha512", value: "bbb222" });
    });

    it("fallback miss throws the explicit-confirm state and downloads nothing", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        exactVersions = [];
        fallbackVersions = [
            {
                version_number: "1.0",
                game_versions: ["1.20.1"],
                files: [
                    {
                        url: "https://cdn/old.jar",
                        filename: "old.jar",
                        primary: true,
                        hashes: { sha1: "ccc333", sha512: "ddd444" },
                    },
                ],
            },
        ];

        const { installProject, PluginVersionMismatchError } = await import("../src/lib/plugins");
        const err = await installProject("proj1").then(
            () => null,
            (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(PluginVersionMismatchError);
        expect((err as Error).message).toContain("1.20.1");
        expect(downloadCalls).toHaveLength(0);
    });

    it("allowIncompatible installs the fallback with checksums intact", async () => {
        const server = await import("../src/lib/server");
        server.setServerSoftware("paper");
        server.setServerVersion("1.21");
        exactVersions = [];
        fallbackVersions = [
            {
                version_number: "1.0",
                game_versions: ["1.20.1"],
                files: [
                    {
                        url: "https://cdn/old.jar",
                        filename: "old.jar",
                        primary: true,
                        hashes: { sha1: "ccc333", sha512: "ddd444" },
                    },
                ],
            },
        ];

        const { installProject } = await import("../src/lib/plugins");
        const res = await installProject("proj1", { allowIncompatible: true });
        expect(res.filename).toBe("old.jar");
        expect(downloadCalls).toHaveLength(1);
        expect(downloadCalls[0].sha1).toBe("ccc333");
        expect(downloadCalls[0].checksum).toEqual({ algorithm: "sha512", value: "ddd444" });
    });
});
