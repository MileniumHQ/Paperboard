#!/usr/bin/env node
// A small Codex for tests: its app server's JSON-RPC on stdio, like the
// real `codex app-server`. argv[2] is a folder that holds its threads and
// logs of how it was started and what it was told; a file named
// "signed-out" there makes it report nobody signed in. What it does with a
// turn depends on the first word of the turn's text.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";

const dir = process.argv[2];
const log = (name, value) => fs.appendFileSync(path.join(dir, name), `${JSON.stringify(value)}\n`);
log("starts.log", { flags: process.argv.slice(3), cwd: process.cwd() });
const threadsFile = path.join(dir, "threads.txt");
const known = () => (fs.existsSync(threadsFile) ? fs.readFileSync(threadsFile, "utf8").split("\n") : []);

const MODELS = [
    {
        id: "gpt-test",
        model: "gpt-test",
        displayName: "GPT-Test",
        description: "The default",
        hidden: false,
        isDefault: true,
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
        defaultReasoningEffort: "medium",
    },
    { id: "gpt-secret", model: "gpt-secret", displayName: "Hidden", description: "", hidden: true, isDefault: false },
    { id: "gpt-mini", model: "gpt-mini", displayName: "GPT-Mini", description: "Fast", hidden: false, isDefault: false },
];
/** thread id → { cwd, model, approvalPolicy, sandbox } */
const threads = new Map();
const pending = new Map();
let nextRequest = 0;
let waiting = null;

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const notify = (method, params) => send({ method, params });
const reply = (id, result) => send({ id, result });
const fail = (id, message) => send({ id, error: { code: -32600, message } });
function ask(method, params) {
    const id = nextRequest++;
    send({ id, method, params });
    return new Promise((resolve) => pending.set(id, resolve));
}

function message(threadId, turnId, id, chunks, streamed = true) {
    notify("item/started", { threadId, turnId, item: { type: "agentMessage", id, text: "" } });
    if (streamed) for (const delta of chunks) notify("item/agentMessage/delta", { threadId, turnId, itemId: id, delta });
    notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id, text: chunks.join("") } });
}
const complete = (threadId, turnId, status = "completed", error = null) => notify("turn/completed", { threadId, turn: { id: turnId, items: [], status, error } });

async function fileChange(threadId, turnId, file) {
    const item = { type: "fileChange", id: "fc-1", changes: [{ path: file, kind: { type: "update", move_path: null }, diff: "@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n" }], status: "inProgress" };
    notify("item/started", { threadId, turnId, item });
    const answer = await ask("item/fileChange/requestApproval", { threadId, turnId, itemId: "fc-1", startedAtMs: Date.now(), reason: null, grantRoot: null });
    log("answers.log", answer);
    const ok = answer.decision === "accept" || answer.decision === "acceptForSession";
    notify("item/completed", { threadId, turnId, item: { ...item, status: ok ? "completed" : "declined" } });
    message(threadId, turnId, "m-done", [ok ? "Done" : "Skipped"]);
    complete(threadId, turnId);
}

