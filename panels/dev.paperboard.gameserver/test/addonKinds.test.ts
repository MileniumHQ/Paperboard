// The four add-on tabs' descriptors (lib/addons): the Modrinth query each
// one sends to a real HTTP server standing in for api.modrinth.com, what
// each makes of the service's answers, and which service action each
// install and removal calls.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { ACTION_IDS } from "../src/service/contract";

let software = "paper";
let version = "1.21.1";
let status = "offline";
const calls: { id: string; args: any }[] = [];
let answers: Record<string, unknown> = {};
mock.module("../src/lib/server", () => ({
    serverSoftware: () => software,
    serverVersion: () => version,
    serverStatus: () => status,
    updatePanelConfig: async () => {},
    serverBridge: {
        call: async (id: string, args: any) => {
            calls.push({ id, args });
            if (!(id in answers)) throw new Error(`unexpected service call ${id}`);
            return answers[id];
        },
    },
}));
let properties: Record<string, string> = {};
mock.module("../src/lib/properties", () => ({ readServerPropertiesStrict: async () => properties }));

const { pluginsKind } = await import("../src/lib/addons/plugins");
const { datapacksKind } = await import("../src/lib/addons/datapacks");
const { modpacksKind } = await import("../src/lib/addons/modpacks");
const { resourcePackKind } = await import("../src/lib/addons/resourcepack");
const { defaultVersion } = await import("../src/lib/addons/kind");

