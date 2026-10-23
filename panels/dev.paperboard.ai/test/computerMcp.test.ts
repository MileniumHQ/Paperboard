import { afterEach, describe, expect, test } from "bun:test";
import { startComputerMcp, type ComputerMcp, type ToolResult } from "../src/service/computerMcp";
import { COMPUTER_TOOLS } from "../src/service/computerTools";
import { toolbox } from "../src/service/toolsets";

type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
// the endpoint over the computer's toolset alone
const box = (call: CallTool) => toolbox([{ id: "computer", tools: () => COMPUTER_TOOLS, call }]);

let mcp: ComputerMcp | null = null;
afterEach(async () => {
    await mcp?.close();
    mcp = null;
});

const post = (body: unknown, token: string | null = mcp!.token, url = mcp!.url) =>
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });

describe("the computer's MCP endpoint", () => {
    test("listens on loopback only", async () => {
        mcp = await startComputerMcp(box(async () => ({ text: "" })));
        expect(new URL(mcp.url).hostname).toBe("127.0.0.1");
    });

    test("refuses requests without this generation's token", async () => {
        const calls: string[] = [];
        mcp = await startComputerMcp(box(async (name) => (calls.push(name), { text: "" })));
        const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "shell", arguments: { command: "id" } } };
        expect((await post(call, null)).status).toBe(401);
        expect((await post(call, "0".repeat(64))).status).toBe(401);
        expect((await post(call, mcp.token + "x")).status).toBe(401);
        expect(calls).toEqual([]);
    });

    test("lists the computer's tools and carries a call to the computer", async () => {
        const seen: [string, Record<string, unknown>][] = [];
        const callTool: CallTool = async (name, args) => {
            seen.push([name, args]);
            return { text: "uid=1000", image: "iVBOR", isError: false };
        };
        mcp = await startComputerMcp(box(callTool));
        const list = await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
        expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(COMPUTER_TOOLS.map((t) => t.name));

        const r = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "shell", arguments: { command: "id" } } })).json();
        expect(seen).toEqual([["shell", { command: "id" }]]);
        expect(r.result).toEqual({
            content: [
                { type: "text", text: "uid=1000" },
                { type: "image", data: "iVBOR", mimeType: "image/png" },
            ],
            isError: false,
        });
    });

    test("tells who's waiting each time a harness lists the tools, and only then", async () => {
        mcp = await startComputerMcp(box(async () => ({ text: "" })));
        let listed = 0;
        const off = mcp.onToolsListed(() => listed++);
        await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        expect(listed).toBe(0);
        await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, null); // refused: not a listing
        expect(listed).toBe(0);
        await post({ jsonrpc: "2.0", id: 3, method: "tools/list" });
        expect(listed).toBe(1);
        off();
        await post({ jsonrpc: "2.0", id: 4, method: "tools/list" });
        expect(listed).toBe(1);
    });

    test("a tool that isn't the computer's is an error, never a call", async () => {
        const calls: string[] = [];
        mcp = await startComputerMcp(box(async (name) => (calls.push(name), { text: "" })));
        const r = await (await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_user_files" } })).json();
        expect(r.error.code).toBe(-32602);
        expect(calls).toEqual([]);
    });

    test("notifications are accepted without a reply; other methods and verbs are refused", async () => {
        mcp = await startComputerMcp(box(async () => ({ text: "" })));
        expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
        expect((await (await post({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json()).error.code).toBe(-32601);
        expect((await post([{ jsonrpc: "2.0", id: 5, method: "ping" }])).status).toBe(400);
        const get = await fetch(mcp.url, { headers: { Authorization: `Bearer ${mcp.token}` } });
        expect(get.status).toBe(405);
    });

    test("a body past the cap is refused", async () => {
        mcp = await startComputerMcp(box(async () => ({ text: "" })));
        const huge = JSON.stringify({ jsonrpc: "2.0", id: 6, method: "ping", params: { pad: "x".repeat(2 << 20) } });
        const status = await post(huge).then(
            (r) => r.status,
            () => 413, // the server may cut the connection before the client finishes sending
        );
        expect(status).toBe(413);
    });
});

describe("toolbox", () => {
    test("a name two toolsets both offer is refused, not routed to one of them", async () => {
        const one = { id: "one", tools: () => [COMPUTER_TOOLS[0]!], call: async () => ({ text: "one" }) };
        const two = { id: "two", tools: () => [COMPUTER_TOOLS[0]!], call: async () => ({ text: "two" }) };
        await expect(toolbox([one, two]).list()).rejects.toThrow("offered by both one and two");
        await expect(toolbox([one, two]).call(COMPUTER_TOOLS[0]!.name, {})).rejects.toThrow("offered by both");
    });

    test("a call goes to the toolset that listed the name, and instructions come in order", async () => {
        const one = { id: "one", tools: () => [{ ...COMPUTER_TOOLS[0]!, name: "a" }], call: async () => ({ text: "one" }), instructions: () => "first" };
        const two = { id: "two", tools: () => [{ ...COMPUTER_TOOLS[0]!, name: "b" }], call: async () => ({ text: "two" }), instructions: () => "second" };
        const b = toolbox([one, two]);
        expect((await b.call("b", {})).text).toBe("two");
        expect(await b.instructions()).toEqual(["first", "second"]);
    });
});
