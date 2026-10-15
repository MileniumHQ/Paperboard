#!/usr/bin/env node
// A small ACP agent for tests: JSON-RPC over stdio, like a real one. What it
// does with a prompt depends on the prompt's first word. `--auth` makes it
// refuse sessions until authenticate is called.
import readline from "node:readline";

const requireAuth = process.argv.includes("--auth");
// `--models config` offers models the current way (configOptions), `--models legacy` the older draft's way
const modelStyle = process.argv.includes("--models") ? process.argv[process.argv.indexOf("--models") + 1] : undefined;
const MODEL_OPTIONS = [
    { value: "big", name: "Big Model", description: "Thinks hard" },
    { value: "small", name: "Small Model" },
    // last though first by name: an agent's own order is kept
    { value: "auto", name: "Auto" },
];
/** session id → its model */
const sessionModel = new Map();
function modelFields(sessionId) {
    const current = sessionModel.get(sessionId) ?? "big";
    if (modelStyle === "config") {
        return { configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: current, options: [{ group: "fake", name: "Fake", options: MODEL_OPTIONS }] }] };
    }
    if (modelStyle === "legacy") {
        return { models: { currentModelId: current, availableModels: MODEL_OPTIONS.map((m) => ({ modelId: m.value, name: m.name })) } };
    }
    return {};
}
let authed = !requireAuth;
let nextSession = 1;
let nextRequest = 1000;
const sessions = new Set();
const pending = new Map();
const cancelled = new Set();
/** session id → the id of its prompt request */
const prompts = new Map();

function send(message) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}
const reply = (id, result) => send({ id, result });
const fail = (id, code, message) => send({ id, error: { code, message } });
const update = (sessionId, update) => send({ method: "session/update", params: { sessionId, update } });
function ask(method, params) {
    const id = nextRequest++;
    send({ id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const MODES = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code", description: "Edits files" }] };

async function prompt(id, { sessionId, prompt: blocks }) {
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const word = text.split(/\s+/)[0];
    prompts.set(sessionId, id);
    const say = (t) => update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
    switch (word) {
        case "hello":
            say("Hi");
            say(" there");
            return reply(id, { stopReason: "end_turn" });
        case "model":
            say(sessionModel.get(sessionId) ?? "big");
            return reply(id, { stopReason: "end_turn" });
        case "echo":
            say(JSON.stringify(blocks));
            return reply(id, { stopReason: "end_turn" });
        case "plan":
            update(sessionId, { sessionUpdate: "plan", entries: [{ content: "Read", status: "completed", priority: "high" }, { content: "Write", status: "in_progress", priority: "high" }] });
            say("Planned");
            return reply(id, { stopReason: "end_turn" });
        case "edit": {
            update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "I should edit" } });
            update(sessionId, {
                sessionUpdate: "tool_call",
                toolCallId: "t1",
                title: "Edit a.txt",
                kind: "edit",
                status: "pending",
                locations: [{ path: "/w/a.txt" }],
                content: [{ type: "diff", path: "/w/a.txt", oldText: "one\ntwo", newText: "one\n2" }],
            });
            const answer = await ask("session/request_permission", {
                sessionId,
                toolCall: { toolCallId: "t1" },
                options: [
                    { optionId: "yes", name: "Allow", kind: "allow_once" },
                    { optionId: "no", name: "Reject", kind: "reject_once" },
                ],
            });
            const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "yes";
            update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: allowed ? "completed" : "failed" });
            say(allowed ? "Edited" : "Skipped");
            return reply(id, { stopReason: "end_turn" });
        }
        case "hang":
            // answers only when cancelled
            return;
        case "deaf":
            // ignores cancel too
            cancelled.add("deaf");
            return;
        case "crash":
            process.stderr.write("boom: the agent fell over\n");
            process.exit(3);
            return;
        case "refuse":
            return reply(id, { stopReason: "refusal" });
        default:
            say(`you said ${text}`);
            return reply(id, { stopReason: "end_turn" });
    }
}

function handle(message) {
    if (message.method === undefined) {
        const p = pending.get(message.id);
        if (!p) return;
        pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error.message));
        else p.resolve(message.result);
        return;
    }
    const { id, method, params } = message;
    switch (method) {
        case "initialize":
            return reply(id, {
                protocolVersion: 1,
                agentCapabilities: { loadSession: true, promptCapabilities: { image: false, embeddedContext: true } },
                agentInfo: { name: "fake-agent", title: "Fake Agent", version: "1.2.3" },
                authMethods: requireAuth ? [{ id: "login", name: "Log in", description: "Opens a browser" }] : [],
            });
        case "authenticate":
            authed = true;
            return reply(id, {});
        case "session/new": {
            if (!authed) return fail(id, -32000, "Authentication required");
            const sessionId = `s${nextSession++}`;
            sessions.add(sessionId);
            reply(id, { sessionId, modes: MODES, ...modelFields(sessionId) });
            return update(sessionId, { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review changes" }] });
        }
        case "session/load":
            // a fresh process remembers sessions the way a real agent keeps them on disk: by id
            if (!/^s\d+$/.test(params.sessionId)) return fail(id, -32002, "Unknown session");
            sessions.add(params.sessionId);
            update(params.sessionId, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "replayed" } });
            return reply(id, { modes: MODES, ...modelFields(params.sessionId) });
        case "session/set_mode":
            if (!MODES.availableModes.some((m) => m.id === params.modeId)) return fail(id, -32602, `no mode ${params.modeId}`);
            reply(id, {});
            return update(params.sessionId, { sessionUpdate: "current_mode_update", currentModeId: params.modeId });
        case "session/set_config_option":
            if (modelStyle !== "config" || params.configId !== "model") return fail(id, -32602, "no such option");
            sessionModel.set(params.sessionId, params.value);
            return reply(id, modelFields(params.sessionId));
        case "session/set_model":
            if (modelStyle !== "legacy") return fail(id, -32601, "no session/set_model");
            sessionModel.set(params.sessionId, params.modelId);
            return reply(id, {});
        case "session/prompt":
            void prompt(id, params);
            return;
        case "session/cancel": {
            if (cancelled.has("deaf")) return;
            const promptId = prompts.get(params.sessionId);
            if (promptId !== undefined) reply(promptId, { stopReason: "cancelled" });
            return;
        }
        default:
            if (id !== undefined) fail(id, -32601, `no ${method}`);
    }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
    if (line.trim()) handle(JSON.parse(line));
});
process.stdin.on("end", () => process.exit(0));
