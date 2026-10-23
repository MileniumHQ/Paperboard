// Signing in without the agent seeing the password. The agent points at a
// page's fields and its submit button (ask_to_sign_in); the user sees the
// site, a picture of what was picked, and types the values into the chat.
// The values go once to the computer, which types them in and presses
// submit, and are never kept: not in the transcript, not in the agent's
// context, not on disk. The next sign-in asks again.

import crypto from "node:crypto";
import { LIMITS, type SignInEntry } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

export const SIGN_IN_INSTRUCTIONS = `Signing in: the user types their own email, username, password and codes, always through \`ask_to_sign_in\`, and you never see them. When a site needs a sign-in, open its sign-in page in your browser, \`look\`, then call \`ask_to_sign_in\` with the marks of the fields (email or username, password, a one-time code) and of the button that submits them. A button that's greyed out until something is typed is still the right pick; if there's no button you can mark, leave \`submit\` out and Enter is pressed in the last field. The user sees the site and a picture of your picks, and types the values in themselves. You'll be told when it's done or they said no: then \`look\` again to see whether it worked. A site that splits sign-in over two pages (email first, then password) is two asks. A code split into a box per digit is one field: mark only the first box, and the code is typed across the rest.
Never type a sign-in value yourself, and never offer to: not an email or username you know from the conversation, and not any account details about the user that came with your instructions or your environment (those aren't for signing in to sites). If the user offers to tell you one, or sends one in the chat, don't use it: say you'd rather they type it into the sign-in request, and call \`ask_to_sign_in\`.`;

export const SIGN_IN_TOOLS: ToolSpec[] = [
    {
        name: "ask_to_sign_in",
        description:
            "Ask the user to sign in on the page open in your browser. Name the text fields to fill and the button that submits them, by marks from your latest `look` at the window. " +
            "The user types the values; they're filled in and submitted without you seeing them. Returns right away; you're told later how it went.",
        inputSchema: {
            type: "object",
            properties: {
                window: { type: "integer", description: "The browser window's id." },
                fields: {
                    type: "array",
                    minItems: 1,
                    maxItems: LIMITS.signIn.fields,
                    description: "The fields to fill, in order.",
                    items: {
                        type: "object",
                        properties: {
                            mark: { type: "integer", description: "The field's mark from the latest look." },
                            label: { type: "string", description: 'What the user should type there, like "Email" or "Password".' },
                        },
                        required: ["mark", "label"],
                    },
                },
                submit: {
                    type: "integer",
                    description: "The mark of the button that submits them, even if it's greyed out until something is typed. Leave it out when there's no button to mark: Enter is pressed in the last field.",
                },
            },
            required: ["window", "fields"],
        },
    },
];

export interface SignInDeps {
    /** the guest's sign_in_prepare, as the agent (refused while the user has the computer) */
    prepare(args: Record<string, unknown>): Promise<ToolResult>;
    /** the guest's view_sign_in: types the values in and presses submit */
    fill(args: { id: string; values: string[] }): Promise<unknown>;
    /** add or update the request's bubble in the conversation */
    post(entry: SignInEntry): void;
    /** tell the agent how it went (starts a turn) */
    notice(text: string): void;
    waitMs?: number;
}

interface Pending {
    entry: SignInEntry;
    window: number;
    image: string;
    timer: ReturnType<typeof setTimeout>;
}

export class SignIns {
    /** one request waits at a time; a new one replaces it */
    private pending: Pending | null = null;

    constructor(private deps: SignInDeps) {}

    toolset(): Toolset {
        return {
            id: "sign-in",
            tools: () => SIGN_IN_TOOLS,
            instructions: () => SIGN_IN_INSTRUCTIONS,
            call: async (name, args) => (name === "ask_to_sign_in" ? this.ask(args) : { isError: true, text: `unknown tool ${name}` }),
        };
    }

