import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loopbackServer, routeHost } from "./helpers/http";
import { tempDir } from "./helpers/tmp";
import { parseModrinthVersion, assertModrinthId, MODRINTH_API } from "../src/core/modrinth";
import { pickVersionFile, isPluginFilename } from "../src/core/plugins";
import { pickDatapackBuild } from "../src/core/datapacks";
import { installDatapack, type DatapackDeps } from "../src/service/datapacks";
import { setServerSoftware, setServerVersion } from "../src/lib/server";
import { installProject, PluginVersionMismatchError } from "../src/lib/plugins";
import { installPlugin, type PluginInstallDeps } from "../src/service/plugins";
import type { InstalledRecord } from "../src/core/plugins";

/** the plugin install against a loopback Modrinth; downloads are recorded, not made */
function pluginDeps(versions: unknown[], options: { present?: string[]; records?: () => Record<string, InstalledRecord> } = {}) {
    const modrinth = loopbackServer((_req, url) => {
        if (url.pathname === "/v2/project/essentialsx") return Response.json({ id: "PROJ1234", slug: "essentialsx", title: "EssentialsX", icon_url: "https://cdn.modrinth.com/i.png", project_type: "plugin" });
        if (url.pathname === "/v2/project/PROJ1234/version") return Response.json(versions);
        return new Response("not found", { status: 404 });
    });
    const downloads: Record<string, unknown>[] = [];
    let records: Record<string, InstalledRecord> = { "Other.jar": { projectId: "OTHER123", slug: "other", version: "1" } };
    const deps: PluginInstallDeps = {
        fetchJson: async <T>(url: string) => (await (await fetch(url.replace(MODRINTH_API, `${modrinth.url}/v2`))).json()) as T,
        download: async (opts) => void downloads.push(opts),
        exists: async (path) => (options.present ?? []).includes(path),
        readRecords: async () => (options.records ?? (() => records))(),
        writeRecords: async (next) => void (records = next),
    };
    return { deps, downloads, records: () => records, modrinth };
}

const hash = (algorithm: string, data: string) => createHash(algorithm).update(data).digest("hex");
const file = (name: string, content: string, extra: Record<string, unknown> = {}) => ({
    url: `https://cdn.modrinth.com/data/x/${name}`,
    filename: name,
    primary: true,
    size: content.length,
    hashes: { sha1: hash("sha1", content), sha512: hash("sha512", content) },
    ...extra,
});
const version = (id: string, gameVersions: string[], files: unknown[], loaders = ["datapack"]) => ({
    id,
    project_id: "PROJ1234",
    version_number: id,
    name: id,
    loaders,
    game_versions: gameVersions,
    files,
});

/** the datapack service against a loopback Modrinth; downloads are recorded, not made */
function datapackDeps(versions: unknown[]) {
    const modrinth = loopbackServer((_req, url) => {
        if (url.pathname === "/v2/project/PROJ1234/version") return Response.json(versions);
        if (url.pathname === "/v2/project/PROJ1234") return Response.json({ id: "PROJ1234", slug: "terralith", title: "Terralith", project_type: "datapack" });
        return new Response("not found", { status: 404 });
    });
    const downloads: Record<string, unknown>[] = [];
    const root = tempDir();
    let config: Record<string, unknown> = {};
    const deps: DatapackDeps = {
        serverDir: async () => root,
        levelName: async () => "world",
        fetchJson: async <T>(url: string) => (await (await fetch(url.replace(MODRINTH_API, `${modrinth.url}/v2`))).json()) as T,
        download: async (opts) => {
            downloads.push(opts);
        },
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
        trash: async () => undefined,
    };
    return { deps, downloads };
}

