import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseModrinthVersion, assertModrinthId } from "../src/core/modrinth";
import { pickVersionFile, isPluginFilename } from "../src/core/plugins";
import { pickDatapackBuild } from "../src/core/datapacks";

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
});
