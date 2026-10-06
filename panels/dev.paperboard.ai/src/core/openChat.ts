// Keeping one window's open chat in step with the service. Opening a chat
// fetches a snapshot while the reply keeps streaming events, and the call's
// answer and those events race: an event the snapshot already holds must not
// be applied twice out of order, and one that came after it must not be
// dropped because the chat was not shown yet. Every event carries the
// service's `seq`, and so does the snapshot, so the events that arrive while
// a chat opens are held and only the newer ones are replayed onto it.
// Framework-free so the race is testable without a browser.

import type {
    ChatDeltaEvent,
    ChatMessageEvent,
    ChatResetEvent,
    Conversation,
    ConversationSnapshot,
} from "./types";

// a reply streams ~16 deltas a second, so an open call this far behind has
// stalled; the snapshot is fetched again instead of growing the queue
export const MAX_HELD_EVENTS = 512;

type Held = { kind: "message"; event: ChatMessageEvent } | { kind: "delta"; event: ChatDeltaEvent };

export interface OpenChatDeps {
    fetch: (id: string) => Promise<ConversationSnapshot>;
    /** shows a conversation; `same` is true when it refreshes the one shown */
    show: (conversation: Conversation | null, same: boolean) => void;
    /** the id of the conversation shown now */
    shown: () => string | null;
    message: (event: ChatMessageEvent) => void;
    delta: (event: ChatDeltaEvent) => void;
    failed: (err: unknown) => void;
}

export class OpenChatSync {
    private token = 0;
    private opening: { id: string; held: Held[] } | null = null;

    constructor(private readonly deps: OpenChatDeps) {}

    /** Opens (or reloads) a chat; a later open supersedes this one. */
    async open(id: string | null): Promise<void> {
        const token = ++this.token;
        if (!id) {
            this.opening = null;
            this.deps.show(null, false);
            return;
        }
        const opening = { id, held: [] as Held[] };
        this.opening = opening;
        try {
            const snapshot = await this.deps.fetch(id);
            if (token !== this.token) return;
            this.opening = null;
            this.deps.show(snapshot.conversation, this.deps.shown() === id);
            for (const h of opening.held) {
                if (h.event.seq <= snapshot.seq) continue;
                if (h.kind === "message") this.deps.message(h.event);
                else this.deps.delta(h.event);
            }
        } catch (err) {
            if (token !== this.token) return;
            this.opening = null;
            this.deps.failed(err);
        }
    }

    /** Changes with every open; a result applied later checks it is unchanged. */
    generation(): number {
        return this.token;
    }

    onMessage(event: ChatMessageEvent): void {
        if (this.hold({ kind: "message", event })) return;
        if (event.conversationId === this.deps.shown()) this.deps.message(event);
    }

    onDelta(event: ChatDeltaEvent): void {
        if (this.hold({ kind: "delta", event })) return;
        if (event.conversationId === this.deps.shown()) this.deps.delta(event);
    }

    /** Another window rewrote the chat: what is shown is no longer true. */
    onReset(event: ChatResetEvent): void {
        const id = event.conversationId;
        if (id === this.opening?.id || id === this.deps.shown()) void this.open(id);
    }

    private hold(h: Held): boolean {
        const opening = this.opening;
        if (!opening || h.event.conversationId !== opening.id) return false;
        if (opening.held.length >= MAX_HELD_EVENTS) void this.open(opening.id);
        else opening.held.push(h);
        return true;
    }
}
