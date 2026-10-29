// The Resource Pack tab's service against a real server.properties on disk
// and a real HTTP server for a pasted URL: what lands in server.properties
// is a URL and hash Modrinth published, or the sha1 of bytes this service
// downloaded itself. Modrinth answers are recorded shapes.
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
    RESOURCEPACK_MAX_BYTES,
    RESOURCEPACK_SELECTION_KEY,
    assertResourcePackUrl,
    assertSha1,
    isResourcePackId,
    parseResourcePackSelection,
    pickResourcePackBuild,
    promptFromProperty,
    promptToProperty,
    resourcePackProperties,
    selectionFor,
} from "../src/core/resourcepack";
import { parseProperties, stringifyServerProperties } from "../src/core/properties";
import { parseModrinthVersion, type RawModrinthVersion } from "../src/core/modrinth";
import {
    listResourcePackVersions,
    readResourcePack,
    removeResourcePack,
    selectCustomResourcePack,
    selectModrinthResourcePack,
    type ResourcePackDeps,
} from "../src/service/resourcepack";

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const SHA1 = "a".repeat(40);
const SHA512 = "b".repeat(128);

function version(id: string, game: string[], file: Partial<{ url: string; filename: string; sha512: string | null }> = {}): RawModrinthVersion {
    return {
        id,
        project_id: "faithful",
        version_number: `v-${id}`,
        loaders: ["minecraft"],
        game_versions: game,
        files: [
            {
                url: file.url ?? `https://cdn.modrinth.com/data/faithful/versions/${id}/pack.zip`,
                filename: file.filename ?? `Faithful_${id}.zip`,
                primary: true,
                hashes: { sha1: SHA1, ...(file.sha512 === null ? {} : { sha512: file.sha512 ?? SHA512 }) },
            },
        ],
    };
}

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("pack bytes")]);
let respond: (url: URL) => Response = () => new Response(ZIP);
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => respond(new URL(request.url)) });
afterAll(() => server.stop(true));

function harness(opts: { versions?: RawModrinthVersion[]; projectType?: string; properties?: string } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-resourcepack-"));
    dirs.push(root);
    const file = path.join(root, "server.properties");
    if (opts.properties !== undefined) fs.writeFileSync(file, opts.properties);
    let config: Record<string, unknown> = {};
    const urls: string[] = [];
    const deps: ResourcePackDeps = {
        fetchJson: async <T,>(url: string) => {
            urls.push(url);
            if (url.includes("/version?")) return (opts.versions ?? []) as T;
            return {
                id: "faithful",
                slug: "faithful-32x",
                title: "Faithful 32x",
                icon_url: "https://cdn.modrinth.com/icon.png",
                project_type: opts.projectType ?? "resourcepack",
            } as T;
        },
        fetchPack: (url) => fetch(url),
        readProperties: async () => (fs.existsSync(file) ? parseProperties(fs.readFileSync(file, "utf8")) : {}),
        writeProperties: async (values) => {
            const current = fs.existsSync(file) ? parseProperties(fs.readFileSync(file, "utf8")) : {};
            fs.writeFileSync(file, stringifyServerProperties({ ...current, ...values }));
        },
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
    };
    return { deps, urls, file, config: () => config, text: () => fs.readFileSync(file, "utf8") };
}

