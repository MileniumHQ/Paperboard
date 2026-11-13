import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { gameServer } from "./helpers/game";
import { readTree, tempDir, writeTree } from "./helpers/tmp";
import { linkFile, linkFolder } from "../src/games/serviceKit";
import { tf2Service } from "../src/games/tf2/service";
import { PlayerStore, formatBanlist, parseBanlist } from "../src/games/terraria/roster";
import { importUpload, inspectUpload, trashWorld, UPLOAD_DIR } from "../src/games/terraria/worldStore";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

/** a .wld whose header reads as `title`: Terraria's layout, every later field zero */
function terrariaWorld(title: string): Uint8Array {
    const bytes = new Uint8Array(8192);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, 279, true); // file version (1.4.4)
    view.setBigUint64(4, 0x6369676f6c6572n | (2n << 56n), true); // "relogic", world
    view.setInt16(24, 1, true); // one section
    view.setInt32(26, 64, true); // the header at 64
    let at = 64;
    for (const text of [title, "12345"]) {
        const utf8 = new TextEncoder().encode(text);
        bytes[at++] = utf8.length;
        bytes.set(utf8, at);
        at += utf8.length;
    }
    at += 8 + 16 + 4 + 16;
    view.setInt32(at, 1200, true); // height
    view.setInt32(at + 4, 4200, true); // width
    return bytes;
}

