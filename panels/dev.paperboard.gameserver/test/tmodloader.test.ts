import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { compareVersions, ModStore, pickBuild, readTmod, TMODLOADER_APP_ID } from "../src/games/terraria/modStore";
import { parseDownloads, type Runner } from "../src/games/steam/steamcmd";
import { searchWorkshop, workshopItems } from "../src/games/steam/modscan";
import { terraria } from "../src/games/terraria";
import { assertGameAction } from "../src/games";
import { installedMods, workshopHits } from "../src/lib/addons/workshop";

// tModLoader's mods across their real edges: .tmod files as tModLoader writes
// them, SteamCMD as a process printing what SteamCMD prints, and modscan as
// an HTTP server answering what modscan answers.

/** .NET BinaryWriter string: 7-bit encoded length, then UTF-8 */
function str(text: string): Uint8Array {
    const bytes = new TextEncoder().encode(text);
    const length: number[] = [];
    let n = bytes.length;
    do { length.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0)); n >>= 7; } while (n > 0);
    return new Uint8Array([...length, ...bytes]);
}
const int32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); return b; };
const join = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

/** A .tmod with an Info (BuildProperties) and one other file; like tModLoader, a file is stored deflated only when that is smaller. */
function tmod(name: string, options: { version?: string; builtFor?: string; displayName?: string; references?: string[] } = {}): Uint8Array {
    const info = join([
        str("modReferences"), ...(options.references ?? []).map(r => str(r)), str(""),
        str("author"), str("Someone"),
        str("displayName"), str(options.displayName ?? name),
        str("side"), new Uint8Array([0]),
        str(""),
    ]);
    const deflated = new Uint8Array(deflateRawSync(info));
    const packed = deflated.length < info.length ? deflated : info;
    const other = new TextEncoder().encode("assembly bytes");
    const body = join([
        str(name), str(options.version ?? "1.0"), int32(2),
        str("Info"), int32(info.length), int32(packed.length),
        str(`${name}.dll`), int32(other.length), int32(other.length),
        packed, other,
    ]);
    return join([new TextEncoder().encode("TMOD"), str(options.builtFor ?? "2026.8.3.0"), new Uint8Array(276), int32(body.length), body]);
}

let scratch: string;
beforeAll(async () => { scratch = await fs.mkdtemp(path.join(os.tmpdir(), "tml-test-")); });
afterAll(async () => { await fs.rm(scratch, { recursive: true, force: true }); });
const dir = async (name: string) => { const d = path.join(scratch, name); await fs.mkdir(d, { recursive: true }); return d; };

describe(".tmod files", () => {
    test("reads the name, version, build and required mods", async () => {
        const file = path.join(await dir("read"), "Calamity.tmod");
        await fs.writeFile(file, tmod("CalamityMod", { version: "2.0.4", displayName: "Calamity Mod", references: ["CalamityModMusic@1.0", "Luminance"] }));
        expect(await readTmod(file)).toEqual({ name: "CalamityMod", version: "2.0.4", builtFor: "2026.8.3.0", displayName: "Calamity Mod", references: ["CalamityModMusic", "Luminance"] });
    });

    test("refuses files that are not mods, naming why", async () => {
        const d = await dir("bad");
        await fs.writeFile(path.join(d, "a.tmod"), "PK\x03\x04 a zip");
        await expect(readTmod(path.join(d, "a.tmod"))).rejects.toThrow("does not start with TMOD");
        const good = tmod("Cut");
        await fs.writeFile(path.join(d, "b.tmod"), good.subarray(0, good.length - 3));
        await expect(readTmod(path.join(d, "b.tmod"))).rejects.toThrow("size does not match");
    });

    test("picks the newest Workshop build this tModLoader loads", async () => {
        const item = await dir("item");
        for (const v of ["2025.11", "2026.3", "2026.9"]) { await fs.mkdir(path.join(item, v)); await fs.writeFile(path.join(item, v, "M.tmod"), v); }
        expect(await pickBuild(item, "2026.08.3.0")).toBe(path.join(item, "2026.3", "M.tmod"));
        expect(compareVersions("2026.08.3.0", "2026.8.3")).toBe(0);
        await expect(pickBuild(item, "2025.01.1.0")).rejects.toThrow("no build for tModLoader 2025.01.1.0");
    });
});

