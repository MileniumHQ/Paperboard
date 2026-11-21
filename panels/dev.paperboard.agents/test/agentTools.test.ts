import { afterEach, describe, expect, test } from "bun:test";
import { PANEL_ID } from "../src/contract";
import { memoryBlocks, type BlockProjectInfo, type MemoryBlocks } from "@mileniumhq/paperapi";
import { blocksToolset, type BlocksRegistry } from "../src/service/blocksToolset";
import { MCP_TOKEN_ENV, startComputerMcp, type ComputerMcp } from "../src/service/computerMcp";
import { MAX_IMAGES, toToolResult } from "../src/service/mcpClient";
import { toolbox, type Toolset } from "../src/service/toolsets";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const c of closers.splice(0)) await c();
});

const USER = { fromFlow: false };
const SERVERS = "dev.example.servers";
const TERMINAL = "dev.paperboard.terminal";
const BOTS = "dev.example.bots";

/** Three panels' blocks in memory, with the daemon's checks, and what was run through them. */
async function registry() {
    const ran: string[] = [];
    const panels = new Map<string, MemoryBlocks>();
    const projects: BlockProjectInfo[] = [];
    const panel = (id: string) => {
        const m = memoryBlocks(id);
        panels.set(id, m);
        return m;
    };
    const servers = panel(SERVERS);
    await servers.panel.register({
        types: [
            {
                id: "server",
                name: "Server",
                base: "text",
                choices: () => [{ label: "Survival", value: "survival" }],
                fields: { status: { type: "text", name: "Status", resolve: (id: string) => (ran.push(`status ${id}`), "online") } },
            },
        ],
        commands: [
            { id: "start", name: "Start Server", inputs: { server: { type: "server", name: "Server" } }, output: "text", outputName: "Result", run: ({ server }: { server: string }) => (ran.push(`start ${server}`), "started") },
            { id: "wipe", name: "Wipe", internal: true, run: () => void ran.push("wipe") },
        ],
        values: [{ id: "count", name: "Servers", type: "number", read: () => (ran.push("count"), 1) }],
        events: [{ id: "joined", name: "When a Player Joins", values: { player: { type: "text", name: "Player" } } }],
    });
    const survival = await servers.defineProject({ id: "survival", name: "Survival" });
    projects.push({ panelId: SERVERS, id: "survival", name: "Survival" });
    await survival.register({ commands: [{ id: "say", name: "Say", inputs: { text: { type: "text", name: "Text" } }, run: ({ text }: { text: string }) => void ran.push(`say ${text}`) }] });
    // another panel's project block that takes a server
    const bots = panel(BOTS);
    const guild = await bots.defineProject({ id: "guild", name: "Guild" });
    projects.push({ panelId: BOTS, id: "guild", name: "Guild" });
    await guild.register({ commands: [{ id: "announce", name: "Announce", inputs: { server: { type: `${SERVERS}:server`, name: "Server" } }, run: () => void ran.push("announce") }] });
    await panel(TERMINAL).panel.register({ commands: [{ id: "run-command", name: "Run Command", inputs: { command: { type: "text", name: "Command" } }, run: () => void ran.push("terminal") }] });
    await panel(PANEL_ID).panel.register({ commands: [{ id: "send-message", name: "Send Message", run: () => void ran.push("agent") }] });

    const of = (id: string) => panels.get(id) ?? Promise.reject(new Error(`no panel ${id}`));
    const typeOf = (ref: string) => ref.slice(ref.indexOf(":") + 1);
    const host: BlocksRegistry = {
        list: async () => [...panels.values()].flatMap((m) => m.list()),
        projects: async () => projects,
        run: async (p, id, inputs, o) => (await of(p)).run(id, inputs, o),
        read: async (p, id, inputs, o) => (await of(p)).read(id, inputs, o),
        property: async (ref, field, value, o) => (await of(ref.slice(0, ref.indexOf(":")))).property(typeOf(ref), field, value, o),
        choices: async (p, entry, input) => (await of(p)).choices(entry, input),
        typeChoices: async (ref, o) => (await of(ref.slice(0, ref.indexOf(":")))).typeChoices(typeOf(ref), o),
    };
    const set = blocksToolset({ registry: host, enabled: () => true });
    return { set, ran, call: (name: string, args: Record<string, unknown>) => set.call(name, args, USER) };
}

