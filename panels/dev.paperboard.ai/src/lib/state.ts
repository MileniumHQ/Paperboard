// UI state: a mirror of the service's state, plus the open conversation.
// Readiness means the service answered with its state (hydration), not
// merely that the document loaded.

import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { actionsApi, createPanelBridge } from "@mileniumhq/paperapi";
import { EVENTS, PANEL_ID, UI_ACTION_IDS } from "../contract";
import { OpenChatSync } from "../core/openChat";
import {
    initialState,
    type AiState,
    type ChatDeltaEvent,
    type ChatMessage,
    type ChatMessageEvent,
    type ChatResetEvent,
    type Conversation,
    type ConversationSnapshot,
} from "../core/types";

export const bridge = createPanelBridge<AiState>({ panelId: PANEL_ID, defaultState: initialState() });

const [store, setStore] = createStore<AiState>(initialState());
export const state = store;

export type Hydration = "loading" | "ready" | "failed";
const [hydration, setHydration] = createSignal<Hydration>("loading");
const [hydrationError, setHydrationError] = createSignal("");
export { hydration, hydrationError };

bridge.onStateChange((_patch, full) => {
    setStore(reconcile(full as AiState, { merge: true }));
});

export async function hydrate(): Promise<void> {
    setHydration("loading");
    try {
        const full = await bridge.refreshState();
        setStore(reconcile(full as AiState, { merge: true }));
        setHydration("ready");
    } catch (err) {
        setHydrationError(err instanceof Error ? err.message : String(err));
        setHydration("failed");
    }
}

type UiAction = (typeof UI_ACTION_IDS)[keyof typeof UI_ACTION_IDS];

export function call<R = unknown>(action: UiAction, inputs: Record<string, unknown> = {}): Promise<R> {
    return bridge.call<R>(action, inputs);
}

export function errorText(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return text.replace(/^Error:\s*/, "");
}

// The provider setup wizard shows on first run (not configured) and can be
// reopened from Settings to switch providers.
const [setupRequested, setSetupRequested] = createSignal(false);
export { setupRequested };
export function openProviderSetup(): void {
    setSetupRequested(true);
}
export function closeProviderSetup(): void {
    setSetupRequested(false);
}

// ─── open conversation ──────────────────────────────────────────────────────

const [conversation, setConversation] = createStore<{ current: Conversation | null }>({ current: null });
export const openConversation = () => conversation.current;
const [openError, setOpenError] = createSignal("");
export { openError };

function upsertMessage(message: ChatMessage): void {
    const c = conversation.current;
    if (!c) return;
    const i = c.messages.findIndex((m) => m.id === message.id);
    if (i >= 0) setConversation("current", "messages", i, reconcile(message));
    else setConversation("current", "messages", c.messages.length, message);
}

// the open chat follows the service's live events, ordered against the
// snapshot it was opened from (core/openChat.ts), so a reply in flight shows
// whether this window sent it, another window or computer did, or the panel
// was reloaded mid-reply
const sync = new OpenChatSync({
    fetch: (id) => call<ConversationSnapshot>(UI_ACTION_IDS.getConversation, { id }),
    shown: () => conversation.current?.id ?? null,
    show: (c, same) => {
        setOpenError("");
        // a reload of the chat on screen updates in place, not remounts
        if (c && same) setConversation("current", reconcile(c, { key: "id" }));
        else setConversation("current", c);
    },
    message: (e) => {
        if (e.message) upsertMessage(e.message);
    },
    delta: (e) => {
        const c = conversation.current;
        if (!c) return;
        const i = c.messages.findIndex((m) => m.id === e.messageId);
        if (i < 0) return;
        if (c.messages[i]!.role !== "assistant") return;
        // a partial object merges into the stored message, so it keeps
        // its identity and its views update in place, not remount
        setConversation("current", "messages", i, {
            content: e.content,
            ...(e.thinking !== undefined ? { thinking: e.thinking } : {}),
        });
    },
    failed: (err) => {
        setConversation("current", null);
        setOpenError(errorText(err));
    },
});

export function openChat(id: string | null): Promise<void> {
    setOpenError("");
    return sync.open(id);
}

/** Erases a user message and everything after it, then shows what remains. */
export async function rewindOpen(messageId: string): Promise<void> {
    const c = conversation.current;
    if (!c) return;
    const generation = sync.generation();
    const after = await call<Conversation>(UI_ACTION_IDS.rewindConversation, { id: c.id, messageId });
    // the stopped reply may have sent its last events meanwhile; the
    // service's result is the truth, applied only if this chat is still open
    if (generation === sync.generation()) setConversation("current", "messages", reconcile(after.messages, { key: "id" }));
}

// one subscription each for the panel's lifetime; the returned teardown is
// kept so a remount can release them
let subscribed: (() => void)[] = [];
export function subscribeChatEvents(): () => void {
    if (subscribed.length === 0) {
        subscribed = [
            actionsApi.on(PANEL_ID, EVENTS.chatMessage, (e: ChatMessageEvent) => sync.onMessage(e)),
            actionsApi.on(PANEL_ID, EVENTS.chatDelta, (e: ChatDeltaEvent) => sync.onDelta(e)),
            actionsApi.on(PANEL_ID, EVENTS.chatReset, (e: ChatResetEvent) => sync.onReset(e)),
        ];
    }
    return () => {
        for (const off of subscribed) off();
        subscribed = [];
    };
}

export function renameOpen(title: string): void {
    if (conversation.current) setConversation("current", "title", title);
}

export function setOpenModel(model: string): void {
    if (conversation.current) setConversation("current", "model", model);
}
