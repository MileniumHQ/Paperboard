// Game Server's blocks (Actions API v2), read the way the Blocks panel
// reads them: through the real daemon, from the installed service.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { backupLocationsApi, blocksApi, getTransport, type BackupRecord } from "@mileniumhq/paperapi";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installFakeJava } from "./helpers/fakeJava";
import { installPanel, restartService, servicesState, waitForFile } from "./helpers/installedPanel";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";
import { gamerulesFor } from "../src/core/gamerules";
import { entrypoint, releaseFor } from "../src/games/terraria/catalog";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
const folder = (id: string) => path.join(dataDir, "files", PANEL_ID, SERVERS, id);
const serverDir = folder("s-a");
const terraria = releaseFor("1.4.5.8");
const read = <T>(value: string, inputs?: Record<string, unknown>, project = "s-a") => blocksApi.read<T>(PANEL_ID, value, inputs, { project });
const run = <T>(command: string, inputs?: Record<string, unknown>, project = "s-a") => blocksApi.run<T>(PANEL_ID, command, inputs, { project, timeoutMs: null });

/** resolves with what the next firing of `event` in `project` (or the panel's own, without one) carried */
function nextEvent(event: string, project: string | undefined, timeoutMs = 10_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            off();
            reject(new Error(`${event} did not fire in ${project ?? "the panel"}`));
        }, timeoutMs);
        const off = blocksApi.onEvent(PANEL_ID, event, (payload) => {
            clearTimeout(timer);
            off();
            resolve(payload);
        }, project);
    });
}
// subscriptions reach the daemon on their own; a test waits for the daemon to take them before what fires them
const settle = () => getTransport().subscriptionsSettled();

const SHARED = {
    commands: ["back-up", "delete-backup", "restart-server", "restore-backup", "run-command", "save-world", "say", "set-automatic-updates", "set-daily-restart", "set-option", "set-restart-after-crash", "start-server", "stop-server", "write-file"],
    values: ["automation", "backups", "console-output", "file-text", "files", "log", "log-files", "online-players", "option", "player-count", "server-status"],
    events: ["backup-failed", "backup-finished", "server-crashed", "server-started", "server-stopped"],
};
const PLAYER_EVENTS = ["chat-message", "player-joined", "player-left"];
const entriesOf = (project: string, blocks: { commands: string[]; values: string[]; events: string[] }) =>
    (["commands", "values", "events"] as const).flatMap((kind) => blocks[kind].map((id) => `${project}/${kind.slice(0, -1)}.${id}`));