describe("pack urls, hashes and the prompt", () => {
    test("a url is one http(s) line", () => {
        expect(assertResourcePackUrl("  https://example.com/a.zip ")).toBe("https://example.com/a.zip");
        expect(assertResourcePackUrl("http://example.com/a.zip")).toBe("http://example.com/a.zip");
        for (const bad of ["", "ftp://example.com/a.zip", "file:///etc/passwd", "not a url", "https://x.test/a\nonline-mode=false", 5]) {
            expect(() => assertResourcePackUrl(bad)).toThrow();
        }
    });

    test("a sha1 is forty hex digits, lowercased", () => {
        expect(assertSha1("A".repeat(40))).toBe(SHA1);
        expect(() => assertSha1("abc")).toThrow("not a sha1");
    });

    test("a pack id is a UUID or empty", () => {
        expect(isResourcePackId("")).toBe(true);
        expect(isResourcePackId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
        expect(isResourcePackId("my-pack")).toBe(false);
    });

    test("plain prompt text is stored as a JSON string and read back plain", () => {
        expect(promptToProperty("Welcome, §6friend")).toBe('"Welcome, §6friend"');
        expect(promptFromProperty('"Welcome, §6friend"')).toBe("Welcome, §6friend");
        expect(promptToProperty("")).toBe("");
        // a component the owner wrote stays exactly as written
        expect(promptToProperty('{"text":"Hi","color":"gold"}')).toBe('{"text":"Hi","color":"gold"}');
        expect(promptFromProperty('{"text":"Hi"}')).toBe('{"text":"Hi"}');
        expect(() => promptToProperty('{"text":')).toThrow("not valid JSON");
    });

    test("a record only describes the pack whose url server.properties still holds", () => {
        const saved = parseResourcePackSelection({ source: "custom", url: "https://x.test/a.zip", sha1: SHA1 });
        expect(selectionFor(saved, { "resource-pack": "https://x.test/a.zip" })).toEqual(saved);
        expect(selectionFor(saved, { "resource-pack": "https://x.test/b.zip" })).toBeNull();
        expect(parseResourcePackSelection({ url: 4 })).toBeNull();
        expect(parseResourcePackSelection(null)).toBeNull();
    });

    test("removing writes both keys blank", () => {
        expect(resourcePackProperties(null)).toEqual({ "resource-pack": "", "resource-pack-sha1": "" });
    });
});

describe("choosing a build", () => {
    const parsed = (raw: RawModrinthVersion[]) => raw.map(parseModrinthVersion).filter((v) => v !== null);

    test("only a build for the exact Minecraft version is picked, newest first", () => {
        const versions = parsed([version("new", ["1.21.4"]), version("old", ["1.21.1"])]);
        expect(pickResourcePackBuild(versions, "1.21.1").version.id).toBe("old");
        expect(() => pickResourcePackBuild(versions, "1.20.1")).toThrow("no build for Minecraft 1.20.1");
        expect(() => pickResourcePackBuild(versions, "1.21.1", "new")).toThrow("no build for Minecraft 1.21.1");
        expect(() => pickResourcePackBuild(versions, "1.21.1", "gone")).toThrow("not available");
    });

    test("a file without both hashes, over plain http, or not a zip is never picked", () => {
        expect(() => pickResourcePackBuild(parsed([version("a", ["1.21.1"], { sha512: null })]), "1.21.1")).toThrow();
        expect(() =>
            pickResourcePackBuild(parsed([version("a", ["1.21.1"], { url: "http://cdn.modrinth.com/x.zip" })]), "1.21.1"),
        ).toThrow();
        expect(() => pickResourcePackBuild(parsed([version("a", ["1.21.1"], { filename: "pack.mrpack" })]), "1.21.1")).toThrow();
    });
});

describe("a Modrinth pack", () => {
    test("writes the primary file's url and sha1 and remembers the project", async () => {
        const h = harness({
            versions: [version("abc12345", ["1.21.1"])],
            properties: "motd=A server\nonline-mode=true\n",
        });
        await selectModrinthResourcePack({ projectId: "faithful", versionId: "abc12345" }, "1.21.1", h.deps);

        const props = parseProperties(h.text());
        expect(props["resource-pack"]).toBe("https://cdn.modrinth.com/data/faithful/versions/abc12345/pack.zip");
        expect(props["resource-pack-sha1"]).toBe(SHA1);
        // the other keys are left alone
        expect(props.motd).toBe("A server");
        expect(props["online-mode"]).toBe("true");

        const view = await readResourcePack(h.deps);
        expect(view.selection).toMatchObject({
            source: "modrinth",
            projectId: "faithful",
            title: "Faithful 32x",
            version: "v-abc12345",
            iconUrl: "https://cdn.modrinth.com/icon.png",
        });
        expect(h.config()[RESOURCEPACK_SELECTION_KEY]).toEqual(view.selection);
    });

    test("asks Modrinth for this Minecraft version only, with no loader filter", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])] });
        await listResourcePackVersions("faithful", "1.21.1", h.deps);
        const url = new URL(h.urls[0]);
        expect(url.pathname).toBe("/v2/project/faithful/version");
        expect(JSON.parse(url.searchParams.get("game_versions")!)).toEqual(["1.21.1"]);
        expect(url.searchParams.has("loaders")).toBe(false);
        await expect(listResourcePackVersions("faithful", "", h.deps)).rejects.toThrow("Choose a server version");
    });

    test("a project that is not a resource pack writes nothing", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])], projectType: "mod", properties: "motd=A\n" });
        await expect(selectModrinthResourcePack({ projectId: "faithful" }, "1.21.1", h.deps)).rejects.toThrow("not a resource pack");
        expect(h.text()).toBe("motd=A\n");
        expect(h.config()).toEqual({});
    });

    test("ids from the page are checked before anything is fetched", async () => {
        const h = harness();
        await expect(selectModrinthResourcePack({ projectId: "../../x" }, "1.21.1", h.deps)).rejects.toThrow("not a Modrinth id");
        expect(h.urls).toEqual([]);
    });
});

