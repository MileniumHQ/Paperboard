// A stand-in for the Codex, Claude Code and OpenCode CLIs at the boundary the
// panel uses: argv, environment, stdin, stdout, stderr and exit code. Which
// one it is comes from its file name (codex, claude, opencode). Its sign-in
// pages are the captured transcripts in test/fixtures.
//
// Cues are read from the message's last paragraph only: a compacted conversation's
// seed quotes earlier messages, and their cues aren't for this turn.
// It logs every run to $FAKE_DIR/calls.jsonl, reads what to do from
// $FAKE_DIR/plan.json, and takes cues from the message it's given:
//   [[hold]]   say {"type":"fake.holding"} and wait for SIGTERM or $FAKE_DIR/release
//   [[fail]]   print to stderr and exit 1
//   [[silent]] end without a reply
//   [[tools]]  list the panel's MCP tools with the token from the environment
//   [[big]]    report a context past any budget
//   [[notloggedin]] (Claude) Claude's own "Not logged in" reply

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FAKE_DIR = process.env.FAKE_DIR;
if (!FAKE_DIR) {
    process.stderr.write("fake brain: FAKE_DIR isn't set\n");
    process.exit(70);
}
// the captured transcripts; this file is copied into packages, so their folder comes from the environment
const fixturesDir = process.env.FAKE_FIXTURES;
const name = path.basename(process.argv[1]).replace(/\.(mjs|exe)$/, "");
const argv = process.argv.slice(2);
const planFile = path.join(FAKE_DIR, "plan.json");
const plan = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, "utf8")) : {};

const ENV_KEYS = /^(CODEX_HOME|CLAUDE_CONFIG_DIR|XDG_\w+|DISABLE_\w+|CLAUDE_CODE_\w+|OPENCODE_\w+|BROWSER|PAPERBOARD_COMPUTER_MCP_TOKEN)$/;
function log(entry) {
    fs.appendFileSync(path.join(FAKE_DIR, "calls.jsonl"), JSON.stringify({ name, ...entry }) + "\n");
}
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ENV_KEYS.test(k)));
log({ event: "run", argv, env, cwd: process.cwd() });

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (argv[0] === "--version") {
    // plan.versionFails: a program that is on the computer but won't run
    if (plan.versionFails) {
        process.stderr.write("fake brain: cannot start\n");
        process.exit(3);
    }
    process.stdout.write(`${name} 9.8.7\n`);
    process.exit(0);
}

/** stdin to its end, the way `codex exec` reads a piped input before it starts */
function readAll() {
    return new Promise((ok) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (d) => (data += d));
        process.stdin.on("end", () => ok(data));
        process.stdin.on("error", () => ok(data));
    });
}

function hold(file = "release") {
    return new Promise((ok) => {
        process.on("SIGTERM", () => {
            log({ event: "sigterm" });
            process.exit(143);
        });
        out({ type: "fake.holding" });
        const timer = setInterval(() => {
            if (!fs.existsSync(path.join(FAKE_DIR, file))) return;
            fs.rmSync(path.join(FAKE_DIR, file), { force: true });
            clearInterval(timer);
            ok();
        }, 10);
    });
}

async function listTools(url) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.PAPERBOARD_COMPUTER_MCP_TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const body = await res.json();
    log({ event: "tools", status: res.status, tools: (body.result?.tools ?? []).map((t) => t.name) });
}

const fixture = (f) => fs.readFileSync(path.join(fixturesDir, f), "utf8");

// ------------------------------------------------------------------ Codex