test("SteamCMD's download lines are read through its colour codes", () => {
    const lines = ["\x1b[0mSuccess. Downloaded item 11 to \"/w/steamapps/workshop/content/1281930/11\" (12 bytes)", "ERROR! Download item 12 failed (Access Denied).", "Success. Downloaded item 99 to \"/x\""];
    const result = parseDownloads(lines, ["11", "12"]);
    expect(result.get("11")).toEqual({ ok: true, path: "/w/steamapps/workshop/content/1281930/11" });
    expect(result.get("12")).toEqual({ ok: false, reason: "Access Denied" });
    expect(result.has("99")).toBe(false);
});

const META = { attribution: "Powered by Steam", source: "https://store.steampowered.com/", legal: "©Valve", disclaimer: "Not endorsed." };
const ITEM = (id: string, title: string, children: string[] | null = null) => ({
    id, title, description: `${title} adds things.`, previewImageUrl: `https://images.steamusercontent.com/ugc/${id}/`, tags: ["Content"], authorId: "7",
    subscriptions: 1200, favorites: 30, timeUpdated: 1_790_000_000, fileSize: 4096, children, workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
});

describe("modscan and SteamCMD", () => {
    let server: ReturnType<typeof Bun.serve>;
    let base: string;
    const catalog = new Map([
        ["101", { ...ITEM("101", "Big Mod", ["102"]), description: "https://i.imgur.com/W2c5CX6.gif Big Mod! It adds things. https://i.imgur.c" }], ["102", ITEM("102", "Big Library")], ["103", ITEM("103", "Lonely Mod")],
        // an addon whose library has a library of its own
        ["104", ITEM("104", "Storage Addon", ["105"])], ["105", ITEM("105", "Storage", ["106"])], ["106", ITEM("106", "Common Lib")],
    ]);
    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            fetch(request) {
                const url = new URL(request.url);
                if (url.pathname === "/tmodloader/search") {
                    if (url.searchParams.get("q") === "fail") return Response.json({ error: { code: "upstream", message: "Steam is down" } }, { status: 502 });
                    return Response.json({ items: [...catalog.values()].filter(i => i.title.toLowerCase().includes(url.searchParams.get("q")!)), total: 3, meta: META });
                }
                if (url.pathname === "/tmodloader/items") {
                    const ids = url.searchParams.get("ids")!.split(",");
                    return Response.json({ items: ids.flatMap(id => (catalog.has(id) ? [catalog.get(id)!] : [])), total: null, meta: META });
                }
                return new Response("not found", { status: 404 });
            },
        });
        base = `http://127.0.0.1:${server.port}`;
    });
    afterAll(() => server.stop(true));

    test("search answers are checked and shaped into result cards", async () => {
        const page = await searchWorkshop("tmodloader", "big", { base });
        expect(page.meta).toEqual(META);
        const hits = workshopHits(page.items);
        expect(hits.map(h => [h.projectId, h.stat, h.dependencies])).toEqual([["101", "1.2k subscribers", ["102"]], ["102", "1.2k subscribers", undefined]]);
        // the banner and link addresses authors open with stay off the card
        expect(hits.map(h => h.description)).toEqual(["Big Mod! It adds things.", "Big Library adds things."]);
        await expect(searchWorkshop("tmodloader", "fail", { base })).rejects.toThrow("Steam Workshop search failed: Steam is down");
        await expect(workshopItems("tmodloader", ["../etc"], { base })).rejects.toThrow("Not a Workshop item id");
    });

    /**
     * A SteamCMD stand-in: a real script, run as a process, that lays out each
     * requested item the way SteamCMD does and prints SteamCMD's lines.
     */
    async function steamWorkspace(builds: Record<string, Uint8Array>) {
        const ws = await dir(`steam-${Math.random().toString(36).slice(2)}`);
        const source = await dir(`builds-${Math.random().toString(36).slice(2)}`);
        for (const [id, bytes] of Object.entries(builds)) { await fs.mkdir(path.join(source, id, "2026.3"), { recursive: true }); await fs.writeFile(path.join(source, id, "2026.3", `${id}.tmod`), bytes); }
        await fs.mkdir(path.join(ws, "steamcmd"));
        const script = path.join(ws, "steamcmd", "steamcmd.sh");
        await fs.writeFile(script, `#!/bin/sh
dir=""; app=""
while [ $# -gt 0 ]; do
  case "$1" in
    +force_install_dir) dir="$2"; shift 2;;
    +workshop_download_item) app="$2"; id="$3"; shift 3
      if [ -d "${source}/$id" ]; then
        mkdir -p "$dir/steamapps/workshop/content/$app"; cp -r "${source}/$id" "$dir/steamapps/workshop/content/$app/$id"
        printf '\\033[0mSuccess. Downloaded item %s to "%s" (1 bytes)\\n' "$id" "$dir/steamapps/workshop/content/$app/$id"
      else echo "ERROR! Download item $id failed (File Not Found)."; fi;;
    *) shift;;
  esac
done
`);
        await fs.chmod(script, 0o755);
        return ws;
    }
    const runner: Runner = async (run) => {
        const child = Bun.spawn([run.command, ...run.args], { cwd: run.cwd, env: { ...process.env, ...run.env }, stdout: "pipe", stderr: "pipe" });
        const lines = (await new Response(child.stdout).text()).split("\n").filter(Boolean);
        for (const line of lines) run.onLine?.(line);
        return { exitCode: await child.exited, tail: lines.slice(-20) };
    };

    test("installs a mod with what it requires, all or nothing, and uninstalls in order", async () => {
        const root = await dir("server-a");
        const steam = await steamWorkspace({ "101": tmod("BigMod", { references: ["BigLib"] }), "102": tmod("BigLib", { displayName: "Big Library" }), "103": tmod("Lonely", { references: ["Missing"] }) });
        const store = new ModStore({ root, tmodloaderVersion: "2026.08.3.0", runner, steamWorkspace: steam, modscanBase: base });

        expect(await store.install("101")).toEqual(["Big Mod", "Big Library"]);
        const mods = await store.list();
        expect(mods.map(m => [m.file, m.enabled, m.record?.workshopId])).toEqual([["BigLib.tmod", true, "102"], ["BigMod.tmod", true, "101"]]);
        expect(JSON.parse(await fs.readFile(path.join(root, "tModLoader/Mods/enabled.json"), "utf8")).sort()).toEqual(["BigLib", "BigMod"]);
        // SteamCMD's copies are gone once the files are in Mods
        expect(await fs.readdir(path.join(steam, "workshop/steamapps/workshop/content", String(TMODLOADER_APP_ID)))).toEqual([]);

        const cards = installedMods(mods);
        expect(cards.map(c => [c.title, c.badge.label, c.footer, c.project?.projectId])).toEqual([["Big Library", "Installed", "v1.0", "102"], ["Big Mod", "Installed", "v1.0", "101"]]);

        await expect(store.install("103")).rejects.toThrow("Lonely Mod needs Missing");
        await expect(store.remove("BigLib.tmod")).rejects.toThrow("Big Mod needs Big Library. Uninstall it first.");
        await store.remove("BigMod.tmod");
        await store.remove("BigLib.tmod");
        expect(await store.list()).toEqual([]);
        expect(JSON.parse(await fs.readFile(path.join(root, "tModLoader/Mods/enabled.json"), "utf8"))).toEqual([]);
        // each removal has its own trash folder
        const trashed = [];
        for (const trash of (await fs.readdir(root)).filter(n => n.startsWith(".trash"))) trashed.push(...(await fs.readdir(path.join(root, trash, "tModLoader/Mods"))));
        expect(trashed.sort()).toEqual(["BigLib.tmod", "BigMod.tmod"]);
    });

    test("follows what a required mod requires in turn", async () => {
        const root = await dir("server-chain");
        const steam = await steamWorkspace({ "104": tmod("StorageAddon", { references: ["Storage"] }), "105": tmod("Storage", { references: ["CommonLib"] }), "106": tmod("CommonLib") });
        const store = new ModStore({ root, tmodloaderVersion: "2026.08.3.0", runner, steamWorkspace: steam, modscanBase: base });
        // the search card names only the direct requirement, as Steam's does
        expect(await store.install("104", ["105"])).toEqual(["Storage Addon", "Storage", "Common Lib"]);
        expect((await store.list()).map(m => m.info?.name)).toEqual(["CommonLib", "Storage", "StorageAddon"]);
    });

    test("a mod file needing what its Workshop page does not list stops the whole install", async () => {
        const root = await dir("server-unlisted");
        const store = new ModStore({ root, tmodloaderVersion: "2026.08.3.0", runner, steamWorkspace: await steamWorkspace({ "103": tmod("Lonely", { references: ["Missing"] }) }), modscanBase: base });
        await expect(store.install("103")).rejects.toThrow("Lonely Mod needs Missing, which isn't installed");
        expect(await store.list()).toEqual([]);
    });

    test("a download SteamCMD refuses fails loudly, naming the item", async () => {
        const store = new ModStore({ root: await dir("server-b"), tmodloaderVersion: "2026.08.3.0", runner, steamWorkspace: await steamWorkspace({}), modscanBase: base });
        await expect(store.install("103")).rejects.toThrow("103: File Not Found");
    });

    test("uploads take only checked .tmod files built for this tModLoader", async () => {
        const root = await dir("server-c");
        const store = new ModStore({ root, tmodloaderVersion: "2026.08.3.0" });
        const stage = await dir("stage-1");
        await fs.writeFile(path.join(stage, "Future.tmod"), tmod("Future", { builtFor: "2027.1.1.0" }));
        await fs.writeFile(path.join(stage, "notes.txt"), "hi");
        await expect(store.upload(stage)).rejects.toThrow(/Future\.tmod: Future\.tmod was built for tModLoader 2027\.1\.1\.0.*notes\.txt: is not a \.tmod file/);
        await expect(fs.stat(stage)).rejects.toThrow();

        const again = await dir("stage-2");
        await fs.writeFile(path.join(again, "anything.tmod"), tmod("Hand", { displayName: "Handmade" }));
        expect(await store.upload(again)).toEqual(["Handmade"]);
        const [mod] = installedMods(await store.list());
        expect([mod!.id, mod!.badge.label, mod!.uploaded, mod!.project]).toEqual(["Hand.tmod", "Uploaded", true, undefined]);
    });
});

test("only a tModLoader server has the Mods tab, its actions and the .NET runtime", () => {
    const vanilla = terraria.describe({ software: "vanilla", version: "1.4.5.8" });
    const modded = terraria.describe({ software: "tmodloader", version: "2026.08.3.0" });
    expect(vanilla.tabs.some(t => t.id === "mods")).toBe(false);
    expect(modded.tabs.find(t => t.id === "mods")).toMatchObject({ label: "Mods", group: "Software", owner: "game" });
    expect(modded.packages).toEqual([{ id: "dotnet-8", purpose: ".NET runtime for tModLoader" }]);
    expect(() => assertGameAction(terraria, { software: "vanilla", version: "1.4.5.8" }, "terraria-mod-install")).toThrow("does not support");
    expect(() => assertGameAction(terraria, { software: "tmodloader", version: "2026.08.3.0" }, "terraria-mod-install")).not.toThrow();
    expect(terraria.softwareLabel!({ software: "tmodloader", version: "2026.08.3.0" })).toBe("tModLoader 2026.08.3.0");
});