// Modrinth downloads are checksummed, version-honest and contained.
describe("Modrinth downloads", () => {
    test("a file without both hashes or served over http is dropped; no hash at all is no download", () => {
        const parsed = parseModrinthVersion(
            version("v1", ["1.21.1"], [
                file("a.zip", "a", { hashes: { sha1: hash("sha1", "a") } }),
                file("b.zip", "b", { url: "http://cdn.modrinth.com/data/x/b.zip", primary: false }),
                file("c.zip", "c", { primary: false }),
            ]),
        );
        expect(parsed?.files.map((f) => f.filename)).toEqual(["c.zip"]);
        // the primary was unverifiable, so there is no primary to install
        expect(parsed?.primary).toBeNull();
        expect(() => pickVersionFile([{ files: [{ url: "https://x/a.jar", filename: "a.jar" }] }], [])).toThrow("No checksummed file");
    });

    test("a build for another Minecraft version is not picked, a non-exact plugin build is flagged, and unsafe names or ids are refused", () => {
        const builds = [version("v120", ["1.20.1"], [file("pack.zip", "p")]), version("v121", ["1.21.1"], [file("pack.zip", "p")])].map((v) => parseModrinthVersion(v)!);
        expect(pickDatapackBuild(builds, "1.21.1").version.id).toBe("v121");
        expect(() => pickDatapackBuild(builds.slice(0, 1), "1.21.1")).toThrow("no build for Minecraft 1.21.1");
        expect(() => pickDatapackBuild(builds, "1.21.1", "v120")).toThrow("no build for Minecraft 1.21.1");
        const fallback = pickVersionFile([], [{ version_number: "2.0", game_versions: ["1.20.1"], files: [file("x.jar", "x")] }]);
        expect(fallback.exactMatch).toBe(false);

        const slip = parseModrinthVersion(version("v1", ["1.21.1"], [file("..", "x", { filename: "../../evil.zip" })]))!;
        expect(() => pickDatapackBuild([slip], "1.21.1")).toThrow("Not a datapack name");
        for (const name of ["../x.jar", "a/b.jar", "x.zip", ".hidden.jar", "x.jar/"]) expect([name, isPluginFilename(name)]).toEqual([name, false]);
        for (const id of ["../x", "a/b", "", "a b", "x?y=1"]) expect(() => assertModrinthId(id, "Project")).toThrow("is not a Modrinth id");
    });

    test("a datapack install downloads the exact version's file with both of its hashes", async () => {
        const { deps, downloads } = datapackDeps([version("v121", ["1.21.1"], [file("terralith.zip", "pack")])]);
        await installDatapack({ projectId: "PROJ1234" }, "1.21.1", deps);
        expect(downloads).toHaveLength(1);
        expect(downloads[0]).toMatchObject({
            url: "https://cdn.modrinth.com/data/x/terralith.zip",
            targetPath: "world/datapacks/terralith.zip",
            sha1: hash("sha1", "pack"),
        });
        // the sha512 Modrinth publishes reaches the daemon too, in whichever field carries it
        expect(JSON.stringify(downloads[0])).toContain(hash("sha512", "pack"));
    });

    test("a datapack with no build for this version, or a page-supplied id that is not Modrinth's, downloads nothing", async () => {
        const { deps, downloads } = datapackDeps([version("v120", ["1.20.1"], [file("terralith.zip", "pack")])]);
        await expect(installDatapack({ projectId: "PROJ1234" }, "1.21.1", deps)).rejects.toThrow("no build for Minecraft 1.21.1");
        await expect(installDatapack({ projectId: "../../etc" }, "1.21.1", deps)).rejects.toThrow("is not a Modrinth id");
        await expect(installDatapack({ projectId: "PROJ1234", versionId: "v1/../x" }, "1.21.1", deps)).rejects.toThrow("is not a Modrinth id");
        expect(downloads).toEqual([]);
    });

    test("a plugin install from Blocks takes the exact build by its slug, checks both hashes, and keeps the other records", async () => {
        const { deps, downloads, records } = pluginDeps([
            version("v121", ["1.21.1"], [file("EssentialsX-2.21.jar", "e")], ["paper"]),
            version("v120", ["1.20.1"], [file("EssentialsX-2.20.jar", "old")], ["paper"]),
        ]);
        expect(await installPlugin("essentialsx", "paper", "1.21.1", deps)).toEqual({ file: "EssentialsX-2.21.jar", name: "EssentialsX", version: "v121" });
        expect(downloads).toEqual([{ url: "https://cdn.modrinth.com/data/x/EssentialsX-2.21.jar", targetPath: "plugins/EssentialsX-2.21.jar", sha1: hash("sha1", "e"), sha512: hash("sha512", "e") }]);
        expect(records()).toEqual({
            "Other.jar": { projectId: "OTHER123", slug: "other", version: "1" },
            "EssentialsX-2.21.jar": { projectId: "PROJ1234", slug: "essentialsx", version: "v121", title: "EssentialsX", iconUrl: "https://cdn.modrinth.com/i.png" },
        });
    });

    test("a plugin install from Blocks refuses another version's build, an installed file, an unreadable record list and a bad id, and downloads nothing", async () => {
        const other = pluginDeps([version("v120", ["1.20.1"], [file("EssentialsX-2.20.jar", "old")], ["paper"])]);
        await expect(installPlugin("essentialsx", "paper", "1.21.1", other.deps)).rejects.toThrow("EssentialsX has no build for Minecraft 1.21.1 on Paper");
        const builds = [version("v121", ["1.21.1"], [file("EssentialsX-2.21.jar", "e")], ["paper"])];
        const present = pluginDeps(builds, { present: ["plugins/EssentialsX-2.21.jar"] });
        await expect(installPlugin("essentialsx", "paper", "1.21.1", present.deps)).rejects.toThrow("EssentialsX-2.21.jar is already installed");
        const unreadable = pluginDeps(builds, { records: () => { throw new Error("config unreadable"); } });
        await expect(installPlugin("essentialsx", "paper", "1.21.1", unreadable.deps)).rejects.toThrow("config unreadable");
        const bad = pluginDeps(builds);
        await expect(installPlugin("../../etc", "paper", "1.21.1", bad.deps)).rejects.toThrow("is not a Modrinth id");
        await expect(installPlugin("essentialsx", "vanilla", "1.21.1", bad.deps)).rejects.toThrow("has no plugin or mod system");
        expect([...other.downloads, ...present.downloads, ...unreadable.downloads, ...bad.downloads]).toEqual([]);
    });

    test("a plugin whose newest build is for another Minecraft version is not installed unless allowed", async () => {
        const modrinth = loopbackServer((_req, url) => {
            if (url.pathname === "/v2/project/PROJ1234/version") {
                // nothing for 1.21.1; the loader's newest build is for 1.20.1
                return Response.json(url.searchParams.has("game_versions") ? [] : [version("v2", ["1.20.1"], [file("Essentials.jar", "e")], ["paper"])]);
            }
            return new Response("not found", { status: 404 });
        });
        routeHost("api.modrinth.com", modrinth);
        setServerSoftware("paper");
        setServerVersion("1.21.1");
        const err = await installProject("PROJ1234").catch((e: unknown) => e);
        expect(err).toBeInstanceOf(PluginVersionMismatchError);
        expect((err as Error).message).toBe("Latest build targets Minecraft 1.20.1 but the server runs 1.21.1 — install anyway?");
        // only the two version lookups ran: no project record, no download
        expect(modrinth.requests.every((r) => r.startsWith("/v2/project/PROJ1234/version"))).toBe(true);
    });
});
