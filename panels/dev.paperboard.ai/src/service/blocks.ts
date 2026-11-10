// The AI panel's blocks for the Blocks panel (Actions API v2). The public
// actions (v1, actions.ts) stay as they are; both run the same functions.
import { blocksApi, type BlockSet } from "@mileniumhq/paperapi";
import { MAX_MEMORY_KEY_CHARS } from "../core/askMemory";
import { PROMPT_STYLES, PROMPT_STYLE_LABELS } from "../core/conversation";
import { PANEL_ID, TRIGGER_IDS } from "../contract";
import { askFromFlow, forgetFromFlow, MAX_INSTRUCTIONS_CHARS, MAX_PROMPT_CHARS } from "./actions";
import type { AiApp } from "./app";

const CATEGORY = "AI";

export function aiBlocks(app: AiApp): BlockSet {
    const ready = async <T>(fn: () => T | Promise<T>) => {
        await app.ready;
        return fn();
    };
    return {
        types: [
            {
                id: "model",
                name: "Model",
                icon: "neurology",
                description: "A model a provider in the AI panel serves, named as <provider>|<model>; a plain model name is served by the first provider that lists it",
                base: "text",
                fields: {
                    name: { type: "text", name: "Name", resolve: (value: string) => ready(() => app.blockModel(value).name) },
                    provider: { type: "text", name: "Provider", resolve: (value: string) => ready(() => app.blockModel(value).provider) },
                },
            },
            {
                id: "chat",
                name: "Chat",
                icon: "forum",
                description: "A chat in the AI panel",
                base: "text",
                fields: {
                    title: { type: "text", name: "Title", resolve: (id: string) => ready(() => app.blockChat(id).title) },
                    model: { type: "model", name: "Model", resolve: (id: string) => ready(() => app.blockChat(id).model) },
                },
            },
        ],
        values: [
            {
                id: "models",
                name: "Models",
                category: CATEGORY,
                icon: "list",
                description: "Every model Ask AI can use, across the providers in the AI panel",
                type: "list<model>",
                changes: true,
                read: () => ready(() => app.blockModels()),
            },
            {
                id: "favorite-models",
                name: "Favorite Models",
                category: CATEGORY,
                icon: "favorite",
                description: "The models hearted in the AI panel's Models that Ask AI can use",
                type: "list<model>",
                changes: true,
                read: () => ready(() => app.askModelChoices().map((c) => c.value)),
            },
        ],
        commands: [
            {
                id: "ask",
                name: "Ask AI",
                category: CATEGORY,
                icon: "smart_toy",
                description:
                    "Asks a model and gives back its answer. Asks with the same memory key (a channel, a player, a ticket) continue one conversation. The model gets no actions here, since nobody is present to approve them. Fails if the answer takes longer than 28 seconds.",
                text: "the answer of {model} to {prompt} as {personality} following {instructions} remembering {memory}",
                inputs: {
                    model: { type: "model", name: "Model", description: "Leave it empty for the default model", optional: true },
                    prompt: { type: "text", name: "Prompt", maxLength: MAX_PROMPT_CHARS },
                    personality: {
                        type: "text",
                        name: "Personality",
                        optional: true,
                        choices: PROMPT_STYLES.map((style) => ({ label: PROMPT_STYLE_LABELS[style], value: style })),
                    },
                    instructions: {
                        type: "text",
                        name: "Instructions",
                        description: "Who the AI is and how it answers here, added to the personality",
                        optional: true,
                        maxLength: MAX_INSTRUCTIONS_CHARS,
                    },
                    memory: {
                        type: "text",
                        name: "Memory Key",
                        description: "Asks with the same key continue one conversation. Leave it empty to ask without memory.",
                        optional: true,
                        maxLength: MAX_MEMORY_KEY_CHARS,
                    },
                },
                output: "text",
                run: (inputs: { prompt: string; model?: string; personality?: string; instructions?: string; memory?: string }) => askFromFlow(app, inputs),
            },
            {
                id: "forget-memory",
                name: "Forget Memory",
                category: CATEGORY,
                icon: "history_toggle_off",
                description: "Clears what Ask AI remembers for a memory key, so the next ask with it starts over. Gives back whether there was anything to forget.",
                text: "forget what AI remembers for {memory}",
                inputs: { memory: { type: "text", name: "Memory Key", maxLength: MAX_MEMORY_KEY_CHARS } },
                output: "boolean",
                run: ({ memory }: { memory: string }) => forgetFromFlow(app, memory),
            },
        ],
        events: [
            {
                id: TRIGGER_IDS.replyFinished,
                name: "When AI Replies",
                category: CATEGORY,
                icon: "forum",
                description: "Fires when a chat in the AI panel finishes a reply",
                text: "when {model} finishes replying",
                inputs: { model: { type: "model", name: "Model", optional: true } },
                filters: { model: "model" },
                values: {
                    text: { type: "text", name: "Text" },
                    chat: { type: "chat", name: "Chat" },
                    model: { type: "model", name: "Model" },
                },
            },
        ],
    };
}

/**
 * Tells the Blocks panel what happened. Until the blocks are registered
 * nothing can listen, so nothing is sent; after, a list announces a change
 * only when it did, and every failure is reported.
 */
export class AiBlocks {
    private readonly handle = blocksApi.panel(PANEL_ID);
    private registered = false;
    private readonly last = new Map<string, string>();

    async register(set: BlockSet, lists: Record<string, string[]>): Promise<void> {
        await this.handle.register(set);
        for (const [value, list] of Object.entries(lists)) this.last.set(value, JSON.stringify(list));
        this.registered = true;
    }

    list(value: string, list: () => string[]): void {
        if (!this.registered) return;
        let key: string;
        try {
            key = JSON.stringify(list());
        } catch (err) {
            console.error(`[ai] ${value} can't be listed for Blocks:`, String(err));
            return;
        }
        if (this.last.get(value) === key) return;
        this.last.set(value, key);
        this.handle.changed(value).catch((err) => console.error(`[ai] the change to ${value} didn't reach Blocks:`, String(err)));
    }

    fire(event: string, payload: Record<string, unknown>): void {
        if (!this.registered) return;
        this.handle.fire(event, payload).catch((err) => console.error(`[ai] ${event} didn't reach Blocks:`, String(err)));
    }
}
