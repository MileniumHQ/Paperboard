// The built-in blocks: Blockly's own math, text and list blocks and this
// panel's flow, time, web and data blocks, run the way the editor saves them.
// Web requests go to a real server on this machine; nothing leaves it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as Blockly from "blockly";
import { BUILTIN_BLOCKS } from "../src/lib/blockDefs";
import { MAX_CALL_DEPTH, runHat, type Host } from "../src/lib/interpreter";
import { webRefusal } from "../src/lib/library";
import { BUILTIN } from "../src/lib/names";
import { block, find, num, saved, steps, text, top, type Json } from "./helpers/workspace";

beforeAll(() => {
    Blockly.common.defineBlocksWithJsonArray(BUILTIN_BLOCKS);
});

function host(read: (entry: string) => unknown = () => undefined) {
    const controller = new AbortController();
    const logs: string[] = [];
    const h: Host = {
        signal: controller.signal,
        run: async () => null,
        read: async (_panel, entry) => read(entry),
        property: async () => undefined,
        log: (message) => {
            logs.push(message);
        },
    };
    return { host: h, logs, stop: () => controller.abort() };
}

const v = (type: string, rest: Json = {}) => block(type, rest);
const log = (expr: Json) => ({ type: BUILTIN.log, inputs: { TEXT: expr } });
const variable = (id: string) => v("variables_get", { fields: { VAR: { id } } });
const set = (id: string, expr: Json) => ({ type: "variables_set", fields: { VAR: { id } }, inputs: { VALUE: expr } });
const list = (...items: Json[]) => v("lists_create_with", { extraState: { itemCount: items.length }, inputs: Object.fromEntries(items.map((item, i) => [`ADD${i}`, item])) });

/** Runs a "When Run is clicked" flow of these steps; resolves with what it logged. */
async function run(stepsOf: Json[], variables: string[] = []): Promise<string[]> {
    const ws = saved(
        [{ type: BUILTIN.onRun, inputs: { DO: steps(...stepsOf) } }],
        variables.map((id) => ({ name: id, id })),
    );
    const h = host();
    await runHat(top(ws, BUILTIN.onRun), null, ws, h.host);
    return h.logs;
}

/** What each expression logs. */
async function values(...exprs: Json[]): Promise<string[]> {
    return run(exprs.map(log));
}

