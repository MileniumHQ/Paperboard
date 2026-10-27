import { describe, expect, test } from "bun:test";
import { AcpTurn, RETRY_MS, type AcpEvent } from "../src/service/acp";
import { until } from "./fakeHost";

function driver(o: { thread?: string | null; ready?: () => Promise<void> } = {}) {
    const sent: any[] = [];
    const events: AcpEvent[] = [];
    const turn = new AcpTurn({
        cwd: "/work",
        thread: o.thread ?? null,
        model: null,
        message: "hi",
        ready: o.ready ?? (async () => {}),
        write: async (line) => void sent.push(JSON.parse(line)),
        emit: (ev) => events.push(ev),
    });
    const line = (msg: unknown) => turn.line(JSON.stringify({ jsonrpc: "2.0", ...(msg as object) }));
    const answer = async (n: number, reply: { result?: unknown; error?: unknown }) => {
        await until(() => sent.length > n);
        line({ id: sent[n].id, ...reply });
        return sent[n];
    };
    return { turn, sent, events, line, answer, done: turn.run() };
}

describe("an ACP turn", () => {
    test("a session OpenCode no longer has is opened anew", async () => {
        const d = driver({ thread: "ses_gone" });
        await d.answer(0, { result: {} });
        expect((await d.answer(1, { error: { message: "not found" } })).method).toBe("session/resume");
        expect((await d.answer(2, { result: { sessionId: "ses_new" } })).method).toBe("session/new");
        await d.answer(3, { result: { stopReason: "end_turn" } });
        await d.done;
        expect(d.events).toEqual([{ type: "thread", id: "ses_new" }, { type: "done" }]);
    });

    test("refuses OpenCode's permission and other requests, and reports searches and tool work", async () => {
        const d = driver();
        await d.answer(0, { result: {} });
        await d.answer(1, { result: { sessionId: "s" } });
        await until(() => d.sent.length === 3);
        d.line({ id: 7, method: "session/request_permission", params: {} });
        d.line({ id: 8, method: "fs/read_text_file", params: {} });
        const upd = (update: object) => d.line({ method: "session/update", params: { sessionId: "s", update } });
        upd({ sessionUpdate: "tool_call", toolCallId: "c1", name: "websearch", status: "pending" });
        upd({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress", rawInput: { query: "weather" } });
        upd({ sessionUpdate: "tool_call", toolCallId: "c2", name: "paperboard_send_message", status: "pending" });
        await d.answer(2, { result: { stopReason: "end_turn" } });
        await d.done;
        await until(() => d.sent.length === 5);
        expect(d.sent.find((m) => m.id === 7)).toMatchObject({ result: { outcome: { outcome: "selected", optionId: "reject" } } });
        expect(d.sent.find((m) => m.id === 8)).toMatchObject({ error: { code: -32601 } });
        expect(d.events.slice(1)).toEqual([{ type: "working" }, { type: "search", query: "weather" }, { type: "typing" }, { type: "done" }]);
    });

    test("OpenCode's usage updates say how much of the model's context the session fills", async () => {
        const d = driver();
        await d.answer(0, { result: {} });
        await d.answer(1, { result: { sessionId: "s" } });
        await until(() => d.sent.length === 3);
        d.line({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "usage_update", used: 41_000, size: 128_000 } } });
        await d.answer(2, { result: { stopReason: "end_turn" } });
        await d.done;
        expect(d.events.slice(1)).toEqual([{ type: "context", used: 41_000, size: 128_000 }, { type: "done" }]);
    });

    test("OpenCode gone before answering fails the turn, even while waiting for the tools", async () => {
        const d = driver({ ready: () => new Promise(() => {}) });
        await d.answer(0, { result: {} });
        await d.answer(1, { result: { sessionId: "s" } });
        await until(() => d.events.length === 1);
        d.line({ method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", messageId: "m", content: { type: "text", text: "partial" } } } });
        d.turn.close();
        await d.done;
        expect(d.events.slice(1)).toEqual([
            { type: "typing" },
            { type: "message", text: "partial" },
            { type: "failed", message: "OpenCode stopped before answering" },
            { type: "done" },
        ]);
    });

    test("a provider OpenCode keeps retrying past a minute fails the turn with its reason", async () => {
        const d = driver();
        await d.answer(0, { result: {} });
        await d.answer(1, { result: { sessionId: "s" } });
        await until(() => d.sent.length === 3);
        const retry = (inMs: number, attempt: number) =>
            d.line({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "session_info_update", _meta: { "opencode/retry": { attempt, nextRetryAt: new Date(Date.now() + inMs).toISOString(), error: { type: "provider.rate-limit", message: "Resource exhausted." } } } } } });
        const cleared = () => d.line({ method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "session_info_update", _meta: { "opencode/retry": null } } } });
        retry(5_000, 1);
        expect(d.sent.some((m) => m.method === "session/cancel")).toBe(false); // a short wait is OpenCode's to make
        cleared(); // OpenCode clears the notice at each attempt: the wait goes on until the provider answers
        retry(RETRY_MS + 5_000, 2);
        await until(() => d.sent.some((m) => m.method === "session/cancel"));
        expect(d.sent.find((m) => m.method === "session/cancel")).toMatchObject({ params: { sessionId: "s" } });
        await d.answer(2, { result: { stopReason: "cancelled" } });
        await d.done;
        expect(d.events.slice(1)).toEqual([
            { type: "working" },
            { type: "working" },
            { type: "failed", message: "Resource exhausted. (OpenCode was still retrying after a minute, so this turn stopped)" },
            { type: "done" },
        ]);
    });

    test("a text that's gone out ends the typing: the next step is work", async () => {
        const d = driver();
        await d.answer(0, { result: {} });
        await d.answer(1, { result: { sessionId: "s" } });
        await until(() => d.sent.length === 3);
        const upd = (update: object) => d.line({ method: "session/update", params: { sessionId: "s", update } });
        upd({ sessionUpdate: "tool_call", toolCallId: "c1", name: "paperboard_send_message", status: "pending" });
        upd({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" });
        await d.answer(2, { result: { stopReason: "end_turn" } });
        await d.done;
        expect(d.events.slice(1)).toEqual([{ type: "typing" }, { type: "working" }, { type: "done" }]);
    });
});