async function turn(threadId, turnId, input) {
    const state = threads.get(threadId);
    const first = input.find((b) => b.type === "text")?.text ?? "";
    const word = first.split(/\s/)[0];
    notify("turn/started", { threadId, turn: { id: turnId, items: [], status: "inProgress", error: null } });
    if (word === "hello") {
        notify("item/reasoning/summaryTextDelta", { threadId, turnId, itemId: "r-1", delta: "Thinking", summaryIndex: 0 });
        notify("item/completed", { threadId, turnId, item: { type: "reasoning", id: "r-1", summary: ["Thinking"], content: [] } });
        message(threadId, turnId, "m-1", ["Hel", "lo"]);
        // a message Codex never streamed is shown whole, as its own paragraph
        message(threadId, turnId, "m-2", ["Bye"], false);
        return complete(threadId, turnId);
    }
    if (word === "model") {
        message(threadId, turnId, "m-1", [state.model ?? "none"]);
        return complete(threadId, turnId);
    }
    if (word === "effort") {
        message(threadId, turnId, "m-1", [state.effort ?? "none"]);
        return complete(threadId, turnId);
    }
    if (word === "policy") {
        message(threadId, turnId, "m-1", [JSON.stringify({ approvalPolicy: state.approvalPolicy, sandbox: state.sandbox })]);
        return complete(threadId, turnId);
    }
    if (word === "echo") {
        message(threadId, turnId, "m-1", [JSON.stringify(input)]);
        return complete(threadId, turnId);
    }
    if (word === "edit") return fileChange(threadId, turnId, path.join(state.cwd, "a.txt"));
    if (word === "outside") return fileChange(threadId, turnId, "/elsewhere/a.txt");
    if (word === "run") {
        const item = { type: "commandExecution", id: "cmd-1", command: "/bin/bash -lc 'touch x'", cwd: state.cwd, status: "inProgress", commandActions: [{ type: "unknown", command: "touch x" }], aggregatedOutput: null, exitCode: null };
        notify("item/started", { threadId, turnId, item });
        const answer = await ask("item/commandExecution/requestApproval", {
            kind: "command",
            threadId,
            turnId,
            itemId: "cmd-1",
            command: item.command,
            commandActions: item.commandActions,
            availableDecisions: ["accept", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["touch", "x"] } }, "cancel"],
        });
        log("answers.log", answer);
        if (answer.decision === "cancel") {
            notify("item/completed", { threadId, turnId, item: { ...item, status: "declined" } });
            return complete(threadId, turnId, "interrupted");
        }
        notify("item/completed", { threadId, turnId, item: { ...item, status: "completed", aggregatedOutput: "ran", exitCode: 0 } });
        return complete(threadId, turnId);
    }
    if (word === "plan") {
        notify("turn/plan/updated", { threadId, turnId, explanation: null, plan: [{ step: "Read", status: "completed" }, { step: "Write", status: "inProgress" }] });
        return complete(threadId, turnId);
    }
    if (word === "hang") {
        waiting = () => complete(threadId, turnId, "interrupted");
        return;
    }
    if (word === "deaf") return;
    if (word === "crash") {
        process.stderr.write("boom: codex fell over\n");
        process.exit(3);
    }
    if (word === "overloaded") {
        const error = { message: "The model is overloaded.", codexErrorInfo: "serverOverloaded", additionalDetails: null };
        notify("error", { threadId, turnId, willRetry: true, error: { ...error, message: "Reconnecting... 1/5" } });
        notify("error", { threadId, turnId, willRetry: false, error });
        return complete(threadId, turnId, "failed", error);
    }
    if (word === "unauthorized") {
        const error = { message: "unexpected status 401 Unauthorized", codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } }, additionalDetails: null };
        return complete(threadId, turnId, "failed", error);
    }
}

function onRequest(m) {
    const p = m.params ?? {};
    log("requests.log", { method: m.method, params: p });
    switch (m.method) {
        case "initialize":
            return setTimeout(() => reply(m.id, { userAgent: "paperboard/9.9.9 (Fake OS; x86_64)", codexHome: dir, platformFamily: "unix", platformOs: "linux" }), fs.existsSync(path.join(dir, "delay-init")) ? 150 : 0);
        case "account/read":
            return reply(m.id, fs.existsSync(path.join(dir, "signed-out")) ? { account: null, requiresOpenaiAuth: true } : { account: { type: "apiKey" }, requiresOpenaiAuth: true });
        case "model/list":
            return p.cursor === "page-2" ? reply(m.id, { data: MODELS.slice(2), nextCursor: null }) : reply(m.id, { data: MODELS.slice(0, 2), nextCursor: "page-2" });
        case "thread/start": {
            const id = randomUUID();
            fs.appendFileSync(threadsFile, `${id}\n`);
            threads.set(id, { cwd: p.cwd, model: p.model, approvalPolicy: p.approvalPolicy, sandbox: p.sandbox });
            return reply(m.id, { thread: { id, cwd: p.cwd }, model: p.model ?? "gpt-test" });
        }
        case "thread/resume":
            if (!known().includes(p.threadId)) return fail(m.id, `no rollout found for thread id ${p.threadId}`);
            threads.set(p.threadId, { cwd: p.cwd, model: p.model, approvalPolicy: p.approvalPolicy, sandbox: p.sandbox });
            return reply(m.id, { thread: { id: p.threadId, cwd: p.cwd }, model: p.model ?? "gpt-test" });
        case "thread/unsubscribe":
            threads.delete(p.threadId);
            return reply(m.id, { status: "unsubscribed" });
        case "turn/start": {
            const state = threads.get(p.threadId);
            if (!state) return fail(m.id, "thread not found");
            if (p.model) state.model = p.model;
            if (p.effort) state.effort = p.effort;
            if (p.approvalPolicy) state.approvalPolicy = p.approvalPolicy;
            if (p.sandboxPolicy) state.sandbox = p.sandboxPolicy;
            const turnId = randomUUID();
            reply(m.id, { turn: { id: turnId, items: [], status: "inProgress", error: null } });
            void turn(p.threadId, turnId, p.input);
            return;
        }
        case "turn/interrupt":
            reply(m.id, {});
            waiting?.();
            waiting = null;
            return;
        default:
            return send({ id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
    }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const m = JSON.parse(line);
    if (m.method !== undefined && m.id !== undefined) return onRequest(m);
    if (m.method !== undefined) return log("requests.log", { method: m.method });
    pending.get(m.id)?.(m.result ?? { error: m.error });
    pending.delete(m.id);
});