async function codex() {
    const home = process.env.CODEX_HOME;
    const auth = home ? path.join(home, "auth.json") : null;
    if (argv[0] === "login" && argv[1] === "status") {
        if (plan.status) {
            process.stdout.write(plan.status.stdout ?? "");
            process.stderr.write(plan.status.stderr ?? "");
            process.exit(plan.status.exit);
        }
        if (auth && fs.existsSync(auth)) {
            process.stdout.write("Logged in using ChatGPT\n");
            process.exit(0);
        }
        process.stderr.write("Not logged in\n");
        process.exit(1);
    }
    if (argv[0] === "logout") {
        if (auth) fs.rmSync(auth, { force: true });
        process.exit(0);
    }
    if (argv[0] === "login" && argv[1] === "--device-auth") {
        process.stdout.write(fixture("codexDeviceAuth.txt"));
        await hold();
        process.exit(0);
    }
    if (argv[0] === "login") {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, "http://127.0.0.1");
            log({ event: "callback", path: url.pathname, query: url.search });
            if (url.pathname !== "/auth/callback" || !url.searchParams.get("code")) {
                res.writeHead(400).end("<p>bad request</p>");
                return;
            }
            fs.writeFileSync(auth, JSON.stringify({ signedIn: true }));
            res.writeHead(302, { location: "/success" }).end();
            server.close(() => process.exit(0));
        });
        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            process.stdout.write(fixture("codexLogin.txt").replaceAll("1455", String(port)));
        });
        return;
    }
    if (argv[0] === "debug" && argv[1] === "models") {
        process.stdout.write(plan.models?.stdout ?? "");
        process.stderr.write(plan.models?.stderr ?? "");
        process.exit(plan.models?.exit ?? 0);
    }
    if (argv[0] === "exec") {
        await readAll();
        const dash = argv.indexOf("--");
        const message = dash >= 0 ? argv[dash + 1] : argv.at(-1);
        const thread = argv[1] === "resume" ? argv.at(-2) : `codex-${randomUUID()}`;
        log({ event: "turn", thread, resumed: argv[1] === "resume", message });
        out({ type: "thread.started", thread_id: thread });
        // its rollout, appended to on every resume: the only place each request's token count is
        if (!argv.includes("--ephemeral")) {
            const day = path.join(home, "sessions", "2026", "11", "09");
            fs.mkdirSync(day, { recursive: true });
            const used = newest(message).includes("[[big]]") ? 500_000 : 100;
            const count = { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: used, output_tokens: 10 }, model_context_window: 400_000 } } };
            fs.appendFileSync(path.join(day, `rollout-2026-11-09T12-00-00-${thread}.jsonl`), '{"type":"session_meta"}\n' + JSON.stringify(count) + "\n");
        }
        if (message.startsWith("[from Paperboard, not the user] This conversation has grown long")) {
            out({ type: "item.completed", item: { type: "agent_message", text: "SUMMARY: the user likes trains" } });
            process.exit(0);
        }
        await cues(message, () => {
            const urlArg = argv.find((a) => a.startsWith("mcp_servers.paperboard.url="));
            return urlArg ? JSON.parse(urlArg.slice("mcp_servers.paperboard.url=".length)) : null;
        });
        if (newest(message).includes("[[silent]]")) process.exit(0);
        out({ type: "item.completed", item: { type: "agent_message", text: plan.reply ?? `ok: ${message.slice(-20)}` } });
        process.exit(0);
    }
    process.stderr.write(`fake codex: unknown command ${argv.join(" ")}\n`);
    process.exit(64);
}

/** what every turn does with the cues in its message */
const newest = (message) => message.split("\n\n").at(-1);

async function cues(full, mcpUrl) {
    const message = newest(full);
    if (message.includes("[[fail]]")) {
        process.stderr.write("the brain fell over\n");
        process.exit(1);
    }
    if (message.includes("[[tools]]")) await listTools(mcpUrl());
    if (message.includes("[[hold]]")) await hold();
}

// ------------------------------------------------------------------ Claude Code

