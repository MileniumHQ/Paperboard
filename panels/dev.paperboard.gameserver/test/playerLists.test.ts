// Player lists (bun test): the real service/playerLists.ts against a
// temporary server folder on disk; only the daemon's file API is replaced by
// direct reads and writes of that folder, and Mojang by a stub fetch.
// A stopped server takes op and whitelist from its files, so the panel must
// write them in the server's own format. The roster is keyed by uuid, so a
// renamed player shows their new name and is still found under it.
import { describe, it, expect, mock, afterAll, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gameserver-lists-"));
const inRoot = (path: string) => nodePath.join(root, ...path.split("/"));
const exists = (path: string) => fs.existsSync(inRoot(path));

const fileApiFake = {
    read: async (path: string) =>
        exists(path) ? fs.readFileSync(inRoot(path), "utf8") : null,
    write: async (path: string, content: string) => {
        fs.mkdirSync(nodePath.dirname(inRoot(path)), { recursive: true });
        fs.writeFileSync(inRoot(path), content);
        return inRoot(path);
    },
    exists: async (path: string) => exists(path),
    getPath: async (path: string) => inRoot(path),
};

mock.module("../src/service/api", () => ({
    config: { get: async () => null, set: async () => true },
    files: fileApiFake,
    fileApi: fileApiFake,
    system: { getInfo: async () => ({ os: "linux" }) },
    processApi: {},
}));

// Mojang: the accounts it knows, by name and by uuid
const accounts = [{ id: "069a79f444e94726a5befca90e38aaf5", name: "Notch" }];
let mojangCalls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    mojangCalls.push(url);
    const tail = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1)).toLowerCase();
    const account = accounts.find((a) => a.id === tail || a.name.toLowerCase() === tail);
    return account ? Response.json(account) : new Response(null, { status: 404 });
}) as typeof fetch;

const { setPlayerFlag, listRoster, currentPlayerNames, offlinePlayerUuid } = await import(
    "../src/service/playerLists"
);

const NOTCH = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
const STEVE = "0f3b2c1d-1111-4222-8333-444455556666";

const ctx = (serverStatus: string) => ({ state: { serverStatus } }) as any;
let commands: string[] = [];
const toConsole = async (command: string) => {
    commands.push(command);
};
const readJson = (path: string) => JSON.parse(fs.readFileSync(inRoot(path), "utf8"));
const write = (path: string, value: unknown) =>
    fs.writeFileSync(inRoot(path), typeof value === "string" ? value : JSON.stringify(value));

