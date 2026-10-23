// The AI panel's service: the agent, its computer and its one conversation.
//
// Everything the UI shows comes from here, so every open shell (and none)
// sees the same agent: settings and status travel as synced state, the
// conversation as chat-entry events plus a history call.

import { randomUUID } from "node:crypto";
import path from "node:path";
import {
    HARNESSES,
    LIMITS,
    PANEL_ID,
    EVENTS,
    type AiState,
    type ChatEntry,
    type ComputerBudget,
    type Harness,
    type HarnessInfo,
    type Settings,
} from "../contract";
import { Computer, type ComputerHost, hostSupport } from "./computer";
import { startComputerMcp, type ComputerMcp, type ToolResult } from "./computerMcp";
import { Conversation, type TurnHost } from "./conversation";
import { HARNESS_COMMANDS } from "./harness";
export { which } from "./which";

export interface AppHost extends ComputerHost, TurnHost {
    storageDir(): Promise<string>;
    readSettings(): Promise<unknown>;
    writeSettings(s: Settings): Promise<void>;
    which(command: string): string | null;
}

export interface AppContext {
    state: AiState;
    setState(patch: Partial<AiState>): void;
    emit(event: string, payload: unknown): void;
}

export class AiApp {
    private ctx!: AppContext;
    computer!: Computer;
    conversation!: Conversation;
    private mcp: ComputerMcp | null = null;
    private settle!: (failure: Error | null) => void;
    private readonly settled = new Promise<Error | null>((ok) => (this.settle = ok));

    /** Wait for init. Actions fail with init's error rather than hang on a service that never got ready. */
    async ready(): Promise<void> {
        const failure = await this.settled;
        if (failure) throw new Error(`the AI service didn't start: ${failure.message}`);
    }

    constructor(private host: AppHost) {}

    async init(ctx: AppContext) {
        try {
            await this.prepare(ctx);
        } catch (e) {
            this.settle(e instanceof Error ? e : new Error(String(e)));
            throw e;
        }
        this.settle(null);
        // booting can take minutes; the UI follows it through state.computer
        void this.computer.init().catch((e) => console.error("[ai] the computer didn't start:", String(e)));
    }

    private async prepare(ctx: AppContext) {
        this.ctx = ctx;
        const root = await this.host.storageDir();
        this.ctx.setState({ settings: parseSettings(await this.host.readSettings()) });
        this.mcp = await startComputerMcp((name, args) => this.callTool(name, args));
        this.computer = new Computer({
            host: this.host,
            dir: path.join(root, "computer"),
            storagePath: "computer",
            support: hostSupport,
            onState: (computer) => this.ctx.setState({ computer }),
        });
        this.conversation = new Conversation({
            host: this.host,
            dir: path.join(root, "conversation"),
            settings: () => this.ctx.state.settings,
            resolve: (h) => this.host.which(HARNESS_COMMANDS[h]),
            mcp: () => ({ url: this.mcp!.url, token: this.mcp!.token }),
            emit: (entry) => this.ctx.emit(EVENTS.entry, entry),
            onState: (chat) => this.ctx.setState({ chat }),
        });
        this.conversation.init();
    }

    async shutdown() {
        await Promise.allSettled([this.conversation?.shutdown(), this.computer?.shutdown()]);
        await this.mcp?.close();
    }

    // ------------------------------------------------------------- actions

    async setup(input: unknown) {
        const i = (input ?? {}) as Record<string, unknown>;
        const settings = parseSettings(i.settings);
        if (!settings) throw new Error("name and brain are required");
        if (!this.host.which(HARNESS_COMMANDS[settings.harness])) throw new Error(`${harnessName(settings.harness)} isn't installed on this computer`);
        await this.host.writeSettings(settings);
        this.ctx.setState({ settings });
        return { saved: true };
    }

    detect(): HarnessInfo[] {
        return HARNESSES.map((id) => ({ id, installed: this.host.which(HARNESS_COMMANDS[id]) !== null, version: null }));
    }

    installComputer(input: unknown) {
        const budget = parseBudget((input as { budget?: unknown } | undefined)?.budget);
        // minutes of work: accepted now, followed through state.computer
        void this.computer.install(budget).catch((e) => console.error("[ai] computer setup failed:", String(e)));
        return { accepted: true };
    }

    startComputer() {
        void this.computer.start().catch((e) => console.error("[ai] the computer didn't start:", String(e)));
        return { accepted: true };
    }

    async stopComputer() {
        await this.computer.stop();
        return { stopped: true };
    }

    // ------------------------------------------------------------- the computer's hands

    /** A tool call from the harness: shown in the conversation, carried out by the VM. */
    private async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        const entry: Extract<ChatEntry, { kind: "tool" }> = {
            id: randomUUID(),
            at: Date.now(),
            kind: "tool",
            tool: name,
            summary: summarize(name, args),
            status: "running",
            detail: null,
        };
        this.conversation.add(entry);
        const r = await this.computer.callTool(name, args);
        this.conversation.update({ ...entry, status: r.isError ? "failed" : "done", detail: r.text.slice(0, 600) || null });
        return r;
    }
}

// ------------------------------------------------------------- validation (the service owns these)

export function parseSettings(v: unknown): Settings | null {
    if (!v || typeof v !== "object") return null;
    const s = v as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name || name.length > LIMITS.name) return null;
    if (!HARNESSES.includes(s.harness as Harness)) return null;
    let model: string | null = null;
    if (typeof s.model === "string" && s.model && s.model !== "default") {
        // it lands in argv after -m/--model: it can never be read as a flag
        if (s.model.length > LIMITS.model || !/^\w[\w.:\-/]*$/.test(s.model)) return null;
        model = s.model;
    }
    return { name, harness: s.harness as Harness, model };
}

export function parseBudget(v: unknown): ComputerBudget {
    const b = (v ?? {}) as Record<string, unknown>;
    const memoryGb = Number(b.memoryGb);
    const diskGb = Number(b.diskGb);
    if (!Number.isInteger(memoryGb) || memoryGb < LIMITS.memoryGb.min || memoryGb > LIMITS.memoryGb.max) {
        throw new Error(`memory must be ${LIMITS.memoryGb.min}–${LIMITS.memoryGb.max} GB`);
    }
    if (!Number.isInteger(diskGb) || diskGb < LIMITS.diskGb.min || diskGb > LIMITS.diskGb.max) {
        throw new Error(`storage must be ${LIMITS.diskGb.min}–${LIMITS.diskGb.max} GB`);
    }
    return { memoryGb, diskGb };
}

function harnessName(h: Harness) {
    return h === "codex" ? "Codex" : "Claude Code";
}

/** One line for the conversation: what the agent did with its computer. */
export function summarize(name: string, a: Record<string, unknown>): string {
    const where = a.mark !== undefined ? `mark ${a.mark}` : a.x !== undefined ? `${a.x},${a.y}` : "";
    const s = (() => {
        switch (name) {
            case "shell":
                return String(a.command ?? "").split("\n")[0];
            case "open":
                return String(a.what ?? "");
            case "type":
                return `“${String(a.text ?? "")}”${a.enter ? " ⏎" : ""}`;
            case "key":
                return String(a.keys ?? "");
            case "click":
            case "hover":
            case "scroll":
                return where;
            case "drag":
                return `${where} → ${a.to_mark !== undefined ? `mark ${a.to_mark}` : `${a.to_x},${a.to_y}`}`;
            case "zoom":
                return `${a.x},${a.y} ${a.width}×${a.height}`;
            default:
                return "";
        }
    })();
    return s.length > 120 ? s.slice(0, 119) + "…" : s;
}