let daemon: TestDaemon;
beforeAll(async () => {
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({
        version: 2,
        serversDirectory: SERVERS,
        servers: [
            { id: "s-a", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-a`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
            { id: "s-t", name: "Island", game: "terraria", directory: `${SERVERS}/s-t`, createdAt: 1, settings: { configured: true, version: terraria.version, port: await freePort() } },
        ],
    }));
    writeTree(serverDir, {
        "server.jar": "jar",
        "eula.txt": "eula=true\n",
        "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 10 }),
    });
    writeTree(folder("s-t"), {
        [`install/${terraria.directory}/manifest.json`]: JSON.stringify({ software: "vanilla", version: terraria.version, sha256: terraria.sha256, os: process.platform, arch: process.arch }),
    });
    placeStandIn("fakeTerraria", path.join(folder("s-t"), "install", terraria.directory, entrypoint(process.platform)));
    installFakeJava(javaPackageFor("1.21.1")!, dataDir);
    daemon = await startTestDaemon();
    await restartService();
});
afterAll(async () => {
    for (const server of ["s-a", "s-t"]) await serverCalls(server).stopServer();
    await daemon?.stop();
});

describe("each server is a Blocks project with its game's blocks", () => {
    test("Minecraft's and Terraria's projects list the shared blocks, each game's own, and the panel's types", async () => {
        expect((await blocksApi.projects(PANEL_ID)).map((p) => [p.id, p.name]).sort()).toEqual([["s-a", "Survival"], ["s-t", "Island"]]);
        const all = await blocksApi.list(PANEL_ID);
        const of = (prefix: string) => all.map((b) => b.entry).filter((e) => e.startsWith(prefix)).sort();
        expect(of("type.")).toEqual(["automation", "backup", "datapack", "log-file", "modpack", "player", "player-statistics", "plugin", "server", "world"].map((t) => `type.${t}`));
        expect(of("s-a/")).toEqual(entriesOf("s-a", {
            commands: [...SHARED.commands, "ban-player", "create-world", "delete-player-data", "delete-plugin", "delete-world", "deop-player", "install-datapack", "install-modpack", "install-plugin", "install-software", "kick-player", "kill-player", "op-player", "pardon-player", "remove-datapack", "remove-modpack", "reset-world", "set-game-rule", "switch-world", "uninstall-plugins", "unwhitelist-player", "whitelist-player"],
            values: [...SHARED.values, "active-world", "banned-players", "datapacks", "game-rule", "modpack", "operators", "player-by-uuid", "player-statistics", "plugins", "statistics-of", "whitelisted-players", "worlds"],
            events: [...SHARED.events, ...PLAYER_EVENTS],
        }).sort());
        expect(of("s-t/")).toEqual(entriesOf("s-t", {
            commands: [...SHARED.commands, "ban-player", "kick-player", "unban-player"],
            values: [...SHARED.values, "banned-players"],
            events: [...SHARED.events, ...PLAYER_EVENTS],
        }).sort());

        const schema = (entry: string) => all.find((b) => b.entry === entry)!.schema as any;
        expect(schema("s-a/command.kick-player")).toMatchObject({ text: "Kick {player} because {reason}", inputs: { player: { type: `${PANEL_ID}:player` } } });
        expect(schema("s-a/command.back-up")).toMatchObject({ output: `${PANEL_ID}:backup` });
        // every section has the symbol the panel declared for it, in each server's project too
        expect(schema("s-a/command.set-option")).toMatchObject({ category: "Options", categoryIcon: "tune" });
        expect(schema("s-t/command.kick-player")).toMatchObject({ category: "Players", categoryIcon: "group" });
        const missing = all.filter((b) => b.schema.kind !== "type" && "category" in b.schema && b.schema.category && !b.schema.categoryIcon).map((b) => b.entry);
        expect(missing).toEqual([]);
        expect(schema("s-t/event.chat-message")).toMatchObject({ values: { player: { type: `${PANEL_ID}:player` }, message: { type: "text" } }, filters: { player: "player", message: "message" } });
        // the rule dropdown asks the server, so it lists the rules of the version it has now
        expect(schema("s-a/command.set-game-rule").inputs.rule).toMatchObject({ dynamicChoices: true });
        const rules = await blocksApi.choices(PANEL_ID, "s-a/command.set-game-rule", "rule");
        expect(rules.map((c) => c.value)).toEqual(gamerulesFor("1.21.1").map((r) => r.name));
        await expect(run("set-game-rule", { rule: "notARule", value: "true" })).rejects.toThrow('"Game Rule" must be one of');
    });

    test("the world blocks make, switch and list worlds while the server is stopped, and refuse a world that isn't there", async () => {
        expect(await read("server-status")).toBe("offline");
        expect(await run("create-world", { world: "Second", seed: "42" })).toBeNull();
        expect(await read("active-world")).toBe("Second");
        expect(await read("worlds")).toEqual([{ name: "Second", active: true, generated: false, nether: false, end: false }]);
        expect(await run("switch-world", { world: "Second" })).toBeNull();
        await expect(run("switch-world", { world: "Elsewhere" })).rejects.toThrow('This server has no world named "Elsewhere"');
        await expect(run("restart-server")).rejects.toThrow("The server is not online, so it can't restart");
        expect(await read("active-world")).toBe("Second");
        // add-ons: the active world's datapacks, and no modpack on Paper
        expect(await read("datapacks")).toEqual([]);
        await expect(run("remove-datapack", { datapack: "missing.zip" })).rejects.toThrow("The active world has no datapack named missing.zip");
        await expect(run("install-modpack", { modpack: "fabulously-optimized" })).rejects.toThrow('does not support "installModpack"');
        await expect(read("modpack")).rejects.toThrow("This server has no modpack");
    });

    test("the option blocks read and change what the Options tab does, and refuse what it would", async () => {
        const options = await blocksApi.choices(PANEL_ID, "s-a/command.set-option", "option");
        expect(options.map((c) => c.value)).toEqual(expect.arrayContaining(["difficulty", "max-players", "pvp"]));
        expect(await run("set-option", { option: "difficulty", value: "hard" })).toBeNull();
        // a Text block's words become the option's own kind
        expect(await run("set-option", { option: "pvp", value: "false" })).toBeNull();
        expect(await run("set-option", { option: "max-players", value: "12" })).toBeNull();
        expect(await read("option", { option: "difficulty" })).toBe("hard");
        expect(await read("option", { option: "pvp" })).toBe(false);
        expect(await read("option", { option: "max-players" })).toBe(12);
        expect(fs.readFileSync(path.join(serverDir, "server.properties"), "utf8")).toMatch(/^difficulty=hard$/m);
        await expect(run("set-option", { option: "max-players", value: "lots" })).rejects.toThrow("Max Players");
        await expect(run("set-option", { option: "difficulty", value: "impossible" })).rejects.toThrow("Difficulty must be one of");
        await expect(read("option", { option: "no-such-option" })).rejects.toThrow('"Option" must be one of');
        // each game's own options
        const terrariaOptions = await blocksApi.choices(PANEL_ID, "s-t/command.set-option", "option");
        expect(terrariaOptions.map((c) => c.value)).toContain("maxplayers");
        expect(terrariaOptions.map((c) => c.value)).not.toContain("password");
    });

    test("the file blocks list, read and replace the server's text files, and stay inside its folder", async () => {
        expect(await read("files")).toEqual(expect.arrayContaining(["eula.txt", "server.properties"]));
        expect(await read("file-text", { file: "eula.txt" })).toBe("eula=true\n");
        expect(await run("write-file", { file: "eula.txt", text: "eula=true\n# kept\n" })).toBeNull();
        expect(fs.readFileSync(path.join(serverDir, "eula.txt"), "utf8")).toBe("eula=true\n# kept\n");
        await expect(run("write-file", { file: "new.txt", text: "x" })).rejects.toThrow();
        expect(fs.existsSync(path.join(serverDir, "new.txt"))).toBe(false);
        await expect(read("file-text", { file: "../s-t/secret.txt" })).rejects.toThrow();
        await expect(read("files", { folder: ".." })).rejects.toThrow();
    });

    test("the values read the players online, and a kick announces the change before a fresh read shows it", async () => {
        const state = servicesState();
        const changed = new Set<string>();
        let kickAnnounced = () => {};
        const off = ["player-count", "online-players", "server-status"].map((value) => blocksApi.onChange(PANEL_ID, value, () => { changed.add(value); if (changed.has("player-count") && changed.has("online-players")) kickAnnounced(); }, "s-a"));
        try {
            await settle();
            expect(await run("start-server")).toBeNull();
            await state.waitFor("s-a", (s) => s.serverStatus === "online" && s.onlinePlayers.length === 2, "s-a online with its players");
            expect(await read("server-status")).toBe("online");
            expect(await read("player-count")).toBe(2);
            expect(await read("online-players")).toEqual(["alice", "bob"]);
            expect(changed.has("server-status")).toBe(true);
            // whether a player is online is read on the server that asks
            expect(await blocksApi.property(`${PANEL_ID}:player`, "online", "alice", { project: "s-a" })).toBe(true);
            expect(await blocksApi.property(`${PANEL_ID}:player`, "online", "alice", { project: "s-t" })).toBe(false);
            // a Player input starts as a dropdown of who's online on its server, or on any
            expect(await blocksApi.typeChoices(`${PANEL_ID}:player`, { project: "s-a" })).toEqual([{ label: "alice", value: "alice" }, { label: "bob", value: "bob" }]);
            expect(await blocksApi.typeChoices(`${PANEL_ID}:player`, { project: "s-t" })).toEqual([]);
            expect((await blocksApi.typeChoices(`${PANEL_ID}:player`)).map((c) => c.value)).toEqual(["alice", "bob"]);

            changed.clear();
            const announced = new Promise<void>((resolve) => (kickAnnounced = resolve));
            expect(await run("kick-player", { player: "alice", reason: "testing" })).toBeNull();
            await state.waitFor("s-a", (s) => s.onlinePlayers.length === 1, "alice to leave");
            await announced;
            expect(await read("online-players")).toEqual(["bob"]);
            expect(await read("player-count")).toBe(1);
        } finally {
            for (const unsubscribe of off) unsubscribe();
        }
    });

    test("a kick naming no player, or one that isn't a player name, is refused before the server sees it", async () => {
        await expect(blocksApi.run(PANEL_ID, "kick-player", {}, { project: "s-a" })).rejects.toThrow('Kick Player: "Player" is required');
        await expect(blocksApi.run(PANEL_ID, "kick-player", { player: 7 }, { project: "s-a" })).rejects.toThrow('"Player": expected text');
        await expect(blocksApi.run(PANEL_ID, "kick-player", { player: "bob; stop" }, { project: "s-a" })).rejects.toThrow();
        expect(await read("online-players")).toEqual(["bob"]);
    });

});

describe("the panel's own blocks run its servers, and each server's settings and backups", () => {
    const panelRun = <T>(command: string, inputs?: Record<string, unknown>) => blocksApi.run<T>(PANEL_ID, command, inputs, { timeoutMs: null });
    const panelRead = <T>(value: string, inputs?: Record<string, unknown>) => blocksApi.read<T>(PANEL_ID, value, inputs);
    const field = <T>(server: string, name: string) => blocksApi.property<T>(`${PANEL_ID}:server`, name, server);

    test("the panel lists its servers' blocks beside each server's own", async () => {
        const all = await blocksApi.list(PANEL_ID);
        const own = (kind: string) => all.map((b) => b.entry).filter((e) => e.startsWith(`${kind}.`)).sort();
        expect(own("command")).toEqual(["create-server", "remove-server", "rename-server", "restart-server", "start-server", "stop-server"].map((c) => `command.${c}`));
        expect(own("value")).toEqual(["value.server", "value.servers"]);
        expect(own("event")).toEqual(["server-crashed", "server-started", "server-stopped"].map((e) => `event.${e}`));
        const schema = (entry: string) => all.find((b) => b.entry === entry)!.schema as any;
        expect(schema("command.start-server")).toMatchObject({ text: "Start {server}", inputs: { server: { type: `${PANEL_ID}:server` } } });
        expect(schema("event.server-started")).toMatchObject({ values: { server: { type: `${PANEL_ID}:server` } }, filters: { server: "server" } });
        expect(schema("value.servers")).toMatchObject({ type: `list<${PANEL_ID}:server>`, changes: true });
    });

    test("its templates reach Blocks, each made of blocks the panel has, in every server for one made for each", async () => {
        const templates = (await blocksApi.templates(PANEL_ID)).map((t) => t.template);
        expect(templates.map((t) => t.id)).toEqual(["nightly-restart", "backup-failed"]);
        const all = await blocksApi.list(PANEL_ID);
        const has = (entry: string) => all.find((b) => b.entry === entry)?.schema;
        const projects = (await blocksApi.projects(PANEL_ID)).map((p) => p.id);
        expect(projects).toEqual(["s-a", "s-t"]);
        for (const template of templates) {
            expect(has(`type.${template.needs}`)).toMatchObject({ dynamicChoices: true });
            for (const project of template.eachProject ? projects : [undefined]) {
                const at = (kind: string, id: string) => `${project ? `${project}/` : ""}${kind}.${id}`;
                const event = "event" in template.when ? has(at("event", template.when.event)) : null;
                if ("event" in template.when) expect(event).toBeDefined();
                for (const step of template.steps) {
                    if ("command" in step) expect(has(at("command", step.command))).toBeDefined();
                    else for (const [, key] of step.log.matchAll(/\{([^}]*)\}/g)) if (key !== "project") expect(event).toMatchObject({ values: { [key!]: {} } });
                }
            }
        }
    });

    test("Servers and Server read the panel's servers, and a server's fields read its name, game and status", async () => {
        expect(await panelRead("servers")).toEqual(["s-a", "s-t"]);
        // any Server input starts as a dropdown of them
        expect(await blocksApi.typeChoices(`${PANEL_ID}:server`)).toEqual([{ label: "Survival", value: "s-a" }, { label: "Island", value: "s-t" }]);
        expect(await panelRead("server", { server: "s-t" })).toBe("s-t");
        await expect(panelRead("server", { server: "s-gone" })).rejects.toThrow();
        expect(await field("s-t", "name")).toBe("Island");
        expect(await field("s-t", "game")).toBe("Terraria");
        expect(await field("s-t", "status")).toBe("offline");
        await expect(field("s-gone", "name")).rejects.toThrow("Choose a server that has not been removed");
    });

    test("a server made from Blocks is renamed and removed from Blocks, and its folder is kept", async () => {
        expect((await blocksApi.choices(PANEL_ID, "command.create-server", "game")).map((c) => c.value)).toContain("minecraft");
        await expect(panelRun("create-server", { game: "chess", name: "Nope" })).rejects.toThrow('"Game" must be one of');
        let changes = 0;
        let announcedTwice = () => {};
        const twice = new Promise<void>((resolve) => (announcedTwice = resolve));
        const off = blocksApi.onChange(PANEL_ID, "servers", () => { if (++changes === 2) announcedTwice(); });
        try {
            await settle();
            const made = await panelRun<string>("create-server", { game: "minecraft", name: "Creative" });
            expect(await panelRead("servers")).toEqual(["s-a", "s-t", made]);
            expect((await blocksApi.projects(PANEL_ID)).find((p) => p.id === made)?.name).toBe("Creative");
            expect(await field(made, "game")).toBe("Minecraft");

            expect(await panelRun("rename-server", { server: made, name: "Builders" })).toBeNull();
            expect(await field(made, "name")).toBe("Builders");
            expect((await blocksApi.projects(PANEL_ID)).find((p) => p.id === made)?.name).toBe("Builders");

            fs.writeFileSync(path.join(folder(made), "keep.txt"), "mine");
            expect(await panelRun("remove-server", { server: made })).toBeNull();
            expect(await panelRead("servers")).toEqual(["s-a", "s-t"]);
            expect((await blocksApi.projects(PANEL_ID)).map((p) => p.id)).not.toContain(made);
            expect(fs.readFileSync(path.join(folder(made), "keep.txt"), "utf8")).toBe("mine");
            await expect(panelRun("start-server", { server: made })).rejects.toThrow("Choose a server that has not been removed");

            // the list announced the server made and the server removed
            await twice;
        } finally {
            off();
        }
    });

    test("Start Server and Stop Server run a picked server, and its starts and stops fire the panel's events for it", async () => {
        const state = servicesState();
        const started = nextEvent("server-started", undefined);
        await settle();
        expect(await panelRun("start-server", { server: "s-t" })).toBeNull();
        expect(await started).toEqual({ server: "s-t" });
        await state.waitFor("s-t", (s) => s.serverStatus === "online", "Terraria online");
        expect(await field("s-t", "status")).toBe("online");

        const stopped = nextEvent("server-stopped", undefined);
        await settle();
        expect(await panelRun("stop-server", { server: "s-t" })).toBeNull();
        expect(await stopped).toEqual({ server: "s-t" });
        expect(await field("s-t", "status")).toBe("offline");
        await expect(panelRun("restart-server", { server: "s-t" })).rejects.toThrow("The server is not online, so it can't restart");
    });

    test("Back Up the Server and Restore Backup answer with the backup, and each backup fires Finishes or Fails", async () => {
        await backupLocationsApi.setForPanel(PANEL_ID, "local");
        const notes = path.join(folder("s-t"), "notes.txt");
        fs.writeFileSync(notes, "kept");
        const finished = nextEvent("backup-finished", "s-t", 60_000);
        await settle();
        const made = await run<BackupRecord>("back-up", { name: "from blocks" }, "s-t");
        expect(made).toMatchObject({ target: "s-t", label: "from blocks" });
        expect(await finished).toEqual({ backup: made });
        const backupField = <T>(name: string) => blocksApi.property<T>(`${PANEL_ID}:backup`, name, made, { project: "s-t" });
        expect(await backupField("name")).toBe("from blocks");
        expect(await backupField("created")).toBe(Date.parse(made.createdAt));
        expect(await read("backups", undefined, "s-t")).toEqual([made]);

        fs.writeFileSync(notes, "changed");
        expect(await run("restore-backup", { backup: made }, "s-t")).toEqual(made);
        expect(fs.readFileSync(notes, "utf8")).toBe("kept");
        await expect(run("restore-backup", { backup: { id: "nope", size: 0 } }, "s-t")).rejects.toThrow();

        // a backup location that can't be written to: the backup fails, and says why
        // the folder this computer keeps the server's backups in
        const archive = (fs.readdirSync(path.join(dataDir, "backups"), { recursive: true }) as string[]).find((file) => path.basename(file) === `${made.id}.pbbackup`)!;
        const where = path.dirname(path.join(dataDir, "backups", archive));
        expect(path.basename(where)).toBe("s-t");
        fs.renameSync(where, `${where}.aside`);
        fs.writeFileSync(where, "not a folder");
        try {
            const failed = nextEvent("backup-failed", "s-t", 60_000);
            await settle();
            const refused = await run("back-up", {}, "s-t").then(() => null, (err: Error) => err.message);
            const { error } = await failed;
            expect(typeof error).toBe("string");
            expect(refused).toContain(error as string);
        } finally {
            fs.rmSync(where);
            fs.renameSync(`${where}.aside`, where);
        }
        await run("delete-backup", { backup: made }, "s-t");
    });
});