async function claude() {
    const home = process.env.CLAUDE_CONFIG_DIR;
    const marker = home ? path.join(home, "signed-in") : null;
    if (argv[0] === "auth" && argv[1] === "status") {
        process.stdout.write(JSON.stringify(marker && fs.existsSync(marker) ? { loggedIn: true, email: "user@example.com" } : { loggedIn: false }));
        process.exit(0);
    }
    if (argv[0] === "auth" && argv[1] === "logout") {
        if (marker) fs.rmSync(marker, { force: true });
        process.exit(0);
    }
    if (argv[0] === "auth" && argv[1] === "login") {
        process.stdout.write(fixture("claudeLogin.txt"));
        let got = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (d) => {
            got += d;
            log({ event: "stdin", data: d });
            if (got.includes("\n")) {
                fs.writeFileSync(marker, "");
                process.exit(0);
            }
        });
        return;
    }
    if (argv.includes("--input-format")) {
        // the models question: an initialize request over stream-json, answered, then wait to be stopped
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (d) => {
            buf += d;
            for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
                const msg = JSON.parse(buf.slice(0, i));
                buf = buf.slice(i + 1);
                if (msg.type === "control_request" && msg.request?.subtype === "initialize") {
                    out({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response: { models: plan.claudeModels ?? [] } } });
                }
            }
        });
        process.on("SIGTERM", () => process.exit(0));
        return;
    }
    if (argv[0] === "-p") {
        await readAll();
        const dash = argv.indexOf("--");
        const message = dash >= 0 ? argv[dash + 1] : argv.at(-1);
        const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
        const session = at("--resume") ?? at("--session-id");
        log({ event: "turn", thread: session, resumed: argv.includes("--resume"), message });
        const summarizing = message.startsWith("[from Paperboard, not the user] This conversation has grown long");
        if (summarizing) {
            if (plan.summaryFails) {
                process.stderr.write("couldn't summarize\n");
                process.exit(1);
            }
            if (plan.holdSummary) await hold();
            out({ type: "assistant", message: { usage: { input_tokens: 10 }, content: [{ type: "text", text: "SUMMARY: the user likes trains" }] } });
            out({ type: "result", is_error: false, modelUsage: { m: { contextWindow: 200000 } } });
            process.exit(0);
        }
        if (newest(message).includes("[[notloggedin]]")) {
            out({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] } });
            out({ type: "result", is_error: true, result: "Not logged in · Please run /login" });
            process.exit(1);
        }
        await cues(message, () => {
            const config = JSON.parse(at("--mcp-config"));
            return config.mcpServers.paperboard.url;
        });
        if (newest(message).includes("[[silent]]")) process.exit(0);
        const used = newest(message).includes("[[big]]") ? 500_000 : 100;
        out({ type: "assistant", message: { usage: { input_tokens: used }, content: [{ type: "text", text: plan.reply ?? "ok" }] } });
        out({ type: "result", is_error: false, modelUsage: { m: { contextWindow: 1_000_000 } } });
        process.exit(0);
    }
    process.stderr.write(`fake claude: unknown command ${argv.join(" ")}\n`);
    process.exit(64);
}

// ------------------------------------------------------------------ OpenCode

async function opencode() {
    if (argv[0] === "serve") {
        // its provider server: basic auth with the password it was started with
        const host = argv[argv.indexOf("--hostname") + 1];
        const port = Number(argv[argv.indexOf("--port") + 1]);
        const expected = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
        const integrations = JSON.parse(fixture("opencodeIntegrations.json"));
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (d) => (body += d));
            req.on("end", () => {
                log({ event: "request", method: req.method, path: req.url, authorized: req.headers.authorization === expected, body });
                if (req.headers.authorization !== expected) return res.writeHead(401).end('{"message":"unauthorized"}');
                const json = (o) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
                if (req.url === "/api/info") return json({ data: {} });
                if (req.url === "/api/integration") return json({ data: integrations });
                if (req.method === "POST" && /\/connect\/key$/.test(req.url)) return json({ data: {} });
                res.writeHead(404).end('{"message":"not found"}');
            });
        });
        server.listen(port, host, () => log({ event: "listening", host, port }));
        process.on("SIGTERM", () => server.close(() => process.exit(0)));
        return;
    }
    if (argv[0] === "acp") {
        // ACP over stdio: a session, the panel's tools listed, one prompt answered
        const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}");
        let buf = "";
        process.stdin.setEncoding("utf8");
        const send = (o) => out({ jsonrpc: "2.0", ...o });
        process.stdin.on("data", async (d) => {
            buf += d;
            for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
                const msg = JSON.parse(buf.slice(0, i));
                buf = buf.slice(i + 1);
                log({ event: "acp", method: msg.method });
                if (msg.method === "initialize") send({ id: msg.id, result: { protocolVersion: 1 } });
                else if (msg.method === "session/new") {
                    send({ id: msg.id, result: { sessionId: "ses_fake" } });
                    // OpenCode connects to its MCP servers in the background
                    const mcp = config.mcp?.servers?.paperboard;
                    if (mcp) await listTools(mcp.url);
                } else if (msg.method === "session/prompt") {
                    send({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "ok from opencode" } } } });
                    send({ id: msg.id, result: { stopReason: "end_turn" } });
                } else if (msg.id !== undefined) send({ id: msg.id, result: {} });
            }
        });
        process.on("SIGTERM", () => process.exit(0));
        return;
    }
    if (argv[0] === "auth" && argv[1] === "list") {
        process.stdout.write(JSON.stringify(plan.opencodeAuth ?? []));
        process.exit(0);
    }
    process.stderr.write(`fake opencode: unknown command ${argv.join(" ")}\n`);
    process.exit(64);
}

if (name === "codex") await codex();
else if (name === "claude") await claude();
else if (name === "opencode") await opencode();
else {
    process.stderr.write(`fake brain: no harness is called ${name}\n`);
    process.exit(64);
}
