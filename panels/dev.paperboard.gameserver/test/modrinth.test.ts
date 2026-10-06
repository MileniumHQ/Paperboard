import { afterAll, beforeEach, expect, mock, test } from "bun:test";

let software = "fabric";
let version = "1.21.1";
mock.module("../src/lib/server", () => ({
    serverSoftware: () => software,
    serverVersion: () => version,
    updatePanelConfig: async () => {},
    serverBridge: { call: async () => ({ plugins: [] }) },
}));
const { searchModrinth, getProject } = await import("../src/lib/plugins");
const requests: URL[] = [];
const hit = (id: string) => ({ project_id: id, slug: id, title: id, follows: 1234 });
const build = (environment = "server_only", loader = software, gameVersion = version) => ({
    environment, loaders: [loader], game_versions: [gameVersion],
    files: [{ filename: "mod.jar", url: "https://cdn.modrinth.com/mod.jar" }],
});
let respond = (_url: URL): unknown => ({});
const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        const body = await respond(url);
        return body instanceof Response ? body : Response.json(body);
    },
});
const realFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.modrinth.com") throw new Error(`Unexpected origin: ${url.origin}`);
    return realFetch(new URL(url.pathname + url.search, server.url), init);
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; server.stop(true); });
beforeEach(() => { requests.length = 0; software = "fabric"; version = "1.21.1"; });

test("detail uses project followers and ISO updated; search retains follows", async () => {
    respond = (url) => url.pathname.endsWith("/search")
        ? { hits: [hit("example")] }
        : url.pathname.endsWith("/version") ? [build()]
        : { id: "example", slug: "example", title: "Example", followers: 4321, updated: "2026-10-05T12:34:56Z" };
    expect((await searchModrinth(""))[0].follows).toBe(1234);
    const project = await getProject("example");
    expect(project.follows).toBe(4321);
    expect(project.dateModified).toBe("2026-10-05T12:34:56Z");
});

for (const loader of ["fabric"]) {
    test(`${loader} front page scopes server environments and requires an actual matching build`, async () => {
        software = loader;
        respond = (url) => {
            if (url.pathname.endsWith("/search")) return { hits: ["good", "client", "singleplayer", "old", "other-loader", "no-build"].map(hit) };
            if (url.pathname.includes("/good/")) return [build()];
            if (url.pathname.includes("/client/")) return [build("client_only")];
            if (url.pathname.includes("/singleplayer/")) return [build("singleplayer_only")];
            if (url.pathname.includes("/old/")) return [build("server_only", software, "1.20.1")];
            if (url.pathname.includes("/other-loader/")) return [build("server_only", "forge")];
            return [];
        };
        expect((await searchModrinth("")).map((hit) => hit.projectId)).toEqual(["good"]);
        const search = requests.find((url) => url.pathname.endsWith("/search"))!;
        expect(search.searchParams.get("query")).toBe("");
        expect(search.searchParams.get("index")).toBe("downloads");
        const facets = JSON.parse(search.searchParams.get("facets")!);
        expect(facets).toContainEqual([`categories:${loader}`]);
        expect(facets).toContainEqual(["versions:1.21.1"]);
        expect(facets.find((group: string[]) => group[0].startsWith("environment:"))).toContain("environment:server_only");
        expect(facets.flat()).not.toContain("environment:client_only");
        for (const request of requests.filter((url) => url.pathname.endsWith("/version"))) {
            expect(JSON.parse(request.searchParams.get("loaders")!)).toEqual([loader]);
            expect(JSON.parse(request.searchParams.get("game_versions")!)).toEqual([version]);
        }
    });
}

// Plugins intentionally browse across Minecraft versions; the previous Paper
// test incorrectly applied the mod compatibility requirement to them.
test("Paper plugins browse without a version facet or matching-build lookup", async () => {
    software = "paper";
    respond = (url) => url.pathname.endsWith("/search")
        ? { hits: [hit("older-plugin")] }
        : Response.json({ description: "Plugin browsing must not query versions" }, { status: 503 });
    for (const serverVersion of ["1.21.1", ""]) {
        version = serverVersion;
        requests.length = 0;
        expect((await searchModrinth("")).map((hit) => hit.projectId)).toEqual(["older-plugin"]);
        expect(requests).toHaveLength(1);
        const facets = JSON.parse(requests[0].searchParams.get("facets")!);
        expect(facets).toContainEqual(["categories:paper"]);
        expect(facets.flat().some((facet: string) => facet.startsWith("versions:"))).toBe(false);
    }
});

test("unknown server version cannot produce unfiltered results", async () => {
    version = "";
    await expect(searchModrinth("")).rejects.toThrow("Choose a server version");
    expect(requests).toHaveLength(0);
});

test("failed compatibility lookup remains a failed search", async () => {
    respond = (url) => url.pathname.endsWith("/search") ? { hits: [hit("example")] }
        : Response.json({ description: "Unavailable" }, { status: 503 });
    await expect(searchModrinth("example")).rejects.toThrow("Unavailable");
});


test("compatibility verification bounds the page and concurrent requests", async () => {
    let active = 0;
    let peak = 0;
    let builds = 0;
    respond = async (url) => {
        if (url.pathname.endsWith("/search")) return { hits: Array.from({ length: 30 }, (_, i) => hit(String(i))) };
        active++;
        peak = Math.max(peak, active);
        builds++;
        try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return [build()];
        } finally { active--; }
    };
    expect(await searchModrinth("")).toHaveLength(24);
    expect(builds).toBe(24);
    expect(peak).toBeLessThanOrEqual(4);
});

test("cancelled search cannot return results", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchModrinth("", controller.signal)).rejects.toThrow();
});
