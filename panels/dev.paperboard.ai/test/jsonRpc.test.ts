// JSON-RPC over newline-delimited stdio: lines split across reads, requests
// both ways, and limits that fail loudly.
import { describe, expect, it } from "bun:test";
import { JsonRpcError, JsonRpcPeer, LineBuffer, MAX_PENDING, METHOD_NOT_FOUND } from "../src/service/jsonRpc";

function peer(handlers: Partial<ConstructorParameters<typeof JsonRpcPeer>[1]> = {}) {
    const sent: unknown[] = [];
    const errors: Error[] = [];
    const p = new JsonRpcPeer(
        async (chunk) => {
            for (const line of chunk.split("\n").filter(Boolean)) sent.push(JSON.parse(line));
        },
        {
            onRequest: async () => null,
            onNotification: () => {},
            onProtocolError: (e) => errors.push(e),
            ...handlers,
        },
    );
    return { p, sent, errors };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("line buffer", () => {
    it("joins a line split across reads and splits several in one", () => {
        const b = new LineBuffer();
        expect(b.push('{"a":')).toEqual([]);
        expect(b.push('1}\r\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
        expect(b.push(":3}\n")).toEqual(['{"c":3}']);
    });

    it("refuses a line over its limit", () => {
        const b = new LineBuffer(10);
        b.push("12345");
        expect(() => b.push("678901")).toThrow("exceeded 10 characters");
    });
});

describe("json-rpc peer", () => {
    it("matches replies to requests and turns errors into JsonRpcError", async () => {
        const { p, sent } = peer();
        const ok = p.request("a", { x: 1 });
        const bad = p.request("b", {});
        await tick();
        expect(sent).toEqual([
            { jsonrpc: "2.0", id: 1, method: "a", params: { x: 1 } },
            { jsonrpc: "2.0", id: 2, method: "b", params: {} },
        ]);
        p.receive('{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"auth"}}\n{"jsonrpc":"2.0","id":1,"result":7}\n');
        expect(await ok).toBe(7);
        const err = await bad.catch((e) => e);
        expect(err).toBeInstanceOf(JsonRpcError);
        expect(err.code).toBe(-32000);
    });

    it("answers the other side's requests, including failures", async () => {
        const { p, sent } = peer({
            onRequest: async (method) => {
                if (method === "ok") return { fine: true };
                throw new JsonRpcError(METHOD_NOT_FOUND, "nope");
            },
        });
        p.receive('{"jsonrpc":"2.0","id":"x","method":"ok"}\n{"jsonrpc":"2.0","id":5,"method":"other"}\n');
        await tick();
        await tick();
        expect(sent).toEqual([
            { jsonrpc: "2.0", id: "x", result: { fine: true } },
            { jsonrpc: "2.0", id: 5, error: { code: METHOD_NOT_FOUND, message: "nope" } },
        ]);
    });

    it("closes on output that is not JSON and fails everything waiting", async () => {
        const { p, errors } = peer();
        const waiting = p.request("a", {});
        p.receive("Welcome to my agent!\n");
        await expect(waiting).rejects.toThrow("not JSON");
        expect(errors).toHaveLength(1);
        await expect(p.request("b", {})).rejects.toThrow("not JSON");
    });

    it("bounds the requests waiting on the other side", async () => {
        const { p } = peer();
        for (let i = 0; i < MAX_PENDING; i++) void p.request("a", {}).catch(() => undefined);
        await expect(p.request("a", {})).rejects.toThrow(`More than ${MAX_PENDING} requests`);
        p.close(new Error("done"));
    });
});
