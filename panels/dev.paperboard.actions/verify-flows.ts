import { executeFlow } from "./src/lib/runtime.ts";
import { BUILTIN_CATEGORIES } from "./src/lib/builtins.ts";

let failures = 0;
function check(name: string, actual: any, expected: any) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`PASS ${name} => ${a}`);
    } else {
        failures++;
        console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
    }
}

function schemaFor(id: string): any {
    for (const cat of BUILTIN_CATEGORIES) {
        for (const item of (cat as any).items || []) {
            if (item.action === id) return item.schema;
        }
    }
    throw new Error(`no schema for ${id}`);
}

let n = 0;
const blk = (actionId: string, values: Record<string, any> = {}, children?: any[]) => ({
    id: `b${++n}_${actionId}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: schemaFor(actionId),
    values,
    ...(children ? { children } : {}),
});
const trig = (children: any[], payload?: any) => ({
    block: {
        id: "trig",
        panelId: "builtin.logic",
        pos: { x: 0, y: 0 },
        isTrigger: true,
        action: { id: "chat-message", name: "x", output: { type: "object", label: "Message" } },
        values: {},
        children,
    },
    payload: payload || {},
});

// Local HTTP server for the web blocks (real fetch, real round-trip).
const server = Bun.serve({
    port: 18765,
    fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/motd" && req.method === "GET") {
            return new Response("Welcome to Paperboard!");
        }
        if (url.pathname === "/echo" && req.method === "POST") {
            return req.text().then((t) => new Response(`got:${t}`));
        }
        return new Response("nf", { status: 404 });
    },
});

// Flow 1: user command handling — "!ip" message -> templated reply parts.
{
    const { block, payload } = trig(
        [
            blk("text-contains", { text: "{{content:Content:chat}}", substring: "!ip" }),
            {
                ...blk("if", { left: "{{output:Contains:search}}", operator: "is-true", right: "" }, [
                    blk("text", { value: "Server IP: play.example.com\nPort: 25565" }),
                    blk("text-replace", {
                        text: "{{output:Text:notes}}",
                        find: "play.example.com",
                        replacement: "mc.example.com",
                    }),
                    blk("set-variable", { key: "last_reply", value: "{{output:Replaced Text:find_replace}}" }),
                ]),
                id: "b_if",
            },
            blk("get-variable", { key: "last_reply" }),
        ],
        { content: "hey !ip please", author: "Steve", channelId: "123" },
    );
    const log = await executeFlow(block as any, payload);
    check("flow1 status", log.status, "success");
    const steps = Object.fromEntries(log.steps.map((s) => [s.actionName, s.result]));
    check("flow1 contains", steps["Text Contains"], true);
    check("flow1 replaced", steps["Replace Text"], "Server IP: mc.example.com\nPort: 25565");
    check("flow1 variable round-trip", steps["Get Variable"], "Server IP: mc.example.com\nPort: 25565");
}

// Flow 2: counter + clamp + date math + fallback.
{
    const { block } = trig([
        blk("increment-variable", { key: "joins", amount: "1" }),
        blk("increment-variable", { key: "joins", amount: "1" }),
        blk("math-clamp", { value: "{{output:joins:exposure}}", min: "0", max: "1" }),
        blk("now-timestamp", {}),
        blk("add-time", { timestamp: "{{output:Timestamp:schedule}}", amount: "90", unit: "minutes" }),
        blk("coalesce", { first: "   ", second: "welcome!" }),
    ]);
    const log = await executeFlow(block as any, {});
    check("flow2 status", log.status, "success");
    const steps = Object.fromEntries(log.steps.map((s) => [s.actionName, s.result]));
    check("flow2 counter", steps["Increment Variable"], 2);
    check("flow2 clamp", steps["Clamp Number"], 1);
    check("flow2 add-time delta", steps["Add Time"] - (log.steps.find((s) => s.actionName === "Current Time")?.result || 0), 5400000);
    check("flow2 coalesce", steps["First Value"], "welcome!");
}

// Flow 3: user-defined functions — greeting builder called twice + nesting.
{
    const greetBody = [
        blk("text-join", { text1: "Hello, ", text2: "{{player:Player:person}}" }),
        blk("text-uppercase", { text: "{{output:Joined Text:join}}" }),
    ];
    const excitedBody = [
        blk("text-join", { text1: "{{inner:Text:notes}}", text2: "!!!" }),
    ];
    const hooks = {
        getFunctionBody: (fid: string) =>
            fid === "greet" ? greetBody : fid === "excited" ? excitedBody : null,
        getFunctionName: (fid: string) => fid,
    };
    const callOf = (fid: string, values: any, tag: string) => ({
        id: `call_${tag}`,
        panelId: "builtin.function",
        pos: { x: 0, y: 0 },
        isTrigger: false,
        action: {
            id: `call-function-${fid}`,
            name: fid,
            inputs: Object.fromEntries(Object.keys(values).map((k) => [k, { type: "string" }])),
            output: { type: "string", label: "Result" },
        },
        values,
    });
    const { block } = trig([
        callOf("greet", { player: "alex" }, "a"),
        callOf("greet", { player: "sam" }, "b"),
        callOf("excited", { inner: "{{call_b:Result:functions}}" }, "c"),
    ]);
    const log = await executeFlow(block as any, {}, undefined, undefined, undefined, hooks as any);
    check("flow3 status", log.status, "success");
    const results = log.steps.filter((s) => s.actionName.startsWith("Call ")).map((s) => s.result);
    check("flow3 greetings", results, ["HELLO, ALEX", "HELLO, SAM", "HELLO, SAM!!!"]);
}

// Flow 4: real HTTP GET + POST against localhost.
{
    const { block } = trig([
        blk("http-get", { url: "http://127.0.0.1:18765/motd" }),
        blk("http-post", { url: "http://127.0.0.1:18765/echo", body: "{\"hi\":1}" }),
        blk("http-get", { url: "http://127.0.0.1:18765/nope" }),
    ]);
    const log = await executeFlow(block as any, {});
    check("flow4 status", log.status, "error");
    const first = (name: string) => log.steps.find((s) => s.actionName === name)?.result;
    const steps = Object.fromEntries(log.steps.map((s) => [s.actionName, s.result]));
    check("flow4 get", first("Get URL Content"), "Welcome to Paperboard!");
    check("flow4 post", steps["Post to URL"], 'got:{"hi":1}');
    check("flow4 404 fails loudly", (log.message || "").includes("404"), true);
}

// Flow 5: repeat loop + stop-flow halts the tail.
{
    const { block } = trig([
        blk("repeat", { count: "3" }, [
            blk("increment-variable", { key: "loops", amount: "1" }),
        ]),
        blk("stop-flow", {}),
        blk("set-variable", { key: "should_not_exist", value: "x" }),
    ]);
    // reset counter first
    await executeFlow(
        trig([blk("set-variable", { key: "loops", value: "0" })]).block as any, {},
    );
    const log = await executeFlow(block as any, {});
    check("flow5 stopped-early status", log.status, "success");
    const checkLog = await executeFlow(
        trig([blk("get-variable", { key: "loops" })]).block as any, {},
    );
    check("flow5 ran 3 times", checkLog.steps[0]?.result, 3);
    const checkLog2 = await executeFlow(
        trig([blk("get-variable", { key: "should_not_exist" })]).block as any, {},
    );
    check("flow5 tail skipped", checkLog2.steps[0]?.result, "");
}

server.stop();
if (failures > 0) {
    console.log(`\n${failures} FAILURE(S)`);
    process.exit(1);
}
console.log("\nAll user flows pass.");
process.exit(0);