    private async ask(args: Record<string, unknown>): Promise<ToolResult> {
        const window = args.window;
        const submit = args.submit;
        const fields = args.fields;
        if (!Number.isInteger(window)) return fault("window is the browser window's id");
        if (submit !== undefined && !Number.isInteger(submit)) return fault("submit is the submit button's mark, or left out to press Enter");
        if (!Array.isArray(fields) || fields.length < 1 || fields.length > LIMITS.signIn.fields) return fault(`name 1 to ${LIMITS.signIn.fields} fields`);
        const picks: { mark: number; label: string }[] = [];
        for (const f of fields as unknown[]) {
            const { mark, label } = (f ?? {}) as Record<string, unknown>;
            if (!Number.isInteger(mark)) return fault("each field has the mark of a text field");
            if (typeof label !== "string" || !label.trim() || label.trim().length > LIMITS.signIn.labelChars) {
                return fault(`each field has a label of up to ${LIMITS.signIn.labelChars} characters`);
            }
            picks.push({ mark: mark as number, label: label.trim() });
        }

        const id = crypto.randomBytes(8).toString("hex");
        const r = await this.deps.prepare({ id, window, fields: picks.map((p) => p.mark), ...(submit === undefined ? {} : { submit }) });
        if (r.isError) return r;
        let info: { site: string; fields: { secret: boolean }[] };
        try {
            info = JSON.parse(r.text);
        } catch {
            return fault("your computer's answer about the page was unreadable; try again");
        }
        if (!r.image || typeof info.site !== "string" || info.fields?.length !== picks.length) return fault("your computer's answer about the page was incomplete; try again");

        this.lapse("expired"); // the one before, unanswered, is replaced
        const entry: SignInEntry = {
            id,
            at: Date.now(),
            kind: "sign-in",
            site: info.site,
            fields: picks.map((p, i) => ({ label: p.label, secret: info.fields[i]!.secret === true })),
            status: "waiting",
        };
        const timer = setTimeout(() => {
            if (this.pending?.entry.id !== id) return;
            this.lapse("expired");
            this.tell(`The user didn't answer your sign-in request on ${entry.site} in time; it has lapsed.`);
        }, this.deps.waitMs ?? LIMITS.signIn.waitMinutes * 60_000);
        this.pending = { entry, window: window as number, image: r.image, timer };
        this.deps.post(entry);
        return {
            text: `Asked the user to sign in on ${info.site}. They answer in the chat; you'll be told when it's done or they said no. Don't wait for it: finish this turn.`,
        };
    }

    /** The picture of what the agent picked, while the request waits. */
    shot(id: unknown): { image: string } {
        return { image: this.waiting(id).image };
    }

    /** The user's values: typed in once, then forgotten. */
    async submit(id: unknown, values: unknown) {
        const p = this.waiting(id);
        if (
            !Array.isArray(values) ||
            values.length !== p.entry.fields.length ||
            !values.every((v) => typeof v === "string" && v.length <= LIMITS.signIn.valueChars)
        ) {
            throw new Error(`one value per field, each up to ${LIMITS.signIn.valueChars} characters`);
        }
        clearTimeout(p.timer);
        this.update(p, { status: "submitting" });
        const site = p.entry.site;
        try {
            await this.deps.fill({ id: p.entry.id, values: values as string[] });
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            this.finish(p, { status: "failed", error });
            this.tell(`The sign-in on ${site} couldn't be filled in: ${error}. Look at window ${p.window} and ask again if it still needs one.`);
            throw new Error(`Couldn't sign in: ${error}`);
        }
        this.finish(p, { status: "submitted" });
        this.tell(`The user filled in the sign-in on ${site} and it was submitted. Look at window ${p.window} to see whether it worked.`);
        return { submitted: true };
    }

    decline(id: unknown) {
        const p = this.waiting(id);
        clearTimeout(p.timer);
        this.finish(p, { status: "declined" });
        this.tell(`The user said no to signing in on ${p.entry.site}. Don't ask again unless they bring it up.`);
        return { declined: true };
    }

    shutdown() {
        // a restart forgets the request; the transcript shows it lapsed
        this.lapse("expired");
    }

    private waiting(id: unknown): Pending {
        const p = this.pending;
        if (!p || p.entry.id !== id || p.entry.status !== "waiting") throw new Error("That sign-in isn't waiting anymore.");
        return p;
    }

    private lapse(status: "expired") {
        const p = this.pending;
        if (!p || p.entry.status !== "waiting") return;
        clearTimeout(p.timer);
        this.finish(p, { status });
    }

    private update(p: Pending, patch: Partial<SignInEntry>) {
        p.entry = { ...p.entry, ...patch };
        this.deps.post(p.entry);
    }

    private finish(p: Pending, patch: Partial<SignInEntry>) {
        this.update(p, patch);
        if (this.pending === p) this.pending = null;
    }

    private tell(text: string) {
        try {
            this.deps.notice(text);
        } catch (e) {
            // the request's bubble already shows how it went; the agent hears of it when it's next asked
            console.error("[ai] couldn't tell the agent about a sign-in:", e instanceof Error ? e.message : String(e));
        }
    }
}

const fault = (text: string): ToolResult => ({ isError: true, text });