// Only listed blocks can be used.
describe("Paperboard's blocks as the agent's tools", () => {
    test("the terminal's blocks and the agent's own are never listed or run, even named directly", async () => {
        const { set, ran, call } = await registry();
        const told = await set.instructions!(USER);
        expect(told).toContain(SERVERS);
        expect(told).not.toContain(TERMINAL);
        expect(told).not.toContain(PANEL_ID);
        for (const panel of [TERMINAL, PANEL_ID]) {
            expect(await call("list_blocks", { panel })).toEqual({ isError: true, text: `${panel} offers no blocks you can use.` });
        }
        expect((await call("run_block", { panel: TERMINAL, block: "command.run-command", inputs: { command: "rm -rf ~" } })).isError).toBe(true);
        expect((await call("run_block", { panel: PANEL_ID, block: "command.send-message" })).isError).toBe(true);
        expect(ran).toEqual([]);
    });

    test("a panel lists its types, blocks and projects; internal blocks, events, types and unknown blocks never run", async () => {
        const { ran, call } = await registry();
        const listed = JSON.parse((await call("list_blocks", { panel: SERVERS })).text);
        expect(listed.types.map((t: { type: string }) => t.type)).toEqual([`${SERVERS}:server`]);
        expect(listed.blocks.map((b: { block: string }) => b.block)).toEqual(["command.start", "value.count", "event.joined"]);
        expect(listed.projects).toEqual([{ id: "survival", name: "Survival", blocks: 1 }]);
        const project = JSON.parse((await call("list_blocks", { panel: SERVERS, project: "survival" })).text);
        expect(project.blocks.map((b: { block: string }) => b.block)).toEqual(["command.say"]);
        for (const block of ["command.wipe", "event.joined", "type.server", "command.nothing", "command.say"]) {
            expect((await call("run_block", { panel: SERVERS, block })).isError).toBe(true);
        }
        expect(ran).toEqual([]);
    });

    test("commands run and values read, in their project when named; fields and choices come from the type's panel", async () => {
        const { ran, call } = await registry();
        const server = `${SERVERS}:server`;
        expect(await call("block_choices", { panel: SERVERS, block: "command.start", input: "server" })).toEqual({ text: '{\n "choices": [\n  {\n   "label": "Survival",\n   "value": "survival"\n  }\n ]\n}' });
        expect(await call("run_block", { panel: SERVERS, block: "command.start", inputs: { server: "survival" } })).toEqual({ text: "started" });
        expect(await call("run_block", { panel: SERVERS, block: "value.count" })).toEqual({ text: "1" });
        expect(await call("run_block", { panel: SERVERS, block: "command.say", project: "survival", inputs: { text: "hi" } })).toEqual({ text: "Done (the block gives nothing back)." });
        expect(await call("block_field", { type: server, field: "status", value: "survival" })).toEqual({ text: "online" });
        expect(ran).toEqual(["start survival", "count", "say hi", "status survival"]);
        // the owning panel checks the inputs: one that's missing fails with its reason
        expect((await call("run_block", { panel: SERVERS, block: "command.say", project: "survival" })).isError).toBe(true);
        expect((await call("block_field", { type: server, field: "players", value: "survival" })).text).toBe(`${server} has no field "players". Its fields: status.`);
    });

    test("a project block's input of another panel's type lists that type's values outside the project", async () => {
        const { call } = await registry();
        const listed = await call("block_choices", { panel: BOTS, block: "command.announce", project: "guild", input: "server" });
        expect(listed.isError).toBeUndefined();
        expect(JSON.parse(listed.text).choices).toEqual([{ label: "Survival", value: "survival" }]);
    });

    test("non-object or oversized inputs are refused before anything runs", async () => {
        const { ran, call } = await registry();
        for (const inputs of ["text", 42, ["a"], null]) {
            expect(await call("run_block", { panel: SERVERS, block: "command.start", inputs })).toEqual({ isError: true, text: "inputs is an object of values by input key." });
        }
        const big = await call("run_block", { panel: SERVERS, block: "command.start", inputs: { server: "x".repeat(70 * 1024) } });
        expect(big).toEqual({ isError: true, text: "inputs are limited to 64 KB." });
        expect(ran).toEqual([]);
    });
});

