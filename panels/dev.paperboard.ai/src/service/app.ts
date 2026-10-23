// The AI panel's service: the agent, its computer and its one conversation.
//
// Everything the UI shows comes from here, so every open shell (and none)
// sees the same agent: settings and status travel as synced state, the
// conversation as chat-entry events plus a history call.

import path from "node:path";
import {
    HARNESSES,
    LIMITS,
    PANEL_ID,
    EVENTS,
    type AiState,
    type ComputerBudget,
    type Harness,
    type HarnessInfo,
    type Settings,
} from "../contract";
import { Computer, type ComputerHost, hostSupport } from "./computer";
import { startComputerMcp, type ComputerMcp } from "./computerMcp";
import { Conversation, type TurnHost } from "./conversation";
import { HARNESS_COMMANDS } from "./harness";
import { COMPUTER_INSTRUCTIONS, COMPUTER_TOOLS } from "./computerTools";
import { listModels, type HarnessHomes } from "./models";
import { messagesToolset } from "./messages";
import { toolbox, type Toolbox } from "./toolsets";
export { which } from "./which";

export interface AppHost extends ComputerHost, TurnHost {
    storageDir(): Promise<string>;
    readSettings(): Promise<unknown>;
    writeSettings(s: Settings): Promise<void>;
    which(command: string): string | null;
    /** where each harness keeps its own files, for its model catalog */
    harnessHomes: HarnessHomes;
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
    private tools: Toolbox | null = null;
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
        this.tools = toolbox([
            { id: "computer", tools: () => COMPUTER_TOOLS, call: (name, args) => this.computer.callTool(name, args), instructions: () => COMPUTER_INSTRUCTIONS },
            messagesToolset({ say: (text, replyTo) => this.conversation.say(text, replyTo) }),
        ]);
        this.mcp = await startComputerMcp(this.tools);
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
            instructions: () => this.tools!.instructions(),
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

    /** What a brain can think with, from its harness's own catalog. */
    async models(input: unknown) {
        const harness = (input as { harness?: unknown } | undefined)?.harness;
        if (!HARNESSES.includes(harness as Harness)) throw new Error("which brain?");
        return { models: await listModels(harness as Harness, this.host.harnessHomes) };
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

    /** The memory the computer gets from its next start. */
    async setMemory(i: Record<string, unknown>) {
        const budget = parseBudget({ memoryGb: i.memoryGb, diskGb: this.computer.state.budget?.diskGb });
        await this.computer.setBudget(budget);
        return { saved: true, appliesOnRestart: this.computer.state.phase === "ready" || this.computer.state.phase === "starting" };
    }

    async startOver() {
        const r = await this.conversation.clear();
        this.ctx.emit(EVENTS.cleared, {});
        return r;
    }

    // ------------------------------------------------------------- the user's view

    windows() {
        return this.computer.view("view_windows", {});
    }

    frame(i: Record<string, unknown>) {
        return this.computer.view("view_frame", { window: i.window, since: i.since, quality: i.quality });
    }

    input(i: Record<string, unknown>) {
        return this.computer.view("view_input", { window: i.window, events: i.events });
    }

    closeWindow(i: Record<string, unknown>) {
        return this.computer.view("view_close", { window: i.window });
    }

    /** take (or renew) control with take: true; hand it back with take: false */
    control(i: Record<string, unknown>) {
        if (i.take === true) this.computer.takeControl();
        else this.computer.releaseControl();
        return { userControl: this.computer.state.userControl };
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
    return h === "codex" ? "Codex" : "Claude";
}