describe("Blockly's own blocks give the answers they show", () => {
    test("math", async () => {
        expect(
            await values(
                v("math_single", { fields: { OP: "ROOT" }, inputs: { NUM: num(81) } }),
                v("math_single", { fields: { OP: "NEG" }, inputs: { NUM: num(4) } }),
                v("math_round", { fields: { OP: "ROUNDUP" }, inputs: { NUM: num(2.1) } }),
                v("math_modulo", { inputs: { DIVIDEND: num(17), DIVISOR: num(5) } }),
                v("math_constrain", { inputs: { VALUE: num(140), LOW: num(1), HIGH: num(100) } }),
                v("math_number_property", { fields: { PROPERTY: "PRIME" }, inputs: { NUMBER_TO_CHECK: num(13) } }),
                v("math_on_list", { fields: { OP: "AVERAGE" }, extraState: '<mutation op="AVERAGE"></mutation>', inputs: { LIST: list(num(2), num(4), num(9)) } }),
                v("math_on_list", { fields: { OP: "MEDIAN" }, extraState: '<mutation op="MEDIAN"></mutation>', inputs: { LIST: list(num(5), num(1), num(3), num(2)) } }),
            ),
        ).toEqual(["9", "-4", "3", "2", "100", "true", "5", "2.5"]);
    });

    test("text", async () => {
        const hello = text("  Hello, World  ");
        expect(
            await values(
                v("text_trim", { fields: { MODE: "BOTH" }, inputs: { TEXT: hello } }),
                v("text_changeCase", { fields: { CASE: "TITLECASE" }, inputs: { TEXT: text("the quick FOX") } }),
                v("text_replace", { inputs: { FROM: text("o"), TO: text("0"), TEXT: text("foo boo") } }),
                v("text_indexOf", { fields: { END: "LAST" }, inputs: { VALUE: text("banana"), FIND: text("an") } }),
                v("text_charAt", { fields: { WHERE: "FROM_END" }, extraState: '<mutation at="true"></mutation>', inputs: { VALUE: text("abcdef"), AT: num(2) } }),
                v("text_getSubstring", {
                    fields: { WHERE1: "FROM_START", WHERE2: "FROM_START" },
                    extraState: '<mutation at1="true" at2="true"></mutation>',
                    inputs: { STRING: text("Paperboard"), AT1: num(1), AT2: num(5) },
                }),
                v("text_count", { inputs: { SUB: text("a"), TEXT: text("banana") } }),
                v("text_reverse", { inputs: { TEXT: text("abc") } }),
            ),
        ).toEqual(["Hello, World", "The Quick Fox", "f00 b00", "4", "e", "Paper", "3", "cba"]);
    });

    test("lists", async () => {
        const fruit = (id: string) => set(id, list(text("pear"), text("apple"), text("fig")));
        expect(
            await run(
                [
                    fruit("f"),
                    log(v("lists_getIndex", { fields: { MODE: "GET", WHERE: "FROM_START" }, extraState: '<mutation statement="false" at="true"></mutation>', inputs: { VALUE: variable("f"), AT: num(2) } })),
                    { type: "lists_getIndex", fields: { MODE: "REMOVE", WHERE: "FIRST" }, extraState: '<mutation statement="true" at="false"></mutation>', inputs: { VALUE: variable("f") } },
                    { type: "lists_setIndex", fields: { MODE: "INSERT", WHERE: "LAST" }, extraState: '<mutation at="false"></mutation>', inputs: { LIST: variable("f"), TO: text("kiwi") } },
                    log(variable("f")),
                    log(v("lists_sort", { fields: { TYPE: "TEXT", DIRECTION: "-1" }, inputs: { LIST: variable("f") } })),
                    log(v("lists_indexOf", { fields: { END: "FIRST" }, inputs: { VALUE: variable("f"), FIND: text("fig") } })),
                    log(v("lists_split", { fields: { MODE: "JOIN" }, extraState: '<mutation mode="JOIN"></mutation>', inputs: { INPUT: variable("f"), DELIM: text(" + ") } })),
                    log(v("lists_split", { fields: { MODE: "SPLIT" }, extraState: '<mutation mode="SPLIT"></mutation>', inputs: { INPUT: text("a,b,c"), DELIM: text(",") } })),
                ],
                ["f"],
            ),
        ).toEqual(["apple", '["apple","fig","kiwi"]', '["kiwi","fig","apple"]', "2", "apple + fig + kiwi", '["a","b","c"]']);
    });

    test("a position past the end fails on that block with what it looked for", async () => {
        const ws = saved([
            {
                type: BUILTIN.onRun,
                inputs: { DO: steps(log(v("lists_getIndex", { fields: { MODE: "GET", WHERE: "FROM_START" }, extraState: '<mutation statement="false" at="true"></mutation>', inputs: { VALUE: list(text("a")), AT: num(3) } }))) },
            },
        ]);
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, host().host).catch((e) => e);
        expect(err.message).toBe("There's no #3 in a list of 1");
        expect(err.blockId).toBe(find(ws, "lists_getIndex").id);
    });
});

describe("this panel's blocks", () => {
    test("text checks, numbers from text, patterns, base64 and JSON", async () => {
        expect(
            await values(
                v(BUILTIN.textTest, { fields: { OP: "STARTS" }, inputs: { TEXT: text("Paperboard"), PART: text("Paper") } }),
                v(BUILTIN.toNumber, { inputs: { TEXT: text(" 42.5 ") } }),
                v(BUILTIN.regexTest, { inputs: { TEXT: text("abc123"), PATTERN: text("\\d+$") } }),
                v(BUILTIN.regexFind, { inputs: { PATTERN: text("id=(\\w+)"), TEXT: text("?id=steve&x=1") } }),
                v(BUILTIN.base64, { fields: { MODE: "DECODE" }, inputs: { TEXT: v(BUILTIN.base64, { fields: { MODE: "ENCODE" }, inputs: { TEXT: text("héllo ✓") } }) } }),
                v(BUILTIN.getKey, { inputs: { KEY: text("name"), OBJECT: v(BUILTIN.jsonParse, { inputs: { TEXT: text('{"name":"Survival","players":[1,2]}') } }) } }),
                v(BUILTIN.jsonText, { inputs: { VALUE: list(num(1), text("two")) } }),
            ),
        ).toEqual(["true", "42.5", "true", "steve", "héllo ✓", "Survival", '[1,"two"]']);
    });

    test("time: adding to a moment, and reading it back", async () => {
        const moment = Date.UTC(2026, 0, 31, 12, 0, 0);
        expect(
            await values(
                v(BUILTIN.timeFormat, { fields: { FORMAT: "ISO" }, inputs: { TIME: v(BUILTIN.timeAdd, { fields: { UNIT: "DAYS" }, inputs: { AMOUNT: num(2), TIME: num(moment) } }) } }),
                v(BUILTIN.timePart, { fields: { PART: "YEAR" }, inputs: { TIME: num(moment) } }),
            ),
        ).toEqual(["2026-02-02T12:00:00.000Z", "2026"]);
        const [now] = await values(v(BUILTIN.now));
        expect(Math.abs(Number(now) - Date.now())).toBeLessThan(5_000);
    });

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

    test("the error message outside If it fails is an error on that block", async () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps(log(v(BUILTIN.errorMessage))) } }]);
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, host().host).catch((e) => e);
        expect(err.message).toBe('The error message only exists inside "if it fails"');
        expect(err.blockId).toBe(find(ws, BUILTIN.errorMessage).id);
    });

    test("Wait until checks again until its condition holds", async () => {
        let reads = 0;
        const value = "pb.value|dev.test.game|value.ready";
        Blockly.common.defineBlocksWithJsonArray([{ type: value, message0: "ready", output: "Boolean" }]);
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps({ type: BUILTIN.waitUntil, inputs: { BOOL: v(value) } }, log(text("ready"))) } }]);
        const h = host(() => ++reads >= 3);
        await runHat(top(ws, BUILTIN.onRun), null, ws, h.host);
        expect(reads).toBe(3);
        expect(h.logs).toEqual(["ready"]);
    });
});

