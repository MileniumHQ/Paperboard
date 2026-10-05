// UI state: a mirror of the service's state, plus the open conversation.
// Readiness means the service answered with its state (hydration), not
// merely that the document loaded.

import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { actionsApi, createPanelBridge } from "@mileniumhq/paperapi";
import { EVENTS, PANEL_ID, UI_ACTION_IDS } from "../contract";
import { initialState, type AiState, type ChatMessage, type Conversation } from "../core/types";

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
let openToken = 0;

export async function openChat(id: string | null): Promise<void> {
    const token = ++openToken;
    setOpenError("");
    if (!id) {
        setConversation("current", null);
        return;
    }
    try {
        const c = await call<Conversation>(UI_ACTION_IDS.getConversation, { id });
        if (token === openToken) setConversation("current", c);
    } catch (err) {
        if (token === openToken) {
            setConversation("current", null);
            setOpenError(errorText(err));
        }
    }
}

/** Erases a user message and everything after it, then shows what remains. */
export async function rewindOpen(messageId: string): Promise<void> {
    const c = conversation.current;
    if (!c) return;
    const token = openToken;
    const after = await call<Conversation>(UI_ACTION_IDS.rewindConversation, { id: c.id, messageId });
    // the stopped reply may have sent its last events meanwhile; the
    // service's result is the truth, applied only if this chat is still open
    if (token === openToken) setConversation("current", "messages", reconcile(after.messages, { key: "id" }));
}

function upsertMessage(message: ChatMessage): void {
    const c = conversation.current;
    if (!c) return;
    const i = c.messages.findIndex((m) => m.id === message.id);
    if (i >= 0) setConversation("current", "messages", i, reconcile(message));
    else setConversation("current", "messages", c.messages.length, message);
}

// one subscription each for the panel's lifetime; the returned teardown is
// kept so a remount can release them
let subscribed: (() => void)[] = [];
export function subscribeChatEvents(): () => void {
    if (subscribed.length === 0) {
        subscribed = [
            actionsApi.on(PANEL_ID, EVENTS.chatMessage, (p: { conversationId: string; message: ChatMessage }) => {
                if (p?.conversationId === conversation.current?.id && p.message) upsertMessage(p.message);
            }),
            actionsApi.on(PANEL_ID, EVENTS.chatDelta, (p: { conversationId: string; messageId: string; content: string; thinking?: string }) => {
                const c = conversation.current;
                if (!c || p?.conversationId !== c.id) return;
                const i = c.messages.findIndex((m) => m.id === p.messageId);
                if (i < 0) return;
                if (c.messages[i]!.role !== "assistant") return;
                // a partial object merges into the stored message, so it keeps
                // its identity and its views update in place, not remount
                setConversation("current", "messages", i, {
                    content: p.content,
                    ...(p.thinking !== undefined ? { thinking: p.thinking } : {}),
                });
            }),
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