// Other games' user files and saves are kept.
describe("other games' files", () => {
    test("linking a game folder moves the saves already there first, and refuses when a file is on both sides", async () => {
        const root = tempDir();
        writeTree(root, { "install/Pal/Saved/SaveGames/0/W1/Level.sav": "world one", "install/Pal/Saved/Config/x.ini": "cfg", "saved/keep.txt": "mine" });
        const link = path.join(root, "install", "Pal", "Saved");
        const target = path.join(root, "saved");
        await linkFolder(link, target);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(readTree(target)).toEqual({ "Config/": "", "Config/x.ini": "cfg", "SaveGames/": "", "SaveGames/0/": "", "SaveGames/0/W1/": "", "SaveGames/0/W1/Level.sav": "world one", "keep.txt": "mine" });
        // a second link is a no-op
        await linkFolder(link, target);
        expect(fs.readFileSync(path.join(link, "SaveGames", "0", "W1", "Level.sav"), "utf8")).toBe("world one");

        const clash = tempDir();
        writeTree(clash, { "game/Saved/World.sav": "from the game", "saved/World.sav": "from a backup", "game/Saved/Other.sav": "other" });
        await expect(linkFolder(path.join(clash, "game", "Saved"), path.join(clash, "saved"))).rejects.toThrow("World.sav is in both Saved in the game's folder and saved; move one aside in Files");
        expect(readTree(clash)).toMatchObject({ "game/Saved/World.sav": "from the game", "saved/World.sav": "from a backup" });
        expect(fs.lstatSync(path.join(clash, "game", "Saved")).isDirectory()).toBe(true);
    });

    test("linking a game's file moves the one already there first, works before the game has made it, and refuses when it is on both sides", async () => {
        const root = tempDir();
        writeTree(root, { "install/garrysmod/sv.db": "players' data" });
        const link = path.join(root, "install", "garrysmod", "sv.db");
        const target = path.join(root, "sv.db");
        await linkFile(link, target);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe("players' data");
        // what the game writes through the link lands in the server folder; a second link is a no-op
        fs.writeFileSync(link, "more data");
        await linkFile(link, target);
        expect(fs.readFileSync(target, "utf8")).toBe("more data");

        // before the game's first run there is no file on either side: the game makes it through the link
        const fresh = tempDir();
        await linkFile(path.join(fresh, "install", "garrysmod", "sv.db"), path.join(fresh, "sv.db"));
        fs.writeFileSync(path.join(fresh, "install", "garrysmod", "sv.db"), "first run");
        expect(fs.readFileSync(path.join(fresh, "sv.db"), "utf8")).toBe("first run");

        const clash = tempDir();
        writeTree(clash, { "install/garrysmod/sv.db": "from the game", "sv.db": "from a backup" });
        await expect(linkFile(path.join(clash, "install", "garrysmod", "sv.db"), path.join(clash, "sv.db"))).rejects.toThrow("sv.db is in both the game's folder and the server folder; move one aside in Files");
        expect(readTree(clash)).toMatchObject({ "install/garrysmod/sv.db": "from the game", "sv.db": "from a backup" });
    });

    test("a TF2 rotation is written to Paperboard's own cycle file; the user's mapcycle.txt is never touched, and their server.cfg wins", async () => {
        const userCycle = "// my rotation\r\nctf_2fort\r\ncp_dustbowl\r\n";
        const server = gameServer("team-fortress-2", {
            files: {
                "install/tf/maps/ctf_2fort.bsp": "bsp",
                "install/tf/maps/pl_upward.bsp": "bsp",
                "install/tf/maps/cp_dustbowl.bsp": "bsp",
                "install/tf/cfg/mapcycle.txt": userCycle,
            },
            state: tf2Service.initialState(),
        });
        await server.run(() => tf2Service.initialize(server.scope.ctx, false));
        const calls = await tf2Service.calls();
        const call = (id: string, input: unknown) => server.run(() => calls[id]!(server.scope.ctx, input));
        const cfg = (name: string) => path.join(server.dir, "install", "tf", "cfg", name);

        expect(await call("team-fortress-2-map-cycle", {})).toMatchObject({ maps: ["ctf_2fort", "cp_dustbowl"], custom: false, file: "cfg/mapcycle.txt" });
        expect(await call("team-fortress-2-map-cycle-set", { maps: ["pl_upward", "ctf_2fort"] })).toMatchObject({ maps: ["pl_upward", "ctf_2fort"], custom: true, file: "cfg/paperboard_mapcycle.txt" });
        expect(fs.readFileSync(cfg("paperboard_mapcycle.txt"), "utf8").split("\n").filter((l) => !l.startsWith("//"))).toEqual(["pl_upward", "ctf_2fort", ""]);
        expect(fs.readFileSync(cfg("mapcycle.txt"), "utf8")).toBe(userCycle);

        // handing the rotation back removes only Paperboard's file
        await call("team-fortress-2-map-cycle-set", { maps: null });
        expect(fs.existsSync(cfg("paperboard_mapcycle.txt"))).toBe(false);
        expect(fs.readFileSync(cfg("mapcycle.txt"), "utf8")).toBe(userCycle);

        fs.writeFileSync(path.join(server.dir, "server.cfg"), 'hostname "mine"\nmapcyclefile "custom_cycle.txt"\n');
        await expect(call("team-fortress-2-map-cycle-set", { maps: ["pl_upward"] })).rejects.toThrow("server.cfg in the server folder sets mapcyclefile to custom_cycle.txt");
        expect(fs.existsSync(cfg("paperboard_mapcycle.txt"))).toBe(false);
        expect(fs.readFileSync(path.join(server.dir, "server.cfg"), "utf8")).toBe('hostname "mine"\nmapcyclefile "custom_cycle.txt"\n');
    });

    test("Terraria's banlist.txt round-trips, and an unban removes only that player's two lines", async () => {
        const text = "//Mallory\n203.0.113.7\n//Bob Smith\n198.51.100.2\n192.0.2.44\n//Eve\n2001:db8::1\n";
        expect(formatBanlist(parseBanlist(text))).toBe(text);
        expect(parseBanlist(text).map((b) => b.name)).toEqual(["Mallory", "Bob Smith", "", "Eve"]);
        const root = tempDir();
        fs.writeFileSync(path.join(root, "banlist.txt"), text);
        const store = new PlayerStore(root);
        await store.unban("bob smith");
        expect(fs.readFileSync(path.join(root, "banlist.txt"), "utf8")).toBe("//Mallory\n203.0.113.7\n192.0.2.44\n//Eve\n2001:db8::1\n");
        await expect(store.unban("Nobody")).rejects.toThrow("Nobody is not banned");
        expect(fs.readFileSync(path.join(root, "banlist.txt"), "utf8")).toBe("//Mallory\n203.0.113.7\n192.0.2.44\n//Eve\n2001:db8::1\n");
    });

    test("a Terraria ban made right after a player is seen waits for that sighting to be written", async () => {
        const store = new PlayerStore(tempDir());
        // the service records sightings without waiting, then lets a ban through
        void store.remember("Bob", "203.0.113.7:50000");
        void store.remember("Bob");
        await store.banOffline("bob");
        expect(await store.bans()).toEqual([{ name: "Bob", address: "203.0.113.7" }]);
    });

    test("deleting a Terraria world moves it, its .twld and their backups to the trash and leaves every other world", async () => {
        const root = tempDir();
        writeTree(root, {
            "worlds/Wörld.wld": "w",
            "worlds/Wörld.wld.bak": "b1",
            "worlds/Wörld.wld.bak2": "b2",
            "worlds/Wörld.twld": "t",
            "worlds/Wörld 2.wld": "other",
            "worlds/Wörld.wld.notes": "user's",
        });
        await trashWorld(root, "Wörld", 1_700_000_000_000);
        const tree = readTree(root);
        expect(Object.keys(tree).filter((f) => f.startsWith(".trash-") && !f.endsWith("/")).sort()).toEqual([
            ".trash-1700000000000/worlds/Wörld.twld",
            ".trash-1700000000000/worlds/Wörld.wld",
            ".trash-1700000000000/worlds/Wörld.wld.bak",
            ".trash-1700000000000/worlds/Wörld.wld.bak2",
        ]);
        expect([tree["worlds/Wörld 2.wld"], tree["worlds/Wörld.wld.notes"]]).toEqual(["other", "user's"]);
        await expect(trashWorld(root, "Wörld")).rejects.toThrow('There is no world named "Wörld"');
        await expect(trashWorld(root, "../worlds/Wörld 2")).rejects.toThrow("World name must be");
    });

    test("an uploaded Terraria world never replaces one already there, and a non-world is refused and removed", async () => {
        const root = tempDir();
        fs.mkdirSync(path.join(root, UPLOAD_DIR), { recursive: true });
        writeTree(root, { "worlds/Island.wld": "the user's island" });
        const upload = (name: string, bytes: Uint8Array) => {
            const file = `upload-${name.padStart(8, "0")}-0000-4000-8000-000000000000.wld`;
            fs.writeFileSync(path.join(root, UPLOAD_DIR, file), bytes);
            return file;
        };
        const island = upload("1", terrariaWorld("Island"));
        expect(await inspectUpload(root, island)).toMatchObject({ header: { name: "Island", width: 4200, height: 1200 }, suggestedName: "Island 2" });
        await expect(importUpload(root, island, "island")).rejects.toThrow('A world named "island" already exists');
        expect(fs.readFileSync(path.join(root, "worlds", "Island.wld"), "utf8")).toBe("the user's island");
        expect(fs.existsSync(path.join(root, UPLOAD_DIR, island))).toBe(false);

        const second = upload("2", terrariaWorld("Island"));
        await importUpload(root, second, "Island 2");
        expect(fs.readFileSync(path.join(root, "worlds", "Island 2.wld"))).toEqual(Buffer.from(terrariaWorld("Island")));

        const notWorld = upload("3", new TextEncoder().encode("PK\u0003\u0004 a zip"));
        await expect(inspectUpload(root, notWorld)).rejects.toThrow("This is not a Terraria world");
        expect(fs.readdirSync(path.join(root, UPLOAD_DIR))).toEqual([]);
        await expect(importUpload(root, "../worlds/Island.wld", "x")).rejects.toThrow("Choose a world to upload");
    });
});
