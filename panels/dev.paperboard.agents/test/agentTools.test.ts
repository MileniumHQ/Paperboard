import { afterEach, describe, expect, test } from "bun:test";
import { PANEL_ID } from "../src/contract";
import { actionsToolset, type ActionEntry } from "../src/service/actionsToolset";
import { MCP_TOKEN_ENV, startComputerMcp, type ComputerMcp } from "../src/service/computerMcp";
import { MAX_IMAGES, toToolResult } from "../src/service/mcpClient";
import { toolbox, type Toolset } from "../src/service/toolsets";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const c of closers.splice(0)) await c();
});

const USER = { fromFlow: false };
const schema = (name: string, extra: NonNullable<ActionEntry["schema"]> = {}) => ({ name, description: name, inputs: {}, ...extra });

const REGISTRY: ActionEntry[] = [
    { panelId: "dev.paperboard.discord", action: "post", schema: schema("Post") },
    { panelId: "dev.paperboard.discord", action: "message-posted", schema: schema("When posted", { eventOnly: true }) },
    { panelId: "dev.paperboard.discord", action: "ui-secret", schema: schema("UI", { internal: true }) },
    { panelId: "dev.paperboard.discord", action: "old", schema: schema("Old", { deprecated: "use post" }) },
    { panelId: "dev.paperboard.discord", action: "state" },
    { panelId: "dev.paperboard.terminal", action: "run-command", schema: schema("Run Command") },
    { panelId: PANEL_ID, action: "send-message", schema: schema("Send Message") },
];

function actions() {
    const calls: { panel: string; action: string; inputs: unknown }[] = [];
    const set = actionsToolset({
        host: {
            list: async () => REGISTRY,
            listProjects: async () => [],
            call: async (panel, action, inputs) => {
                calls.push({ panel, action, inputs });
                return { ok: true };
            },
        },
        enabled: () => true,
    });
    return { set, calls, call: (name: string, args: Record<string, unknown>) => set.call(name, args, USER) };
}

// Only listable actions can run.
describe("Paperboard actions as the agent's tools", () => {
    test("the terminal panel's actions are never listed or runnable, even named directly", async () => {
        const { set, calls, call } = actions();
        expect(await set.instructions!(USER)).not.toContain("dev.paperboard.terminal");
        const listed = await call("list_actions", { panel: "dev.paperboard.terminal" });
        expect(listed).toEqual({ isError: true, text: "dev.paperboard.terminal offers no actions you can run." });
        const ran = await call("run_action", { panel: "dev.paperboard.terminal", action: "run-command", inputs: { command: "rm -rf ~" } });
        expect(ran.isError).toBe(true);
        expect(calls).toEqual([]);
    });

    test("the agent's own, internal, deprecated and schema-less actions and unknown panels fail with nothing called", async () => {
        const { calls, call } = actions();
        const listed = JSON.parse((await call("list_actions", { panel: "dev.paperboard.discord" })).text);
        expect(listed.actions.map((a: { action: string }) => a.action)).toEqual(["post", "message-posted"]);
        for (const [panel, action] of [
            [PANEL_ID, "send-message"],
            ["dev.paperboard.discord", "ui-secret"],
            ["dev.paperboard.discord", "old"],
            ["dev.paperboard.discord", "state"],
            ["dev.paperboard.nowhere", "post"],
            ["dev.paperboard.discord", "message-posted"],
        ]) {
            const r = await call("run_action", { panel, action });
            expect(r.isError).toBe(true);
        }
        expect(calls).toEqual([]);
        expect(await call("run_action", { panel: "dev.paperboard.discord", action: "post", inputs: { text: "hi" } })).toEqual({ text: '{\n "ok": true\n}' });
        expect(calls).toEqual([{ panel: "dev.paperboard.discord", action: "post", inputs: { text: "hi" } }]);
    });

    test("non-object or oversized inputs are refused before anything runs", async () => {
        const { calls, call } = actions();
        for (const inputs of ["text", 42, ["a"], null]) {
            expect(await call("run_action", { panel: "dev.paperboard.discord", action: "post", inputs })).toEqual({ isError: true, text: "inputs is an object of values by input name." });
        }
        const big = await call("run_action", { panel: "dev.paperboard.discord", action: "post", inputs: { text: "x".repeat(70 * 1024) } });
        expect(big).toEqual({ isError: true, text: "inputs are limited to 64 KB." });
        expect(calls).toEqual([]);
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