// The computer MCP endpoint needs its token.
describe("the computer's MCP endpoint", () => {
    async function serve(sets: Toolset[]) {
        const mcp = await startComputerMcp(toolbox(sets));
        closers.push(() => mcp.close());
        return mcp;
    }
    const rpc = (mcp: ComputerMcp, auth: string | null, method: string, params: unknown = {}) =>
        fetch(mcp.url, {
            method: "POST",
            headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth }) },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });

    test("it binds to 127.0.0.1; a missing, wrong or longer token gets 401 and calls nothing; a tool not offered is never called", async () => {
        const called: string[] = [];
        const mcp = await serve([
            {
                id: "one",
                tools: () => [{ name: "ping", description: "", inputSchema: { type: "object" } }],
                call: async (name) => {
                    called.push(name);
                    return { text: "pong" };
                },
            },
        ]);
        expect(new URL(mcp.url).hostname).toBe("127.0.0.1");
        expect(MCP_TOKEN_ENV).toBe("PAPERBOARD_COMPUTER_MCP_TOKEN");
        for (const auth of [null, "", `Bearer ${"0".repeat(64)}`, `Bearer ${mcp.token}x`, `Bearer  ${mcp.token}`, mcp.token, `bearer ${mcp.token}`]) {
            const res = await rpc(mcp, auth, "tools/call", { name: "ping", arguments: {} });
            expect(res.status).toBe(401);
            await res.body?.cancel();
        }
        expect(called).toEqual([]);
        const unknown = await (await rpc(mcp, `Bearer ${mcp.token}`, "tools/call", { name: "rm_rf", arguments: {} })).json();
        expect(unknown.error).toMatchObject({ code: -32602, message: "unknown tool rm_rf" });
        expect(called).toEqual([]);
        const ok = await (await rpc(mcp, `Bearer ${mcp.token}`, "tools/call", { name: "ping", arguments: {} })).json();
        expect(ok.result).toEqual({ content: [{ type: "text", text: "pong" }], isError: false });
        expect(called).toEqual(["ping"]);
    });

    test("a tool name offered by two toolsets fails rather than routing to one", async () => {
        const called: string[] = [];
        const twin = (id: string): Toolset => ({
            id,
            tools: () => [{ name: "look", description: "", inputSchema: { type: "object" } }],
            call: async () => {
                called.push(id);
                return { text: id };
            },
        });
        const mcp = await serve([twin("computer"), twin("plugin")]);
        const list = await (await rpc(mcp, `Bearer ${mcp.token}`, "tools/list")).json();
        expect(list.error.message).toBe("tool look is offered by both computer and plugin");
        const call = await (await rpc(mcp, `Bearer ${mcp.token}`, "tools/call", { name: "look", arguments: {} })).json();
        expect(call.error.message).toBe("tool look is offered by both computer and plugin");
        expect(called).toEqual([]);
    });

    test("a tool server's images reach the agent: every seeable type, embedded ones too, and the rest are named", async () => {
        const png = { type: "image", data: "cG5n", mimeType: "image/png" };
        const from = toToolResult({
            content: [
                { type: "text", text: "two shots" },
                png,
                { type: "image", data: "anBn", mimeType: "image/jpeg" },
                { type: "resource", resource: { uri: "file:///shot.webp", mimeType: "image/webp", blob: "d2VicA==" } },
                { type: "image", data: "c3Zn", mimeType: "image/svg+xml" },
                ...Array.from({ length: MAX_IMAGES }, () => png),
            ],
        });
        expect(from.images?.map((i) => i.type)).toEqual(["image/png", "image/jpeg", "image/webp", ...Array(MAX_IMAGES - 3).fill("image/png")]);
        expect(from.text).toContain("of type image/svg+xml was returned");
        expect(from.text.split(`only ${MAX_IMAGES} images can be shown`).length - 1).toBe(3);

        const mcp = await serve([{ id: "server", tools: () => [{ name: "look", description: "", inputSchema: { type: "object" } }], call: async () => from }]);
        const call = await (await rpc(mcp, `Bearer ${mcp.token}`, "tools/call", { name: "look", arguments: {} })).json();
        const sent = call.result.content.filter((c: { type: string }) => c.type === "image");
        expect(sent).toEqual(from.images!.map((i) => ({ type: "image", data: i.data, mimeType: i.type })));
    });
});
