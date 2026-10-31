import { describe, expect, it } from "bun:test";
import { buildLatestSourcemodRecords, buildSourcemodRecord, SOURCEMOD_BUILDS } from "../scripts/update-sourcemod";
import { assertValidRecord } from "../scripts/lib/records";

// The pins are reviewed upstream facts: a record carries only bytes that hash
// to them, for the x64 hosts AlliedModders builds a 64-bit server for.
describe("update-sourcemod", () => {
    const observed = () => Object.fromEntries(SOURCEMOD_BUILDS.flatMap((build) => Object.values(build.files).map((file) => [file!.url, { sha256: file!.sha256, size: 10 }])));
    it("builds Metamod:Source and SourceMod for Linux and Windows x64", () => {
        const [metamod, sourcemod] = SOURCEMOD_BUILDS.map((build) => buildSourcemodRecord(build, observed()));
        for (const record of [metamod!, sourcemod!]) assertValidRecord(record);
        expect([metamod!.name, metamod!.version, sourcemod!.name, sourcemod!.version]).toEqual(["metamod-source", "1.12.0-git1228", "sourcemod", "1.12.0-git7259"]);
        expect(Object.keys(sourcemod!.platforms)).toEqual(["linux-x64", "windows-x64"]);
        expect(metamod!.platforms["linux-x64"]?.url).toBe("https://mms.alliedmods.net/mmsdrop/1.12/mmsource-1.12.0-git1228-linux.tar.gz");
        expect(metamod!.platforms["windows-x64"]?.recipe).toEqual({ unpack: "zip", take: { "bin/addons": "addons" } });
        expect(sourcemod!.platforms["linux-x64"]?.recipe).toEqual({ unpack: "tar", take: { "bin/addons": "addons", "bin/cfg": "cfg" } });
    });
    it("refuses changed or missing downloads", () => {
        const build = SOURCEMOD_BUILDS[1]!;
        const url = build.files["linux-x64"]!.url;
        expect(() => buildSourcemodRecord(build, { ...observed(), [url]: { sha256: "0".repeat(64), size: 10 } })).toThrow(/reviewed pin/);
        expect(() => buildSourcemodRecord(build, {})).toThrow(/download missing/);
    });
    it("hashes fetched bytes and refuses HTTP errors", async () => {
        await expect(buildLatestSourcemodRecords((async () => new Response("changed")) as unknown as typeof fetch)).rejects.toThrow(/reviewed pin/);
        await expect(buildLatestSourcemodRecords((async () => new Response("missing", { status: 404 })) as unknown as typeof fetch)).rejects.toThrow(/404/);
    });
});