beforeEach(() => {
    for (const name of fs.readdirSync(root)) fs.rmSync(inRoot(name), { recursive: true, force: true });
    accounts[0].name = "Notch";
    mojangCalls = [];
    commands = [];
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("op and whitelist on a stopped server", () => {
    it("writes whitelist.json and ops.json in the server's format", async () => {
        write("server.properties", "op-permission-level=3\n");

        await setPlayerFlag(ctx("offline"), toConsole, null, "whitelist", "notch", true);
        await setPlayerFlag(ctx("offline"), toConsole, null, "op", "notch", true);

        // Mojang's casing and uuid, as `whitelist add` / `op` record them
        expect(readJson("whitelist.json")).toEqual([{ uuid: NOTCH, name: "Notch" }]);
        expect(readJson("ops.json")).toEqual([
            { uuid: NOTCH, name: "Notch", level: 3, bypassesPlayerLimit: false },
        ]);

        await setPlayerFlag(ctx("offline"), toConsole, null, "op", "Notch", false);
        expect(readJson("ops.json")).toEqual([]);
        expect(readJson("whitelist.json")).toHaveLength(1);
    });

    it("uses the uuid an offline-mode server derives from the name", async () => {
        write("server.properties", "online-mode=false\n");

        await setPlayerFlag(ctx("offline"), toConsole, null, "whitelist", "Steve", true);

        // java.util.UUID.nameUUIDFromBytes("OfflinePlayer:Steve")
        expect(offlinePlayerUuid("Steve")).toBe("5627dd98-e6be-3c21-b8a8-e92344183641");
        expect(readJson("whitelist.json")).toEqual([
            { uuid: "5627dd98-e6be-3c21-b8a8-e92344183641", name: "Steve" },
        ]);
        expect(mojangCalls).toEqual([]);
    });

    it("keeps a player the server already knows under their known uuid", async () => {
        write("usercache.json", [{ uuid: STEVE, name: "Steve", expiresOn: "2027-01-01 00:00:00 +0000" }]);

        await setPlayerFlag(ctx("offline"), toConsole, null, "whitelist", "steve", true);

        expect(readJson("whitelist.json")).toEqual([{ uuid: STEVE, name: "Steve" }]);
        expect(mojangCalls).toEqual([]);
    });

    it("fails loudly for a name no account has, and on a damaged list", async () => {
        await expect(setPlayerFlag(ctx("offline"), toConsole, null, "op", "Nobody_12345", true)).rejects.toThrow(
            'No Minecraft account is named "Nobody_12345"',
        );
        expect(exists("ops.json")).toBe(false);

        write("ops.json", "{broken");
        await expect(setPlayerFlag(ctx("offline"), toConsole, null, "op", "Notch", true)).rejects.toThrow(
            "ops.json is not valid JSON",
        );
        expect(fs.readFileSync(inRoot("ops.json"), "utf8")).toBe("{broken");

        await expect(setPlayerFlag(ctx("offline"), toConsole, null, "whitelist", "Notch", false)).rejects.toThrow(
            "Notch is not on the whitelist",
        );
    });

    it("waits while the server is stopping, when it could write over the edit", async () => {
        await expect(setPlayerFlag(ctx("stopping"), toConsole, null, "whitelist", "Notch", true)).rejects.toThrow(
            "Wait until the server has finished stopping",
        );
        expect(exists("whitelist.json")).toBe(false);
    });
});

describe("op and whitelist on a running server", () => {
    it("go through the toConsole, which rewrites the files itself", async () => {
        await setPlayerFlag(ctx("online"), toConsole, null, "op", "Notch", true);
        await setPlayerFlag(ctx("starting"), toConsole, null, "whitelist", "Notch", false);

        expect(commands).toEqual(["op Notch", "whitelist remove Notch"]);
        expect(exists("ops.json")).toBe(false);
    });
});

describe("renamed players", () => {
    it("shows the name from the newest join, not the one the lists were written with", async () => {
        write("whitelist.json", [{ uuid: STEVE, name: "OldSteve" }]);
        write("ops.json", [{ uuid: STEVE, name: "OldSteve", level: 4, bypassesPlayerLimit: false }]);
        write("usercache.json", [{ uuid: STEVE, name: "NewSteve", expiresOn: "2027-01-01 00:00:00 +0000" }]);

        expect(await listRoster()).toEqual([
            { uuid: STEVE, name: "NewSteve", whitelisted: true, op: true, banned: false },
        ]);

        // and is found under it: the lists match by uuid
        await setPlayerFlag(ctx("offline"), toConsole, null, "op", "NewSteve", false);
        expect(readJson("ops.json")).toEqual([]);
    });

    it("looks up the name a player has now from Mojang and keeps it for the roster", async () => {
        write("whitelist.json", [{ uuid: NOTCH, name: "Notch" }]);
        accounts[0].name = "Notch2";

        expect(await currentPlayerNames([NOTCH], null)).toEqual({ [NOTCH]: "Notch2" });
        expect((await listRoster())[0].name).toBe("Notch2");

        // a renamed player not known locally is matched by the uuid the roster passes
        await setPlayerFlag(ctx("offline"), toConsole, null, "whitelist", "Notch2", false, NOTCH);
        expect(readJson("whitelist.json")).toEqual([]);
    });

    it("asks nothing for an offline-mode server, whose uuids come from names", async () => {
        write("server.properties", "online-mode=false\n");

        expect(await currentPlayerNames([NOTCH], null)).toEqual({});
        expect(mojangCalls).toEqual([]);
    });
});
