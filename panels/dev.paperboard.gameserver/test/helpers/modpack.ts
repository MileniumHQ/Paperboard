// Real .mrpack archives and the modpack service's dependencies on the test
// daemon. Pack files are served by a loopback "CDN": the index names
// https://cdn.modrinth.com/... (the only kind of URL a pack may name), and
// the download dependency fetches that path from the loopback server
// through the daemon's real download (which checks the sha1).
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { files } from "../../src/service/api";
import { PANEL_ID } from "../../src/servers";
import type { ModpackDeps } from "../../src/service/modpacks";
import { loopbackServer, type LoopbackServer } from "./http";
import type { McServer } from "./minecraft";

export const sha1 = (data: string | Uint8Array) => createHash("sha1").update(data).digest("hex");
export const sha512 = (data: string | Uint8Array) => createHash("sha512").update(data).digest("hex");

/** a loopback CDN serving `path -> content` under /data/ */
export function packCdn(served: Record<string, string> = {}): LoopbackServer & { served: Record<string, string> } {
    const server = loopbackServer((_req, url) => {
        const content = served[decodeURIComponent(url.pathname.replace(/^\/data\//, ""))];
        return content === undefined ? new Response("not found", { status: 404 }) : new Response(content);
    });
    return Object.assign(server, { served });
}

/** an index entry for a file the CDN serves; the CDN learns it here */
export function packFile(cdn: { served: Record<string, string> }, path: string, content: string, extra: Record<string, unknown> = {}) {
    cdn.served[path] = content;
    return {
        path,
        hashes: { sha1: sha1(content), sha512: sha512(content) },
        downloads: [`https://cdn.modrinth.com/data/${encodeURIComponent(path)}`],
        fileSize: Buffer.byteLength(content),
        env: { client: "required", server: "required" },
        ...extra,
    };
}

export function packIndex(files: unknown[], dependencies: Record<string, string> = { minecraft: "1.21.1", neoforge: "21.1.256" }) {
    return { formatVersion: 1, game: "minecraft", versionId: "1.0.0", name: "Test Pack", dependencies, files };
}

/** a real .mrpack: the index plus override layers, and any raw extra entries */
export function mrpack(index: unknown, opts: { overrides?: Record<string, string | Uint8Array>; serverOverrides?: Record<string, string | Uint8Array>; raw?: Record<string, Uint8Array> } = {}): Uint8Array {
    const entries: Record<string, Uint8Array> = { "modrinth.index.json": strToU8(JSON.stringify(index)) };
    const add = (prefix: string, layer: Record<string, string | Uint8Array> = {}) => {
        for (const [path, content] of Object.entries(layer)) entries[`${prefix}${path}`] = typeof content === "string" ? strToU8(content) : content;
    };
    add("overrides/", opts.overrides);
    add("server-overrides/", opts.serverOverrides);
    Object.assign(entries, opts.raw ?? {});
    return zipSync(entries);
}

/** the modpack service's dependencies for a server on the test daemon */
export function packDeps(mc: McServer, cdn: LoopbackServer, overrides: Partial<ModpackDeps> = {}): ModpackDeps & { published: unknown[] } {
    const published: unknown[] = [];
    const deps: ModpackDeps & { published: unknown[] } = {
        published,
        serverDir: () => mc.run(() => files.getPath("", PANEL_ID)),
        levelName: async () => "world",
        fetchJson: async () => {
            throw new Error("this test reads no Modrinth records");
        },
        download: (opts) =>
            mc.run(() =>
                files.download({
                    url: opts.url.replace("https://cdn.modrinth.com", cdn.url),
                    targetPath: opts.targetPath,
                    sha1: opts.sha1,
                    appId: PANEL_ID,
                }),
            ),
        sha512: async (absolute) => sha512(nodeFs.readFileSync(absolute)),
        readConfig: async () => mc.scope.server.settings,
        writeConfig: async (patch) => {
            await mc.scope.saveSettings({ ...mc.scope.server.settings, ...patch });
        },
        installed: async () => ({ software: "neoforge", version: "1.21.1", build: "21.1.256" }),
        installSoftware: async () => {
            throw new Error("this test expects no loader switch");
        },
        publish: (progress) => published.push(progress),
        ...overrides,
    };
    return deps;
}
