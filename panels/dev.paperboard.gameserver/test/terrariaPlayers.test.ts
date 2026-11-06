// Terraria's players, chat and bans, read from what its 1.4.5.8 dedicated
// server prints and writes: the console lines below are copied from a real
// server, and bans land in the banlist.txt that server re-reads on every join.
import { afterAll, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";
import { portApiStub } from "./portApiStub";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-terraria-players-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const writes: string[] = [];
mock.module("../src/service/api", () => ({
    ...paperapi,
    portApi: portApiStub(),
    config: { get: async () => ({ maxplayers: 16 }), set: async () => true },
    processApi: { write: async (_id: string, data: string) => { writes.push(data); }, exists: async () => true },
    files: { getPath: async () => root },
}));
mock.module("@mileniumhq/paperapi", () => ({
    ...paperapi,
    secretsApi: { get: async () => ({ found: false, value: null }) },
    fileApi: { getPath: async (rel: string) => path.join(root, rel) },
}));

const { parseConsoleLine, parseBanlist, formatBanlist, PlayerStore } = await import("../src/games/terraria/roster");
// the app loads the game registry first; the Terraria service sits in an import cycle with it
await import("../src/games/service");
const { terrariaService } = await import("../src/games/terraria/service");
const { inServer } = await import("../src/service/scope");
const scope = { server: { id: "s-test", game: "terraria", directory: "" }, locals: new Map() } as any;

test("console lines from a real server read as joins, leaves, chat and the player list, prompt or not", () => {
    expect(parseConsoleLine("Steve Jobs has joined.")).toEqual({ kind: "join", name: "Steve Jobs" });
    expect(parseConsoleLine(": Steve Jobs has left.")).toEqual({ kind: "leave", name: "Steve Jobs" });
    expect(parseConsoleLine("<Steve Jobs> hello from steve")).toEqual({ kind: "chat", sender: "Steve Jobs", content: "hello from steve" });
    expect(parseConsoleLine("<Server> Hi Steve")).toEqual({ kind: "server", content: "Hi Steve" });
    expect(parseConsoleLine(": Steve Jobs (127.0.0.1:53208)")).toEqual({ kind: "listed", name: "Steve Jobs", address: "127.0.0.1:53208" });
    expect(parseConsoleLine("Tails (127.0.0.1:36556)\r")).toEqual({ kind: "listed", name: "Tails", address: "127.0.0.1:36556" });
    expect(parseConsoleLine("1 player connected.")).toEqual({ kind: "count", count: 1 });
    expect(parseConsoleLine("2 players connected.")).toEqual({ kind: "count", count: 2 });
    expect(parseConsoleLine(": No players connected.")).toEqual({ kind: "count", count: 0 });
    for (const line of ["127.0.0.1:53208 is connecting...", ": 127.0.0.1:36556 was booted: Kicked from server.", ": Server started", "Saving world data: 26%"]) {
        expect(parseConsoleLine(line)).toBeNull();
    }
});

test("the banlist keeps Terraria's //name and address pairs, and unnamed addresses", () => {
    const text = "//Steve Jobs\n127.0.0.1\n10.0.0.9\n//Tails\n192.168.1.4\n";
    expect(parseBanlist(text)).toEqual([
        { name: "Steve Jobs", address: "127.0.0.1" },
        { name: "", address: "10.0.0.9" },
        { name: "Tails", address: "192.168.1.4" },
    ]);
    expect(formatBanlist(parseBanlist(text))).toBe(text);
});

test("players who joined at once are all remembered", async () => {
    const dir = fs.mkdtempSync(path.join(root, "store-"));
    const store = new PlayerStore(dir);
    await Promise.all(["A", "B", "C", "D"].map((name, i) => store.remember(name, `10.0.0.${i}:7777`)));
    expect((await store.seen()).map((p) => p.name).sort()).toEqual(["A", "B", "C", "D"]);
});

test("an offline ban needs an address; an unban removes the player's pair and keeps the rest", async () => {
    const dir = fs.mkdtempSync(path.join(root, "bans-"));
    const store = new PlayerStore(dir);
    await store.remember("Ghost");
    await expect(store.banOffline("Ghost")).rejects.toThrow("no address");
    await expect(store.banOffline("Nobody")).rejects.toThrow("never joined");
    fs.writeFileSync(path.join(dir, "banlist.txt"), "//Keep\n10.0.0.1\n");
    await store.remember("Tails", "[::ffff:192.168.1.4]:51234");
    await store.banOffline("tails");
    expect(fs.readFileSync(path.join(dir, "banlist.txt"), "utf8")).toBe("//Keep\n10.0.0.1\n//Tails\n::ffff:192.168.1.4\n");
    await expect(store.banOffline("Tails")).rejects.toThrow("already banned");
    await store.unban("TAILS");
    expect(fs.readFileSync(path.join(dir, "banlist.txt"), "utf8")).toBe("//Keep\n10.0.0.1\n");
    await expect(store.unban("Tails")).rejects.toThrow("not banned");
});

function makeCtx() {
    let state: any = { ...terrariaService.initialState(), serverStatus: "online" };
    const triggers: { id: string; output: unknown }[] = [];
    return {
        triggers,
        get state() { return state; },
        setState(patch: any) { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; },
        emitTrigger(id: string, output: unknown) { triggers.push({ id, output }); },
    } as any;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

test("a join is tracked, its address learned from a quiet `playing`, and kick, ban and unban reach the server", () => inServer(scope, async () => {
    const ctx = makeCtx();
    // reattaching to a running server learns its limit and who is on it
    await terrariaService.initialize(ctx, true);
    expect(ctx.state.maxPlayers).toBe(16);
    expect(writes.splice(0)).toEqual(["playing\n"]);
    terrariaService.observeLine(ctx, ": No players connected.");

    terrariaService.observeLine(ctx, "127.0.0.1:39194 is connecting...");
    terrariaService.observeLine(ctx, "Steve Jobs has joined.");
    expect(ctx.state.onlinePlayers).toEqual(["Steve Jobs"]);
    expect(writes.splice(0)).toEqual(["playing\n"]);
    terrariaService.observeLine(ctx, ": Steve Jobs (127.0.0.1:39194)");
    terrariaService.observeLine(ctx, "1 player connected.");
    terrariaService.observeLine(ctx, "<Steve Jobs> hello from steve");
    terrariaService.observeLine(ctx, "<Server> Hi Steve");
    await settle();

    // Paperboard's own queries stay out of the console; the game's lines don't
    expect(ctx.state.serverEntries.map((e: any) => e.content)).toEqual(["127.0.0.1:39194 is connecting...", "Steve Jobs has joined.", "<Steve Jobs> hello from steve", "<Server> Hi Steve"]);
    expect(ctx.state.chatMessages.map((m: any) => [m.event, m.sender, m.content])).toEqual([
        ["join", "Steve Jobs", undefined],
        [undefined, "Steve Jobs", "hello from steve"],
        ["server", undefined, "Hi Steve"],
    ]);
    expect(ctx.triggers.map((t: any) => t.id)).toEqual(["player-joined", "chat-message"]);

    const actions = new Map((await terrariaService.actions()).map((a) => [a.id, a]));
    const run = (id: string, input: unknown) => actions.get(id)!.run(ctx, input as any);
    const roster = await run("terraria-players", {});
    expect(roster.seen).toMatchObject([{ name: "Steve Jobs", address: "127.0.0.1:39194" }]);

    // kick and ban use the name as Terraria spells it
    await run("terraria-kick", { name: "steve jobs" });
    expect(writes.splice(0)).toEqual(["kick Steve Jobs\n"]);
    await expect(run("terraria-kick", { name: "Tails" })).rejects.toThrow("not online");
    await expect(run("terraria-kick", { name: "two\nlines" })).rejects.toThrow("one line");

    terrariaService.observeLine(ctx, ": Steve Jobs has left.");
    expect(ctx.state.onlinePlayers).toEqual([]);
    // gone from the server: banned by the address they last joined from
    await run("terraria-ban", { name: "Steve Jobs" });
    expect(writes).toEqual([]);
    expect(fs.readFileSync(path.join(root, "banlist.txt"), "utf8")).toBe("//Steve Jobs\n127.0.0.1\n");
    expect((await run("terraria-players", {})).bans).toEqual([{ name: "Steve Jobs", address: "127.0.0.1" }]);
    await run("terraria-unban", { name: "Steve Jobs" });
    expect(fs.readFileSync(path.join(root, "banlist.txt"), "utf8")).toBe("");
    await terrariaService.dispose();
}));

test("Paperboard's own check that the server listens stays out of the console", () => inServer(scope, async () => {
    const net = await import("node:net");
    const accepted: string[] = [];
    const listener = net.createServer((socket) => { accepted.push(`127.0.0.1:${socket.remotePort}`); socket.destroy(); });
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    try {
        const ctx = makeCtx();
        ctx.setState({ serverPort: String((listener.address() as import("node:net").AddressInfo).port) });
        terrariaService.observeLine(ctx, "Listening on port 7777");
        expect(await terrariaService.readiness!.probe!(ctx)).toBe(true);
        await settle();
        expect(accepted).toHaveLength(1);
        // what Terraria prints for that check, then for a real player
        terrariaService.observeLine(ctx, `${accepted[0]} is connecting...`);
        terrariaService.observeLine(ctx, ": 127.0.0.1:1 is connecting...");
        await settle();
        expect(ctx.state.serverEntries.map((e: any) => e.content)).toEqual(["Listening on port 7777", "127.0.0.1:1 is connecting..."]);
    } finally {
        listener.close();
    }
}));

test("the console shows Terraria's lines without its prompt, blank lines or a false error", () => inServer(scope, async () => {
    const ctx = makeCtx();
    // its first line as a restarted server printed it, behind a byte order mark for each start
    for (const line of ["\uFEFF\uFEFF\uFEFF\uFEFFError Logging Enabled.", "\uFEFF", "Terraria Server v1.4.5.8", "", ": Server started", "Listening on port 7777", ": ", "Exception thrown: System.IO.IOException"]) terrariaService.observeLine(ctx, line);
    await settle();
    expect(ctx.state.serverEntries).toEqual([
        { type: "info", content: "Error Logging Enabled." },
        { type: "info", content: "Terraria Server v1.4.5.8" },
        { type: "info", content: "Server started" },
        { type: "info", content: "Listening on port 7777" },
        { type: "error", content: "Exception thrown: System.IO.IOException" },
    ]);
}));
