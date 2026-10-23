// The guest agent's relay to stdio MCP servers (agent.py), run for real with
// python3 and a tiny fake server. agent.py as a whole needs an X display, so
// only the relay's own definitions are lifted out of it, as computer.test.ts
// does for _version.

import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER = `
import json, os, sys, time
for line in sys.stdin:
    try:
        m = json.loads(line)
    except ValueError:
        continue
    if "id" not in m:
        continue
    method = m["method"]
    r = {}
    if method == "initialize":
        r = {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "fake"}}
    elif method == "tools/list":
        r = {"tools": [{"name": "echo", "inputSchema": {"type": "object"}}]}
    elif method == "tools/call":
        name = m["params"]["name"]
        args = m["params"].get("arguments") or {}
        if name == "slow":
            time.sleep(float(args.get("s", 1)))
        if name == "crash":
            sys.stderr.write("boom\\n"); sys.stderr.flush(); os._exit(7)
        if name == "flood":
            sys.stdout.write("x" * 5000 + "\\n"); sys.stdout.flush(); time.sleep(5)
        text = os.environ.get("FAKE_X", "") if name == "env" else json.dumps(args)
        r = {"content": [{"type": "text", "text": text}]}
    print("a log line that is not a message", flush=True)
    print(json.dumps({"jsonrpc": "2.0", "method": "notifications/message", "params": {}}), flush=True)
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
`;

const HARNESS = `
import ast, json, os, re, signal, subprocess, sys, threading, time
src = open(sys.argv[1]).read()
want = []
for n in ast.parse(src).body:
    if isinstance(n, ast.ClassDef) and n.name in ("ToolError", "McpServer"):
        want.append(n)
    elif isinstance(n, ast.FunctionDef) and (n.name.startswith("t_mcp_") or n.name == "_mcp_id"):
        want.append(n)
    elif isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "").lower().startswith("mcp_"):
        want.append(n)
ns = {"os": os, "re": re, "json": json, "signal": signal, "subprocess": subprocess, "threading": threading, "HOME": os.path.expanduser("~")}
exec(compile(ast.Module(want, []), "agent.py", "exec"), ns)
ns["MCP_MAX_LINE"] = 1000
server = sys.argv[2]
py = sys.executable
out = {}
Err = ns["ToolError"]

def call(tool, **a):
    try:
        return json.loads(ns[tool](a)["text"])
    except Err as e:
        return {"error": str(e)}

def start(i, env=None, argv=None):
    return ns["t_mcp_start"]({"id": i, "argv": argv or [py, "-I", server], "env": env or {}})

def rpc(i, method, params=None, timeout=5, mid=1):
    m = {"jsonrpc": "2.0", "id": mid, "method": method}
    if params is not None:
        m["params"] = params
    try:
        return json.loads(ns["t_mcp_rpc"]({"id": i, "message": m, "timeout": timeout})["text"])
    except Err as e:
        return {"error": str(e)}

try:
    start("fake", {"FAKE_X": "hello"})
    out["init"] = rpc("fake", "initialize", {})
    out["notification"] = json.loads(ns["t_mcp_rpc"]({"id": "fake", "message": {"jsonrpc": "2.0", "method": "notifications/initialized"}})["text"])
    out["list"] = rpc("fake", "tools/list")
    out["env"] = rpc("fake", "tools/call", {"name": "env", "arguments": {}})

    # two requests with the same id from the service, answered each to its own
    res = {}
    def one(key, name, args):
        res[key] = rpc("fake", "tools/call", {"name": name, "arguments": args}, mid=1)
    ts = [threading.Thread(target=one, args=("slow", "slow", {"s": 0.4})), threading.Thread(target=one, args=("fast", "echo", {"n": 2}))]
    for t in ts: t.start()
    for t in ts: t.join()
    out["concurrent"] = res

    out["timeout"] = rpc("fake", "tools/call", {"name": "slow", "arguments": {"s": 2.5}}, timeout=1)
    out["leftover_waiting"] = len(ns["mcp_servers"]["fake"].waiting)
    time.sleep(2)  # the late answer arrives and is dropped
    out["after_late_answer"] = rpc("fake", "tools/call", {"name": "echo", "arguments": {"k": 1}})
    out["leftover_replies"] = len(ns["mcp_servers"]["fake"].replies)

    out["too_large"] = rpc("fake", "tools/call", {"name": "echo", "arguments": {"t": "x" * 5000}})
    out["crash"] = rpc("fake", "tools/call", {"name": "crash", "arguments": {}})
    out["after_crash"] = rpc("fake", "tools/list")

    # starting again is a fresh server
    start("fake")
    out["restarted"] = rpc("fake", "initialize", {})
    out["count_after_restart"] = len(ns["mcp_servers"])

    # a server flooding one line past the cap is stopped
    out["flood"] = rpc("fake", "tools/call", {"name": "flood", "arguments": {}}, timeout=5)
    pid = ns["mcp_servers"]["fake"].proc.pid

    out["stop"] = ns["t_mcp_stop"]({"id": "fake"})["text"]
    try:
        os.killpg(pid, 0); out["group_gone"] = False
    except ProcessLookupError:
        out["group_gone"] = True
    out["stop_unknown"] = ns["t_mcp_stop"]({"id": "fake"})["text"]
    out["unknown"] = rpc("fake", "tools/list")

    # refusals
    def refused(**a):
        try:
            ns["t_mcp_start"](a); return None
        except Err as e:
            return str(e)
    out["bad_id"] = refused(id="Bad Id", argv=["x"])
    out["bad_argv"] = refused(id="a", argv="ls -la")
    out["flag_argv"] = refused(id="a", argv=["-x"])
    out["bad_env"] = refused(id="a", argv=["x"], env={"A B": "1"})
    out["no_env_value"] = refused(id="a", argv=["x"], env={"A": 1})
    out["too_many_args"] = refused(id="a", argv=["x"] * 34)
    started = 0
    limit = None
    for i in range(9):
        limit = refused(id=f"s{chr(97 + i)}", argv=[py, "-I", server])
        if limit is None: started += 1
    out["started"] = started
    out["limit"] = limit
finally:
    for s in list(ns["mcp_servers"].values()):
        s.stop()
print(json.dumps(out))
`;

