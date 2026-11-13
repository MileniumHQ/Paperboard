// Asking the user for things only they know, in the chat, without a browser:
// a name, a choice, an address, an API key. The agent sets out the fields
// (ask_user); the user types into a card. Plain answers go back to the agent.
// A secret one (a key, a token) goes straight into the vault for one of the
// agent's tool servers, under the name its config uses, and the agent learns
// only that it was saved: not in its context, not in the transcript.

import crypto from "node:crypto";
import { LIMITS, type PromptEntry, type PromptField } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

const L = LIMITS.prompt;

export const PROMPT_INSTRUCTIONS = `**Asking:** \`ask_user\` for what only the user knows (a choice, an address, an API key), everything at once. A key, token or password goes in a secret field, never plain chat; a site's sign-in is \`ask_to_sign_in\`.`;

export const PROMPT_TOOLS: ToolSpec[] = [
    {
        name: "ask_user",
        description:
            `Ask the user to type in things only they know, on a card in the chat: up to ${L.fields} fields. ` +
            "Plain answers come back to you; secret ones (keys, tokens) are saved in the vault for a tool server, and you're told only that they were. " +
            "Returns right away; their answer starts your next turn.",
        inputSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: `What you're asking for, in a few words, like "Connect Linear". Up to ${L.titleChars} characters.` },
                reason: { type: "string", description: "What it's for, in a sentence or two the user reads before answering." },
                fields: {
                    type: "array",
                    minItems: 1,
                    maxItems: L.fields,
                    items: {
                        type: "object",
                        properties: {
                            label: { type: "string", description: `What to type there, like "Workspace name" or "API key". Up to ${L.labelChars} characters.` },
                            secret: {
                                type: "object",
                                description: "For a key, token or password: the tool server it's for (add the server first) and the secret's name in its config. It goes into the vault and you never see it. Leave it out for a plain answer.",
                                properties: {
                                    server: { type: "string" },
                                    name: { type: "string" },
                                    prefix: { type: "string", description: `Saved in front of what the user types, like "Bearer " for an \`Authorization: Bearer <key>\` header, so they type only the key. Up to ${L.prefixChars} characters.` },
                                },
                                required: ["server", "name"],
                            },
                        },
                        required: ["label"],
                    },
                },
            },
            required: ["title", "reason", "fields"],
        },
    },
];

export interface PromptDeps {
    /** the tool server is one of the agent's */
    hasServer(server: string): boolean;
    /** the secret's name is one a server's config can use; throws in words for the agent */
    checkSecretName(name: string): string;
    /** put the value in the vault for the server */
    saveSecret(server: string, name: string, value: string): Promise<unknown>;
    /** add or update the request's card in the conversation */
    post(entry: PromptEntry): void;
    /** tell the agent how it went (starts a turn) */
    notice(text: string): void;
    waitMs?: number;
}

const fault = (text: string): ToolResult => ({ isError: true, text });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** what the user typed, after its prefix; a value they pasted with the prefix already on keeps just the one */
const withPrefix = (value: string, prefix?: string) => (!prefix || value.toLowerCase().startsWith(prefix.toLowerCase()) ? value : prefix + value);

export class Prompts {
    /** one request waits at a time; a new one replaces it */
    private pending: { entry: PromptEntry; timer: ReturnType<typeof setTimeout> } | null = null;

    constructor(private deps: PromptDeps) {}

    toolset(): Toolset {
        return {
            id: "prompt",
            // a flow has no one to answer
            tools: (mode) => (mode.fromFlow ? [] : PROMPT_TOOLS),
            instructions: (mode) => (mode.fromFlow ? "" : PROMPT_INSTRUCTIONS),
            call: async (name, args) => {
                if (name !== "ask_user") return fault(`unknown tool ${name}`);
                try {
                    return this.ask(args);
                } catch (e) {
                    console.warn(`[agents] ${name} failed:`, message(e));
                    return fault(message(e));
                }
            },
        };
    }

