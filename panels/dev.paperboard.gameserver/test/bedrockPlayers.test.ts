// Bedrock players on a crossplay server (bun test): the real
// service/playerLists.ts and service/crossplay.ts against a temporary server
// folder holding a real Floodgate jar and the config.yml Floodgate wrote
// (test/fixtures/crossplay), with a local HTTP server answering for
// GeyserMC's global API and Mojang the way the real ones do (checked with
// curl: xuid/<gamertag> → {"xuid": n}, 503 for one it has not seen). Only the
// daemon's file API is replaced by direct reads and writes of that folder.
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { strToU8, zipSync } from "fflate";

const FIXTURES = nodePath.join(import.meta.dir, "fixtures", "crossplay");
const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gameserver-bedrock-"));
const inRoot = (path: string) => nodePath.join(root, ...path.split("/"));
const exists = (path: string) => fs.existsSync(inRoot(path));

const fileApiFake = {
    read: async (path: string) => (exists(path) ? fs.readFileSync(inRoot(path), "utf8") : null),
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

// Xbox accounts GeyserMC has on record, and the Java accounts Mojang has
const xbox = new Map<string, string>([
    ["Tim203", "2535432196048835"],
    ["Steve Bob", "2533274887883703"],
]);
const requests: string[] = [];
const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
        const url = new URL(request.url);
        requests.push(`${url.pathname}`);
        const tail = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
        if (url.pathname.startsWith("/geysermc/v2/xbox/xuid/")) {
            const xuid = xbox.get(tail);
            return xuid
                ? Response.json({ xuid: Number(xuid) })
                : Response.json({ message: "Unable to find user in our cache. Please try specifying their Floodgate UUID instead" }, { status: 503 });
        }
        if (url.pathname.startsWith("/geysermc/v2/xbox/gamertag/")) {
            const gamertag = [...xbox].find(([, xuid]) => xuid === tail)?.[0];
            return gamertag ? Response.json({ gamertag }) : Response.json({ message: "Unable to find user in our cache" }, { status: 503 });
        }
        return new Response(null, { status: 404 });
    },
});
const realFetch = globalThis.fetch;
const ORIGINS: Record<string, string> = {
    "https://api.geysermc.org": "/geysermc",
    "https://api.mojang.com": "/mojang",
    "https://sessionserver.mojang.com": "/session",
};
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const base = ORIGINS[url.origin];
    if (base === undefined) throw new Error(`Unexpected origin: ${url.origin}`);
    return realFetch(new URL(base + url.pathname + url.search, upstream.url), init);
}) as typeof fetch;

afterAll(() => {
    globalThis.fetch = realFetch;
    upstream.stop(true);
    fs.rmSync(root, { recursive: true, force: true });
});

const { setPlayerFlag, currentPlayerNames } = await import("../src/service/playerLists");
const { readBedrockNaming } = await import("../src/service/crossplay");

// Floodgate's uuid for Tim203: new UUID(0, 2535432196048835)
const TIM = "00000000-0000-0000-0009-01f64f65c7c3";

const deps = { serverDir: async () => root };
const ctx = (serverStatus: string) => ({ state: { serverStatus } }) as any;
let commands: string[] = [];
const toConsole = async (command: string) => {
    commands.push(command);
};
const readJson = (path: string) => JSON.parse(fs.readFileSync(inRoot(path), "utf8"));
const write = (path: string, value: unknown) => {
    fs.mkdirSync(nodePath.dirname(inRoot(path)), { recursive: true });
    fs.writeFileSync(inRoot(path), typeof value === "string" ? value : JSON.stringify(value));
};

// a Paper server with crossplay on: Floodgate's jar names itself "floodgate"
function installFloodgate() {
    fs.cpSync(nodePath.join(FIXTURES, "paper"), root, { recursive: true });
    write("plugins/floodgate-spigot.jar", "");
    fs.writeFileSync(inRoot("plugins/floodgate-spigot.jar"), zipSync({ "plugin.yml": strToU8("name: floodgate\nversion: 2.2.5\nmain: x\n") }));
}

function setFloodgate(key: string, value: string) {
    const path = "plugins/floodgate/config.yml";
    const text = fs.readFileSync(inRoot(path), "utf8").replace(new RegExp(`^${key}: .*$`, "m"), `${key}: ${value}`);
    fs.writeFileSync(inRoot(path), text);
}

beforeEach(() => {
    for (const name of fs.readdirSync(root)) fs.rmSync(inRoot(name), { recursive: true, force: true });
    requests.length = 0;
    commands = [];
});

describe("Floodgate's naming", () => {
    it("is read from Floodgate's own config.yml, and is null without Floodgate", async () => {
        expect(await readBedrockNaming("paper", deps)).toBeNull();
        expect(await readBedrockNaming("vanilla", deps)).toBeNull();

        installFloodgate();
        expect(await readBedrockNaming("paper", deps)).toEqual({ prefix: ".", replaceSpaces: true });

        setFloodgate("username-prefix", '"BE_"');
        setFloodgate("replace-spaces", "false");
        expect(await readBedrockNaming("paper", deps)).toEqual({ prefix: "BE_", replaceSpaces: false });
    });
});