describe("the guest relay to stdio MCP servers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-guest-mcp-"));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("starts by argv, relays JSON-RPC, keeps ids apart, stays bounded, stops with its group", () => {
        fs.writeFileSync(path.join(dir, "server.py"), SERVER);
        const agent = path.join(import.meta.dir, "../computer/guest/agent.py");
        const r = Bun.spawnSync(["python3", "-I", "-c", HARNESS, agent, path.join(dir, "server.py")], { env: { ...process.env, HOME: dir } });
        expect(r.stderr.toString()).toBe("");
        const o = JSON.parse(r.stdout.toString());

        expect(o.init.result.serverInfo.name).toBe("fake");
        expect(o.init.id).toBe(1);
        expect(o.notification).toEqual({});
        expect(o.list.result.tools[0].name).toBe("echo");
        expect(o.env.result.content[0].text).toBe("hello"); // the env reached the child as given
        // same id from two callers: each gets its own answer, under its own id
        expect(o.concurrent.slow.id).toBe(1);
        expect(o.concurrent.fast.id).toBe(1);
        expect(o.concurrent.slow.result.content[0].text).toBe('{"s": 0.4}');
        expect(o.concurrent.fast.result.content[0].text).toBe('{"n": 2}');
        // no answer in time is an error, leaves nothing waiting, and the late answer is dropped
        expect(o.timeout.error).toMatch(/didn't answer within 1 s/);
        expect(o.leftover_waiting).toBe(0);
        expect(o.after_late_answer.result.content[0].text).toBe('{"k": 1}');
        expect(o.leftover_replies).toBe(0);
        expect(o.too_large.error).toMatch(/too large/);
        // a crash says how and why; the server stays gone
        expect(o.crash.error).toMatch(/isn't running \(exit 7\): boom/);
        expect(o.after_crash.error).toMatch(/isn't running/);
        expect(o.restarted.result.serverInfo.name).toBe("fake");
        expect(o.count_after_restart).toBe(1);
        expect(o.flood.error).toMatch(/isn't running.*size limit/);
        expect(o.stop).toMatch(/^stopped \(exit/);
        expect(o.group_gone).toBe(true);
        expect(o.stop_unknown).toBe("wasn't running");
        expect(o.unknown.error).toBe("no such server");
        // the relay refuses what isn't an argv list of plain strings
        expect(o.bad_id).toMatch(/lowercase/);
        expect(o.bad_argv).toMatch(/list of up to 33 strings/);
        expect(o.flag_argv).toMatch(/program/);
        expect(o.bad_env).toMatch(/env/);
        expect(o.no_env_value).toMatch(/env/);
        expect(o.too_many_args).toMatch(/list of up to 33/);
        expect(o.started).toBe(8);
        expect(o.limit).toMatch(/at most 8/);
    }, 60_000);
});
