// This panel's flow-control and web blocks, run the way the editor saves them.
// Web requests go to a real server on this machine; nothing leaves it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import { BUILTIN_BLOCKS } from "../src/lib/blockDefs";
import { runHat, type Host } from "../src/lib/interpreter";
import { WEB_MAX_CHARS, web, webRefusal } from "../src/lib/library";
import { BUILTIN } from "../src/lib/names";
import { scheduleOf } from "../src/lib/schedule";
import { block, num, saved, steps, text, top, type Json } from "./helpers/workspace";
import { memoryData } from "./helpers/data";

beforeAll(() => {
    Blockly.common.defineBlocksWithJsonArray(BUILTIN_BLOCKS);
});

function host() {
    const controller = new AbortController();
    const logs: string[] = [];
    const h: Host = {
        signal: controller.signal,
        run: async () => null,
        read: async () => undefined,
        property: async () => undefined,
        log: (message) => {
            logs.push(message);
        },
        data: memoryData(),
    };
    return { host: h, logs };
}

const v = (type: string, rest: Json = {}) => block(type, rest);
const log = (expr: Json) => ({ type: BUILTIN.log, inputs: { TEXT: expr } });
const list = (...items: Json[]) => v("lists_create_with", { extraState: { itemCount: items.length }, inputs: Object.fromEntries(items.map((item, i) => [`ADD${i}`, item])) });

/** Runs a "When Run is clicked" flow of these steps; resolves with what it logged. */
async function run(stepsOf: Json[]): Promise<string[]> {
    const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps(...stepsOf) } }]);
    const h = host();
    await runHat(top(ws, BUILTIN.onRun), null, ws, h.host);
    return h.logs;
}

/** What each expression logs. */
async function values(...exprs: Json[]): Promise<string[]> {
    return run(exprs.map(log));
}

describe("this panel's blocks", () => {
    test("If it fails catches a failure, with its message, and the flow goes on", async () => {
        expect(
            await run([
                {
                    type: BUILTIN.attempt,
                    inputs: {
                        DO: steps({ type: BUILTIN.fail, inputs: { MESSAGE: text("the server is offline") } }, log(text("not reached"))),
                        CATCH: steps(log(v(BUILTIN.errorMessage))),
                    },
                },
                log(text("after")),
            ]),
        ).toEqual(["the server is offline", "after"]);
    });

    test("Stop this flow ends the run quietly, even inside a loop and a try", async () => {
        expect(
            await run([
                {
                    type: "controls_repeat_ext",
                    inputs: {
                        TIMES: num(5),
                        DO: steps({ type: BUILTIN.attempt, inputs: { DO: steps(log(text("once")), { type: BUILTIN.stop }), CATCH: steps(log(text("caught"))) } }),
                    },
                },
                log(text("after")),
            ]),
        ).toEqual(["once"]);
    });
});

describe("text and list blocks real flows need", () => {
    test("pad fills one end to a length, with spaces when given nothing, and leaves longer text be", async () => {
        const pad = (t: string, length: number, side: string, with_: string) => v(BUILTIN.textPad, { fields: { SIDE: side }, inputs: { TEXT: text(t), LENGTH: num(length), WITH: text(with_) } });
        expect(await values(pad("7", 3, "START", "0"), pad("ab", 4, "END", ""), pad("12345", 3, "START", "0"))).toEqual(["007", "ab  ", "12345"]);
        await expect(values(pad("7", 2.5, "START", "0"))).rejects.toThrow("Pad to a whole number of characters");
    });

    test("a number is written with its decimals, with or without separators", async () => {
        const format = (n: number, decimals: number, grouping: string) => v(BUILTIN.numberFormat, { fields: { GROUPING: grouping }, inputs: { NUMBER: num(n), DECIMALS: num(decimals) } });
        const [grouped, plain, whole] = await values(format(1234567.891, 2, "GROUPED"), format(1234.5, 2, "PLAIN"), format(2.5, 0, "PLAIN"));
        // the separators are this computer's: the digits and their grouping are what's checked
        expect(grouped).toMatch(/^1\D234\D567\D89$/);
        expect(plain).toMatch(/^1234\D50$/);
        expect(whole).toBe("3");
        await expect(values(format(1, -1, "PLAIN"))).rejects.toThrow("whole number of decimals");
    });

    test("for each with its position goes over the list from 1, and Break still leaves it", async () => {
        const item = { id: "v-item", name: "item" };
        const position = { id: "v-at", name: "position" };
        const get = (id: string) => v("variables_get", { fields: { VAR: { id } } });
        const ws = saved(
            [
                {
                    type: BUILTIN.onRun,
                    inputs: {
                        DO: steps({
                            type: BUILTIN.forEachAt,
                            fields: { ITEM: { id: item.id }, AT: { id: position.id } },
                            inputs: {
                                LIST: list(text("a"), text("b"), text("c")),
                                DO: steps(
                                    log(v("text_join", { extraState: { itemCount: 3 }, inputs: { ADD0: get(position.id), ADD1: text(". "), ADD2: get(item.id) } })),
                                    { type: "controls_if", inputs: { IF0: v(BUILTIN.textTest, { fields: { OP: "CONTAINS" }, inputs: { TEXT: get(item.id), PART: text("b") } }), DO0: steps({ type: "controls_flow_statements", fields: { FLOW: "BREAK" } }) } },
                                ),
                            },
                        }),
                    },
                },
            ],
            [item, position],
        );
        const h = host();
        await runHat(top(ws, BUILTIN.onRun), null, ws, h.host);
        expect(h.logs).toEqual(["1. a", "2. b"]);
    });
});