const requests: URL[] = [];
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        return Response.json({
            hits: [
                { project_id: "ok", slug: "ok", title: "Fits", description: "d", downloads: 3, server_side: "required" },
                { project_id: "client", slug: "client", title: "Client only", server_side: "unsupported" },
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
    calls.length = 0;
    answers = {};
    properties = {};
    software = "paper";
    version = "1.21.1";
    status = "offline";
});

const facets = () => JSON.parse(requests.at(-1)!.searchParams.get("facets")!) as string[][];
const signal = () => new AbortController().signal;

test("the plugin tab is Mods on a mod loader and Plugins elsewhere", () => {
    expect([pluginsKind.title, pluginsKind.noun, pluginsKind.searchPlaceholder]).toEqual(["Plugins", "plugin", "Search Plugins"]);
    software = "fabric";
    expect([pluginsKind.title, pluginsKind.noun, pluginsKind.searchPlaceholder]).toEqual(["Mods", "mod", "Search Mods"]);
});

test("each kind searches Modrinth for its own project type", async () => {
    await datapacksKind.search("", signal());
    expect(facets()).toEqual([["project_type:datapack"], ["versions:1.21.1"]]);
    expect(requests.at(-1)!.searchParams.get("index")).toBe("downloads");

    await resourcePackKind.search("faithful", signal());
    expect(facets()).toEqual([["project_type:resourcepack"], ["versions:1.21.1"]]);
    expect(requests.at(-1)!.searchParams.get("index")).toBe("relevance");

    software = "neoforge";
    const packs = await modpacksKind.search("", signal());
    expect(facets()).toEqual([["project_type:modpack"], ["categories:neoforge"], ["server_side:required", "server_side:optional"]]);
    // the facet lets a few client-only packs through
    expect(packs.map((p) => p.title)).toEqual(["Fits"]);
});

test("a kind that needs the Minecraft version refuses to search without one", async () => {
    version = "";
    await expect(datapacksKind.search("", signal())).rejects.toThrow("Choose a server version");
    await expect(resourcePackKind.search("", signal())).rejects.toThrow("Choose a server version");
    expect(requests).toEqual([]);
});

test("datapacks list as installed, folders and hand-added packs included", async () => {
    answers[ACTION_IDS.listDatapacks] = {
        world: "world",
        worldExists: true,
        truncated: true,
        packs: [
            { name: "vt.zip", kind: "zip", record: { projectId: "P1", slug: "vt", title: "Vanilla Tweaks", version: "1.5" } },
            { name: "mine", kind: "folder" },
        ],
    };
    const listing = await datapacksKind.list();
    expect(listing.items.map((i) => [i.id, i.title, i.badge.label, i.footer, i.project?.projectId])).toEqual([
        ["vt.zip", "Vanilla Tweaks", "Installed", "v1.5", "P1"],
        ["mine", "mine", "Folder", "Added by hand", undefined],
    ]);
    expect(listing.note).toBe("Showing the first 2 entries of the folder.");
    expect(listing.meta.world).toBe("world");
    expect(datapacksKind.remove.describe(listing.items[0]!, listing)).toContain("world/datapacks/");
});

test("the modpack tab lists the one pack and opens on the version for this Minecraft", async () => {
    answers[ACTION_IDS.readModpack] = {
        modpack: { projectId: "M1", versionId: "V1", slug: "pack", title: "Pack", versionNumber: "2.0", mcVersion: "1.21.1", loaderVersion: "21.1.1", files: ["a", "b"] },
    };
    software = "neoforge";
    const listing = await modpacksKind.list();
    expect(listing.items).toHaveLength(1);
    expect(listing.items[0]).toMatchObject({ title: "Pack", footer: "v2.0 · 2 files", subtitle: "Minecraft 1.21.1 · NeoForge 21.1.1" });

    answers[ACTION_IDS.listModpackVersions] = [
        { id: "new", versionNumber: "3", name: "", gameVersions: ["1.21.4"] },
        { id: "fits", versionNumber: "2", name: "", gameVersions: ["1.21.1"] },
    ];
    const versions = await modpacksKind.versions("M1");
    expect(defaultVersion(modpacksKind, versions)?.id).toBe("fits");
    version = "1.20.1";
    expect(defaultVersion(modpacksKind, versions)?.id).toBe("new");
});

test("a modpack is only installed or removed while the server is stopped", () => {
    expect(modpacksKind.install.disabled?.()).toBe(false);
    status = "online";
    expect(modpacksKind.install.disabled?.()).toBe(true);
    expect(modpacksKind.remove.disabled?.()).toBe(true);
    expect(modpacksKind.itemActions!.every((a) => a.disabled?.())).toBe(true);
});

test("the resource pack tab lists the pack in server.properties with the settings beside it", async () => {
    answers[ACTION_IDS.readResourcePack] = {
        url: "https://cdn.modrinth.com/p.zip",
        sha1: "abc",
        selection: { source: "modrinth", url: "https://cdn.modrinth.com/p.zip", sha1: "abc", projectId: "R1", slug: "faithful", title: "Faithful", version: "1.0" },
    };
    properties = { "require-resource-pack": "true", "resource-pack-id": "123e4567-e89b-12d3-a456-426614174000" };
    const listing = await resourcePackKind.list();
    expect(listing.items[0]).toMatchObject({ title: "Faithful", badge: { label: "Verified" }, footer: "v1.0", project: { projectId: "R1" } });
    expect(listing.meta.settings).toEqual({ require: true, prompt: "", id: "123e4567-e89b-12d3-a456-426614174000" });

    answers[ACTION_IDS.readResourcePack] = { url: "", sha1: "", selection: null };
    expect((await resourcePackKind.list()).items).toEqual([]);
});

test("installing and removing call the owner's action with what was chosen", async () => {
    const target = { projectId: "P1", slug: "vt", title: "Vanilla Tweaks", description: "" };
    answers[ACTION_IDS.installDatapack] = { name: "vt.zip", world: "world", version: "1" };
    await datapacksKind.install.run(target, "V9", undefined);
    answers[ACTION_IDS.removeDatapack] = {};
    await datapacksKind.remove.run({ id: "vt.zip" } as any);
    answers[ACTION_IDS.selectResourcePack] = {};
    await resourcePackKind.install.run(target, "V8", undefined);
    answers[ACTION_IDS.removeResourcePack] = {};
    await resourcePackKind.remove.run({ id: "resource-pack" } as any);
    answers[ACTION_IDS.installModpack] = {};
    await modpacksKind.install.run(target, "V7", undefined);
    answers[ACTION_IDS.deletePlugin] = {};
    await pluginsKind.remove.run({ id: "a.jar" } as any);
    expect(calls.map((c) => [c.id, c.args])).toEqual([
        [ACTION_IDS.installDatapack, { projectId: "P1", versionId: "V9" }],
        [ACTION_IDS.removeDatapack, { name: "vt.zip" }],
        [ACTION_IDS.selectResourcePack, { projectId: "P1", versionId: "V8" }],
        [ACTION_IDS.removeResourcePack, undefined],
        [ACTION_IDS.installModpack, { projectId: "P1", versionId: "V7" }],
        [ACTION_IDS.deletePlugin, { filename: "a.jar" }],
    ]);
});

test("plugins list from the service with the Modrinth record", async () => {
    answers[ACTION_IDS.listInstalledPlugins] = {
        plugins: [
            { filename: "Essentials.jar", record: { projectId: "E", slug: "essentialsx", version: "2.20", title: "EssentialsX" } },
            { filename: "hand.jar" },
        ],
        warning: "could not read one entry",
    };
    const listing = await pluginsKind.list();
    expect(listing.items.map((i) => [i.id, i.title, i.footer, i.project?.slug])).toEqual([
        ["Essentials.jar", "EssentialsX", "v2.20", "essentialsx"],
        ["hand.jar", "hand", "Unknown version", undefined],
    ]);
    expect(listing.warning).toEqual({ title: "Couldn't list plugins/", message: "could not read one entry" });
});