describe("a pasted url", () => {
    test("is downloaded and its sha1 written with it", async () => {
        const h = harness();
        respond = () => new Response(ZIP);
        const url = `${server.url}pack.zip`;
        await selectCustomResourcePack({ url }, h.deps);
        const props = parseProperties(h.text());
        expect(props["resource-pack"]).toBe(url);
        expect(props["resource-pack-sha1"]).toBe(createHash("sha1").update(ZIP).digest("hex"));
        expect((await readResourcePack(h.deps)).selection).toMatchObject({ source: "custom", url });
    });

    test("an HTML page, an error status or a declared oversize pack writes nothing", async () => {
        const h = harness({ properties: "motd=A\n" });
        const url = `${server.url}pack.zip`;
        respond = () => new Response("<html>Sign in</html>");
        await expect(selectCustomResourcePack({ url }, h.deps)).rejects.toThrow("did not return a zip");
        respond = () => new Response("gone", { status: 404 });
        await expect(selectCustomResourcePack({ url }, h.deps)).rejects.toThrow("HTTP 404");
        // the server claims more than the game accepts, then stalls: refused from the header alone
        const liar = net.createServer((socket) => {
            socket.on("error", () => {});
            socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${RESOURCEPACK_MAX_BYTES + 1}\r\n\r\n`);
        });
        await new Promise<void>((resolve) => liar.listen(0, "127.0.0.1", resolve));
        try {
            const { port } = liar.address() as net.AddressInfo;
            await expect(selectCustomResourcePack({ url: `http://127.0.0.1:${port}/pack.zip` }, h.deps)).rejects.toThrow(
                "servers accept at most",
            );
        } finally {
            liar.closeAllConnections?.();
            liar.close();
        }
        await expect(selectCustomResourcePack({ url: "javascript:alert(1)" }, h.deps)).rejects.toThrow("http or https");
        expect(h.text()).toBe("motd=A\n");
        expect(h.config()).toEqual({});
    });

    test("an unreachable url fails with the network error, not a blank pack", async () => {
        const h = harness();
        await expect(selectCustomResourcePack({ url: "http://127.0.0.1:1/pack.zip" }, h.deps)).rejects.toThrow();
        expect(h.config()).toEqual({});
    });
});

describe("removing", () => {
    test("clears the url and sha1 and the record, and leaves the rest", async () => {
        const h = harness({ versions: [version("abc12345", ["1.21.1"])], properties: "require-resource-pack=true\n" });
        await selectModrinthResourcePack({ projectId: "faithful" }, "1.21.1", h.deps);
        await removeResourcePack(h.deps);
        const props = parseProperties(h.text());
        expect(props["resource-pack"]).toBe("");
        expect(props["resource-pack-sha1"]).toBe("");
        expect(props["require-resource-pack"]).toBe("true");
        expect(await readResourcePack(h.deps)).toEqual({ url: "", sha1: "", selection: null });
    });

    test("a pack set by hand reads as a url with no record", async () => {
        const h = harness({ properties: "resource-pack=https\\://x.test/a.zip\nresource-pack-sha1=\n" });
        expect(await readResourcePack(h.deps)).toEqual({ url: "https://x.test/a.zip", sha1: "", selection: null });
    });
});