    private ask(args: Record<string, unknown>): ToolResult {
        const title = text(args.title);
        const reason = text(args.reason);
        if (!title || title.length > L.titleChars) return fault(`give a title of up to ${L.titleChars} characters`);
        if (!reason || reason.length > L.reasonChars) return fault(`give a reason of up to ${L.reasonChars} characters: what the answers are for`);
        if (!Array.isArray(args.fields) || args.fields.length < 1 || args.fields.length > L.fields) return fault(`ask for 1 to ${L.fields} fields`);
        const fields: PromptField[] = [];
        for (const raw of args.fields as unknown[]) {
            const f = (raw ?? {}) as Record<string, unknown>;
            const label = text(f.label);
            if (!label || label.length > L.labelChars) return fault(`each field has a label of up to ${L.labelChars} characters`);
            if (f.secret === undefined || f.secret === null) {
                fields.push({ label, secret: null });
                continue;
            }
            const s = f.secret as Record<string, unknown>;
            const server = text(s.server);
            if (!this.deps.hasServer(server)) return fault(`"${server}" isn't one of your tool servers; add it first, then ask for its secret`);
            const name = this.deps.checkSecretName(text(s.name));
            if (fields.some((x) => x.secret?.server === server && x.secret.name === name)) return fault(`"${name}" for ${server} is asked for twice`);
            if (s.prefix === undefined || s.prefix === null || s.prefix === "") {
                fields.push({ label, secret: { server, name } });
                continue;
            }
            if (typeof s.prefix !== "string" || s.prefix.length > L.prefixChars || /[\0-\x1f\x7f]/.test(s.prefix)) {
                return fault(`a secret's prefix is up to ${L.prefixChars} characters of plain text, like "Bearer "`);
            }
            fields.push({ label, secret: { server, name, prefix: s.prefix } });
        }

        this.lapse(); // the one before, unanswered, is replaced
        const entry: PromptEntry = { id: crypto.randomBytes(8).toString("hex"), at: Date.now(), kind: "prompt", title, reason, fields, status: "waiting" };
        const timer = setTimeout(() => {
            if (this.pending?.entry.id !== entry.id) return;
            this.lapse();
            this.tell(`The user didn't answer "${title}" in time; it has lapsed.`);
        }, this.deps.waitMs ?? L.waitMinutes * 60_000);
        this.pending = { entry, timer };
        this.deps.post(entry);
        return { text: "Asked the user. They answer on a card in the chat; their answer starts your next turn. Don't wait for it: finish this turn." };
    }

    /** The user's answers: secret ones into the vault, the rest to the agent. None of them is kept here. */
    async answer(id: unknown, values: unknown) {
        const p = this.waiting(id);
        const fields = p.entry.fields;
        if (!Array.isArray(values) || values.length !== fields.length || !values.every((v) => typeof v === "string" && v.length <= L.valueChars)) {
            throw new Error(`one answer per field, each up to ${L.valueChars} characters`);
        }
        const answers = values as string[];
        const empty = fields.find((f, i) => !answers[i]!.trim());
        if (empty) throw new Error(`Fill in ${empty.label}.`);

        clearTimeout(p.timer);
        this.update({ status: "sending" });
        const saved: string[] = [];
        for (const [i, f] of fields.entries()) {
            if (!f.secret) continue;
            try {
                await this.deps.saveSecret(f.secret.server, f.secret.name, withPrefix(answers[i]!.trim(), f.secret.prefix));
            } catch (e) {
                const error = `${f.label} wasn't saved: ${message(e)}`;
                this.finish({ status: "failed", error });
                this.tell(
                    `The user answered "${p.entry.title}", but ${f.secret.name} for ${f.secret.server} couldn't be saved: ${message(e)}.` +
                        (saved.length ? ` Saved before it: ${saved.join(", ")}.` : "") +
                        " Nothing else from the form was used; fix what's wrong and ask again.",
                );
                throw new Error(error);
            }
            saved.push(`${f.secret.name} for ${f.secret.server}`);
        }
        this.finish({ status: "sent" });
        const lines = fields.map((f, i) => (f.secret ? `- ${f.label}: saved in the vault as ${f.secret.name} for ${f.secret.server}` : `- ${f.label}: ${answers[i]!.trim()}`));
        this.tell(`The user answered "${p.entry.title}":\n${lines.join("\n")}`);
        return { sent: true };
    }

    decline(id: unknown) {
        const p = this.waiting(id);
        clearTimeout(p.timer);
        this.finish({ status: "declined" });
        this.tell(`The user said no to "${p.entry.title}". Don't ask again unless they bring it up.`);
        return { declined: true };
    }

    /** The conversation is put away or the service stops: a waiting request lapses, and its card says so. */
    shutdown() {
        this.lapse();
    }

    private waiting(id: unknown) {
        const p = this.pending;
        if (!p || p.entry.id !== id || p.entry.status !== "waiting") throw new Error("That request isn't waiting anymore.");
        return p;
    }

    private lapse() {
        const p = this.pending;
        if (!p || p.entry.status !== "waiting") return;
        clearTimeout(p.timer);
        this.finish({ status: "expired" });
    }

    private update(patch: Partial<PromptEntry>) {
        const p = this.pending;
        if (!p) return;
        p.entry = { ...p.entry, ...patch };
        this.deps.post(p.entry);
    }

    private finish(patch: Partial<PromptEntry>) {
        this.update(patch);
        this.pending = null;
    }

    private tell(text: string) {
        try {
            this.deps.notice(text);
        } catch (e) {
            // the card already shows the answer; the agent hears of it when it's next asked
            console.error("[agents] couldn't tell the agent about its request:", message(e));
        }
    }
}