describe("schedule hats", () => {
    test("save their schedule as the service reads it, a time typed loosely is cleaned, and the next-run row isn't saved", () => {
        const ws = new Blockly.Workspace();
        try {
            const hat = ws.newBlock(BUILTIN.onDays);
            hat.setFieldValue("FRI", "DAYS");
            hat.setFieldValue("4:5", "TIME");
            hat.setFieldValue("not a time", "TIME");
            const every = ws.newBlock(BUILTIN.every);
            every.setFieldValue("90", "EVERY");
            const saved = Blockly.serialization.workspaces.save(ws).blocks.blocks as { type: string; fields: Record<string, unknown> }[];
            expect(saved.map((b) => b.fields)).toEqual([{ DAYS: "FRI", TIME: "04:05" }, { EVERY: 90, UNIT: "MINUTES" }]);
            expect(saved.map((b) => scheduleOf(b))).toEqual([
                { kind: "at", hour: 4, minute: 5, days: [5] },
                { kind: "every", ms: 90 * 60_000 },
            ]);
        } finally {
            ws.dispose();
        }
    });
});

describe("web blocks", () => {
    let server: ReturnType<typeof Bun.serve>;
    let base: string;
    beforeAll(() => {
        server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: async (req) => {
                const path = new URL(req.url).pathname;
                if (path === "/status") return Response.json({ online: 3, name: "Survival" });
                if (path === "/echo") return Response.json({ got: await req.json() });
                // an answer that never ends, a megabyte at a time
                if (path === "/endless") return new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1_000_000).fill(97)) }));
                return new Response("nope", { status: 404, statusText: "Not Found" });
            },
        });
        base = `http://127.0.0.1:${server.port}`;
    });
    afterAll(() => server.stop(true));

    test("get reads JSON from this computer, and post sends a value as JSON", async () => {
        expect(
            await values(
                v(BUILTIN.getKey, { inputs: { KEY: text("online"), OBJECT: v(BUILTIN.webGet, { fields: { AS: "JSON" }, inputs: { URL: text(`${base}/status`) } }) } }),
                v(BUILTIN.webPost, { fields: { AS: "TEXT" }, inputs: { BODY: list(num(1), text("a")), URL: text(`${base}/echo`) } }),
            ),
        ).toEqual(["3", '{"got":[1,"a"]}']);
    });

    test("an answer longer than the most a block takes fails, and is read no further", async () => {
        await expect(web("GET", `${base}/endless`, null, "TEXT", new AbortController().signal)).rejects.toThrow(`${base}/endless answered with more than ${WEB_MAX_CHARS} characters`);
    });

    test("plain http reaches only this computer, and only web addresses are fetched", () => {
        expect(webRefusal("http://127.0.0.1:8080/x")).toBeNull();
        expect(webRefusal("https://example.com/api")).toBeNull();
        expect(webRefusal("http://example.com/api")).toBe("Plain http only reaches this computer; use https for example.com");
        expect(webRefusal("file:///etc/passwd")).toBe("Only https web addresses work, not file:");
        expect(webRefusal("not a url")).toBe('"not a url" isn\'t a web address');
    });
});
