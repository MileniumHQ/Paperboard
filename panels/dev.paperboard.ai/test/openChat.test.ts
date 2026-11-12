// The open chat against the events that race its snapshot: what a window
// shows after opening a chat mid-reply, with the answer and the events
// arriving in either order.
import { describe, it, expect } from "bun:test";
import { MAX_HELD_EVENTS, OpenChatSync } from "../src/core/openChat";
import type { AssistantMessage, ChatDeltaEvent, ChatMessageEvent, Conversation, ConversationSnapshot } from "../src/core/types";

function reply(id: string, content: string, status: AssistantMessage["status"] = "streaming"): AssistantMessage {
    return { id, role: "assistant", model: "m", content, status, createdAt: 1 };
}

function chat(id: string, messages: Conversation["messages"] = []): Conversation {
    return { id, title: id, model: "m", createdAt: 1, updatedAt: 1, messages };
}

/** A window: what it shows, and a service whose answers it releases by hand. */
function harness() {
    let shown: Conversation | null = null;
    const answers: { id: string; resolve: (s: ConversationSnapshot) => void; reject: (e: Error) => void }[] = [];
    const errors: string[] = [];
    const sync = new OpenChatSync({
        fetch: (id) => new Promise((resolve, reject) => answers.push({ id, resolve, reject })),
        shown: () => shown?.id ?? null,
        show: (c) => (shown = c ? structuredClone(c) : null),
        message: (e) => {
            if (!shown) return;
            const i = shown.messages.findIndex((m) => m.id === e.message.id);
            if (i >= 0) shown.messages[i] = e.message;
            else shown.messages.push(e.message);
        },
        delta: (e) => {
            const m = shown?.messages.find((x) => x.id === e.messageId);
            if (m) m.content = e.content;
        },
        failed: (err) => errors.push(String(err)),
    });
    return { sync, answers, errors, shown: () => shown };
}

const delta = (seq: number, conversationId: string, messageId: string, content: string): ChatDeltaEvent => ({ seq, conversationId, messageId, content });
const message = (seq: number, conversationId: string, m: AssistantMessage): ChatMessageEvent => ({ seq, conversationId, message: m });

describe("opening a chat mid-reply", () => {
    it("shows the reply from the snapshot and keeps streaming into it", async () => {
        const w = harness();
        const opened = w.sync.open("c1");
        w.answers[0]!.resolve({ seq: 5, conversation: chat("c1", [reply("r1", "Hel")]) });
        await opened;
        w.sync.onDelta(delta(6, "c1", "r1", "Hello"));
        expect(w.shown()!.messages[0]!.content).toBe("Hello");
    });

    it("replays the events that beat the answer, and only the ones newer than the snapshot", async () => {
        const w = harness();
        const opened = w.sync.open("c1");
        // seq 4 is in the snapshot; 6 and 7 came after it but arrived first
        w.sync.onMessage(message(4, "c1", reply("r1", "", "streaming")));
        w.sync.onMessage(message(6, "c1", reply("r1", "Hello", "done")));
        w.sync.onMessage(message(7, "c1", reply("r2", "", "streaming")));
        w.answers[0]!.resolve({ seq: 5, conversation: chat("c1", [reply("r1", "Hel")]) });
        await opened;
        expect(w.shown()!.messages).toEqual([reply("r1", "Hello", "done"), reply("r2", "", "streaming")]);
    });

    it("never applies an event older than the snapshot over it", async () => {
        const w = harness();
        const opened = w.sync.open("c1");
        w.sync.onDelta(delta(3, "c1", "r1", "He"));
        w.answers[0]!.resolve({ seq: 5, conversation: chat("c1", [reply("r1", "Hello", "done")]) });
        await opened;
        expect(w.shown()!.messages[0]).toEqual(reply("r1", "Hello", "done"));
    });

    it("keeps the chat on screen live while another one opens, and ignores other chats", async () => {
        const w = harness();
        const first = w.sync.open("c1");
        w.answers[0]!.resolve({ seq: 1, conversation: chat("c1", [reply("r1", "")]) });
        await first;
        const second = w.sync.open("c2");
        w.sync.onDelta(delta(2, "c1", "r1", "still c1"));
        w.sync.onDelta(delta(3, "c9", "r9", "not shown anywhere"));
        expect(w.shown()!.messages[0]!.content).toBe("still c1");
        w.answers[1]!.resolve({ seq: 3, conversation: chat("c2") });
        await second;
        expect(w.shown()!.id).toBe("c2");
    });

    it("a later open wins over an earlier answer that lands after it", async () => {
        const w = harness();
        const first = w.sync.open("c1");
        const second = w.sync.open("c2");
        w.answers[1]!.resolve({ seq: 1, conversation: chat("c2") });
        await second;
        w.answers[0]!.resolve({ seq: 1, conversation: chat("c1") });
        await first;
        expect(w.shown()!.id).toBe("c2");
    });

    it("reports a failed open, unless a later open superseded it", async () => {
        const w = harness();
        const first = w.sync.open("c1");
        w.answers[0]!.reject(new Error("service down"));
        await first;
        expect(w.errors).toEqual(["Error: service down"]);
        const stale = w.sync.open("c1");
        const latest = w.sync.open("c2");
        w.answers[1]!.reject(new Error("stale"));
        w.answers[2]!.resolve({ seq: 0, conversation: chat("c2") });
        await Promise.all([stale, latest]);
        expect(w.errors).toHaveLength(1);
    });

    it(`fetches again rather than holding more than ${MAX_HELD_EVENTS} events`, async () => {
        const w = harness();
        void w.sync.open("c1");
        for (let seq = 1; seq <= MAX_HELD_EVENTS + 1; seq++) w.sync.onDelta(delta(seq, "c1", "r1", "x".repeat(seq)));
        expect(w.answers.map((a) => a.id)).toEqual(["c1", "c1"]);
    });
});

describe("a chat rewritten in another window", () => {
    it("reloads the chat on screen, and leaves other chats alone", async () => {
        const w = harness();
        const opened = w.sync.open("c1");
        w.answers[0]!.resolve({ seq: 1, conversation: chat("c1", [reply("r1", "erased")]) });
        await opened;
        w.sync.onReset({ seq: 2, conversationId: "c2" });
        expect(w.answers).toHaveLength(1);
        w.sync.onReset({ seq: 3, conversationId: "c1" });
        w.answers[1]!.resolve({ seq: 3, conversation: chat("c1") });
        await Promise.resolve();
        expect(w.shown()!.messages).toEqual([]);
    });
});
