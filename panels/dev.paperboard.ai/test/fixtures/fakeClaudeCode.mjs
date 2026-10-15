#!/usr/bin/env node
// A small Claude Code for tests: its headless stream-json mode on stdio, like
// the real `claude --print --input-format stream-json`. argv[2] is a folder
// that holds its sessions and a log of the flags it was started with. What it
// does with a message depends on the message's first word.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const dir = process.argv[2];
const flags = process.argv.slice(3);
fs.appendFileSync(path.join(dir, "starts.log"), `${JSON.stringify({ flags, cwd: process.cwd() })}\n`);
const flag = (name) => (flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined);
const sessionsFile = path.join(dir, "sessions.txt");
const known = () => (fs.existsSync(sessionsFile) ? fs.readFileSync(sessionsFile, "utf8").split("\n") : []);

const resume = flag("--resume");
if (resume && !known().includes(resume)) {
    process.stderr.write(`No conversation found with session ID: ${resume}\n`);
    process.exit(1);
}
const sessionId = resume ?? flag("--session-id");
if (flag("--session-id")) fs.appendFileSync(sessionsFile, `${sessionId}\n`);

let nextRequest = 1;
const pending = new Map();
let waiting = null;
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const result = (fields) => send({ type: "result", subtype: "success", is_error: false, stop_reason: "end_turn", session_id: sessionId, ...fields });
const text = (id, chunks) => {
    send({ type: "stream_event", event: { type: "message_start", message: { id } }, parent_tool_use_id: null });
    for (const t of chunks) send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } }, parent_tool_use_id: null });
    send({ type: "assistant", message: { id, content: [{ type: "text", text: chunks.join("") }] }, parent_tool_use_id: null });
};
function ask(request) {
    const request_id = `cc-${nextRequest++}`;
    send({ type: "control_request", request_id, request });
    return new Promise((resolve) => pending.set(request_id, resolve));
}

async function onUser(message) {
    const blocks = message.message.content;
    const first = blocks.find((b) => b.type === "text")?.text ?? "";
    const word = first.split(/\s/)[0];
    if (word === "hello") {
        // a subagent's own text stays inside its tool call
        send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "SUBAGENT" } }, parent_tool_use_id: "toolu_task" });
        text("m1", ["Hel", "lo"]);
        return result({});
    }
    if (word === "echo") {
        text("m1", [JSON.stringify(blocks)]);
        return result({});
    }
    if (word === "edit") {
        const input = { file_path: "/w/a.txt", old_string: "a", new_string: "b" };
        send({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "toolu_1", name: "Edit", input }] }, parent_tool_use_id: null });
        const answer = await ask({ subtype: "can_use_tool", tool_name: "Edit", input, tool_use_id: "toolu_1", permission_suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }] });
        fs.appendFileSync(path.join(dir, "answers.log"), `${JSON.stringify(answer)}\n`);
        const allowed = answer.behavior === "allow";
        send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: allowed ? "Edited a.txt" : "denied", is_error: !allowed }] }, parent_tool_use_id: null });
        text("m3", [allowed ? "Done" : "Skipped"]);
        return result({});
    }
    if (word === "hang") {
        waiting = () => send({ type: "result", subtype: "error_during_execution", is_error: true, session_id: sessionId });
        return;
    }
    if (word === "deaf") return;
    if (word === "crash") {
        process.stderr.write("boom: claude fell over\n");
        process.exit(3);
    }
    if (word === "login") {
        // an API error Claude Code reports as its own message, never streamed
        send({ type: "assistant", message: { id: "m9", content: [{ type: "text", text: "Invalid API key · Please run /login" }] }, parent_tool_use_id: null });
        return result({ is_error: true, result: "Invalid API key · Please run /login" });
    }
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const m = JSON.parse(line);
    if (m.type === "control_response") {
        pending.get(m.response.request_id)?.(m.response.response);
        pending.delete(m.response.request_id);
        return;
    }
    if (m.type === "control_request") {
        const ok = (response = {}) => send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response } });
        if (m.request.subtype === "initialize") {
            return ok({ commands: [{ name: "review", description: "Review a PR", argumentHint: "<pr>" }], current_permission_mode: flag("--permission-mode") ?? "default", claude_code_version: "9.9.9" });
        }
        if (m.request.subtype === "set_permission_mode") return ok({ mode: m.request.mode });
        if (m.request.subtype === "interrupt") {
            ok({});
            waiting?.();
            waiting = null;
            return;
        }
        return send({ type: "control_response", response: { subtype: "error", request_id: m.request_id, error: "Unsupported" } });
    }
    if (m.type === "user") void onUser(m);
});
