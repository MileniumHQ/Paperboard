// The Resource Pack tab's Modrinth search: sent to a real HTTP server in
// place of api.modrinth.com, so the query shape that goes out is the one
// asserted. Also pins which tab owns the resource pack keys.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

let version = "1.21.1";
mock.module("../src/lib/server", () => ({
    serverSoftware: () => "paper",
    serverVersion: () => version,
    updatePanelConfig: async () => {},
    serverBridge: { call: async () => ({}) },
}));
const { searchResourcePacks } = await import("../src/lib/resourcepack");

const requests: URL[] = [];
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        return Response.json({
            hits: [
                { project_id: "faithful", slug: "faithful-32x", title: "Faithful 32x", description: "d", downloads: 9, icon_url: "https://cdn.modrinth.com/i.png" },
                { slug: "no-id", title: "Broken hit" },
            ],
        });
    },
});
const realFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.modrinth.com") throw new Error(`Unexpected origin: ${url.origin}`);
    return realFetch(new URL(url.pathname + url.search, server.url), init);
}) as typeof fetch;
afterAll(() => {
    globalThis.fetch = realFetch;
    server.stop(true);
});
beforeEach(() => {
    requests.length = 0;
    version = "1.21.1";
});

test("searches resourcepack projects for the server's Minecraft version", async () => {
    const hits = await searchResourcePacks("");
    expect(hits.map((hit) => hit.projectId)).toEqual(["faithful"]);
    const search = requests[0];
    expect(search.pathname).toBe("/v2/search");
    expect(JSON.parse(search.searchParams.get("facets")!)).toEqual([["project_type:resourcepack"], ["versions:1.21.1"]]);
    expect(search.searchParams.get("index")).toBe("downloads");

    await searchResourcePacks("faithful");
    expect(requests[1].searchParams.get("query")).toBe("faithful");
    expect(requests[1].searchParams.get("index")).toBe("relevance");
});

test("without a server version it refuses instead of searching every version", async () => {
    version = "";
    await expect(searchResourcePacks("")).rejects.toThrow("Choose a server version");
    expect(requests).toEqual([]);
});

test("only the Resource Pack tab owns the resource pack keys", () => {
    const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    expect(src("components/Advanced.tsx")).not.toContain("resource-pack");
    expect(src("components/ResourcePack.tsx")).toContain("require-resource-pack");
    expect(src("components/ResourcePack.tsx")).toContain("resource-pack-prompt");
    expect(src("components/ResourcePack.tsx")).toContain("resource-pack-id");
    expect(src("App.tsx")).toContain('value="resourcepack"');
});