describe("a Bedrock player on a stopped server", () => {
    it("is whitelisted and opped in the files under the uuid Floodgate derives from the XUID", async () => {
        installFloodgate();
        write("server.properties", "op-permission-level=3\n");
        const naming = await readBedrockNaming("paper", deps);

        await setPlayerFlag(ctx("offline"), toConsole, naming, "whitelist", ".Tim203", true);
        await setPlayerFlag(ctx("offline"), toConsole, naming, "op", ".Tim203", true);

        expect(readJson("whitelist.json")).toEqual([{ uuid: TIM, name: ".Tim203" }]);
        expect(readJson("ops.json")).toEqual([{ uuid: TIM, name: ".Tim203", level: 3, bypassesPlayerLimit: false }]);
        // GeyserMC was asked, never Mojang, and nothing went to a console
        expect(requests.every((path) => path.startsWith("/geysermc/v2/xbox/xuid/"))).toBe(true);
        expect(commands).toEqual([]);

        await setPlayerFlag(ctx("offline"), toConsole, naming, "whitelist", ".Tim203", false);
        expect(readJson("whitelist.json")).toEqual([]);
    });

    it("fails loudly for a gamertag GeyserMC has no account for", async () => {
        installFloodgate();
        const naming = await readBedrockNaming("paper", deps);
        await expect(setPlayerFlag(ctx("offline"), toConsole, naming, "whitelist", ".NoSuchTag", true)).rejects.toThrow(
            'GeyserMC has no Xbox account named "NoSuchTag" on record',
        );
        expect(exists("whitelist.json")).toBe(false);
    });

    it("is refused with a reason when Floodgate is not installed", async () => {
        await expect(setPlayerFlag(ctx("offline"), toConsole, null, "whitelist", ".Tim203", true)).rejects.toThrow(
            '".Tim203" is not a Java player name',
        );
        expect(exists("whitelist.json")).toBe(false);
        expect(requests).toEqual([]);
    });
});

describe("a Bedrock player on a running server", () => {
    it("is whitelisted through Floodgate's fwhitelist, not the vanilla whitelist", async () => {
        installFloodgate();
        const naming = await readBedrockNaming("paper", deps);

        await setPlayerFlag(ctx("online"), toConsole, naming, "whitelist", ".Tim203", true);
        await setPlayerFlag(ctx("online"), toConsole, naming, "whitelist", ".Tim203", false, TIM);
        await setPlayerFlag(ctx("online"), toConsole, naming, "whitelist", ".Tim203", false);

        expect(commands).toEqual(["fwhitelist add Tim203", `fwhitelist remove ${TIM}`, "fwhitelist remove Tim203"]);
        // a Java player still uses the server's own whitelist
        await setPlayerFlag(ctx("online"), toConsole, naming, "whitelist", "Notch", true);
        expect(commands.at(-1)).toBe("whitelist add Notch");
    });

    it("gets their gamertag's spaces back, quoted, when Floodgate replaces spaces", async () => {
        installFloodgate();
        setFloodgate("username-prefix", '"BE_"');
        const naming = await readBedrockNaming("paper", deps);

        await setPlayerFlag(ctx("online"), toConsole, naming, "whitelist", "BE_Steve_Bob", true);
        expect(commands).toEqual(['fwhitelist add "Steve Bob"']);
    });

    it("is not sent to the console when GeyserMC does not know the gamertag", async () => {
        installFloodgate();
        const naming = await readBedrockNaming("paper", deps);
        await expect(setPlayerFlag(ctx("online"), toConsole, naming, "whitelist", ".NoSuchTag", true)).rejects.toThrow(
            "GeyserMC has no Xbox account",
        );
        expect(commands).toEqual([]);
    });

    it("can only be opped once they have joined, and says to stop the server otherwise", async () => {
        installFloodgate();
        const naming = await readBedrockNaming("paper", deps);

        await expect(setPlayerFlag(ctx("online"), toConsole, naming, "op", ".Tim203", true)).rejects.toThrow(
            "Stop the server to make them an operator now",
        );
        expect(commands).toEqual([]);

        write("usercache.json", [{ uuid: TIM, name: ".Tim203", expiresOn: "2027-01-01 00:00:00 +0000" }]);
        await setPlayerFlag(ctx("online"), toConsole, naming, "op", ".Tim203", true);
        expect(commands).toEqual(["op .Tim203"]);
    });
});

describe("Bedrock players' current names", () => {
    it("come from their gamertag on GeyserMC, with Floodgate's prefix", async () => {
        installFloodgate();
        const naming = await readBedrockNaming("paper", deps);

        expect(await currentPlayerNames([TIM], naming)).toEqual({ [TIM]: ".Tim203" });
        expect(requests).toEqual(["/geysermc/v2/xbox/gamertag/2535432196048835"]);
    });

    it("are not asked of Mojang, which has no such accounts", async () => {
        expect(await currentPlayerNames(["00000000-0000-0000-0009-01f64f8ed6c4"], null)).toEqual({});
        expect(requests).toEqual([]);
    });
});