describe("functions", () => {
    const n = v("variables_get", { fields: { VAR: { id: "n" } } });
    const factCall = (arg: Json) => v("procedures_callreturn", { extraState: { name: "fact", params: ["n"] }, inputs: { ARG0: arg } });
    // fact(n): if n <= 1 return 1; otherwise give back n * fact(n - 1)
    const fact = {
        type: "procedures_defreturn",
        x: 400,
        fields: { NAME: "fact" },
        extraState: { params: [{ name: "n", id: "n" }] },
        inputs: {
            STACK: steps({
                type: "procedures_ifreturn",
                inputs: { CONDITION: v("logic_compare", { fields: { OP: "LTE" }, inputs: { A: n, B: num(1) } }), VALUE: num(1) },
            }),
            RETURN: v("math_arithmetic", {
                fields: { OP: "MULTIPLY" },
                inputs: { A: n, B: factCall(v("math_arithmetic", { fields: { OP: "MINUS" }, inputs: { A: n, B: num(1) } })) },
            }),
        },
    };

    async function runWith(definitions: Json[], stepsOf: Json[], variables: string[] = []) {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps(...stepsOf) } }, ...definitions], variables.map((id) => ({ name: id, id })));
        const h = host();
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, h.host).then(
            () => null,
            (e: unknown) => e as Error & { blockId: string },
        );
        return { logs: h.logs, err, ws };
    }

    test("a function gives back a value, calls itself, and leaves the caller's variables as they were", async () => {
        const { logs, err } = await runWith([fact], [set("n", num(7)), log(factCall(num(5))), log(n)], ["n"]);
        expect(err).toBeNull();
        expect(logs).toEqual(["120", "7"]);
    });

    test("a function without a value runs its steps where it's called", async () => {
        const greet = { type: "procedures_defnoreturn", x: 400, fields: { NAME: "greet" }, inputs: { STACK: steps(log(text("hello"))) } };
        const { logs } = await runWith([greet], [{ type: "procedures_callnoreturn", extraState: { name: "greet" } }, log(text("after"))]);
        expect(logs).toEqual(["hello", "after"]);
    });

    test("a function that never stops calling itself fails on the call, not the service", async () => {
        const forever = {
            type: "procedures_defnoreturn",
            x: 400,
            fields: { NAME: "forever" },
            inputs: { STACK: steps({ type: "procedures_callnoreturn", extraState: { name: "forever" } }) },
        };
        const { err } = await runWith([forever], [{ type: "procedures_callnoreturn", extraState: { name: "forever" } }]);
        expect(err?.message).toBe(`Functions called each other ${MAX_CALL_DEPTH} deep, so the run stopped`);
    });

    test("calling a function that was deleted names it", async () => {
        const { err } = await runWith([], [{ type: "procedures_callnoreturn", extraState: { name: "gone" } }]);
        expect(err?.message).toBe('There\'s no function called "gone"');
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

    test("an answer that isn't 2xx fails the block", async () => {
        const ws = saved([{ type: BUILTIN.onRun, inputs: { DO: steps(log(v(BUILTIN.webGet, { fields: { AS: "TEXT" }, inputs: { URL: text(`${base}/missing`) } }))) } }]);
        const err = await runHat(top(ws, BUILTIN.onRun), null, ws, host().host).catch((e) => e);
        expect(err.message).toBe(`GET ${base}/missing answered 404 Not Found`);
        expect(err.blockId).toBe(find(ws, BUILTIN.webGet).id);
    });

    test("plain http reaches only this computer, and only web addresses are fetched", () => {
        expect(webRefusal("http://127.0.0.1:8080/x")).toBeNull();
        expect(webRefusal("https://example.com/api")).toBeNull();
        expect(webRefusal("http://example.com/api")).toBe("Plain http only reaches this computer; use https for example.com");
        expect(webRefusal("file:///etc/passwd")).toBe("Only https web addresses work, not file:");
        expect(webRefusal("not a url")).toBe('"not a url" isn\'t a web address');
    });
});
