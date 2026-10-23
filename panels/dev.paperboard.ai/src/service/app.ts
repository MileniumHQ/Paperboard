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
import { actionsToolset, type ActionsHost } from "./actionsToolset";
import { McpServers, type Vault } from "./mcpServers";
import { mcpToolset } from "./mcpToolset";
import { TOOLS_EVENT, type ToolsConfig, type ToolsView } from "../toolsContract";
import { listModels, type HarnessHomes } from "./models";
import { Memory } from "./memory";
import { messagesToolset } from "./messages";
import { Routines } from "./routines";
import { SignIns } from "./signIn";
import { describeSchedule, localStamp } from "../routineText";
import { toolbox, type Toolbox } from "./toolsets";
export { which } from "./which";

/** What the tool servers and the actions toolset need from the daemon. */
export interface ToolsHost {
    /** a line to a daemon-owned child's stdin */
    write(id: string, data: string): Promise<void>;
    readTools(): Promise<unknown>;
    writeTools(c: ToolsConfig): Promise<void>;
    /** this panel's vault entries, by name */
    vault: Vault;
    /** other panels' actions, through this service's own scoped credential */
    actions: ActionsHost;
}

export interface AppHost extends ComputerHost, TurnHost {
    tools: ToolsHost;
    storageDir(): Promise<string>;
    /** the panel's config document: the agent's settings */
    readSettings(): Promise<unknown>;
    writeSettings(s: Settings): Promise<void>;
    // TODO(remove after v0.3): where 0.3.0 kept the settings, a document of its own (agent.json in the panel's files)
    readLegacySettings(): Promise<unknown>;
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
    memory!: Memory;
    routines!: Routines;
    signIns!: SignIns;
    private mcp: ComputerMcp | null = null;
    private tools: Toolbox | null = null;
    servers!: McpServers;
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
        this.ctx.setState({ settings: await this.loadSettings() });
        this.memory = new Memory({ dir: path.join(root, "memory"), onChange: (memory) => this.ctx.setState({ memory }) });
        const t = this.host.tools;
        this.servers = new McpServers({
            host: { start: this.host.start, write: t.write, kill: this.host.kill, exists: this.host.exists, onStdout: this.host.onStdout, onStderr: this.host.onStderr, onExit: this.host.onExit, which: this.host.which },
            guest: (tool, args) => this.computer.callTool(tool, args),
            computerReady: () => this.computer.state.phase === "ready",
            store: { read: t.readTools, write: t.writeTools },
            vault: t.vault,
            onChange: (view) => this.ctx.emit(TOOLS_EVENT, view),
        });
        await this.servers.load();
        this.routines = new Routines({
            file: path.join(root, "routines.json"),
            run: (r, late) =>
                this.conversation.notice(
                    `Your routine [${r.id}] is due (${describeSchedule(r.schedule)}): ${r.what}` +
                        // r.next is still the time it was due
                        (late && r.next ? ` It was due at ${localStamp(r.next)}; it's late because this computer was asleep or off.` : "") +
                        " Do it now. Text the user with send_message if there's something for them; a check that found nothing needs no text.",
                ),
            onChange: (routines) => this.ctx.setState({ routines }),
        });
        this.signIns = new SignIns({
            prepare: (args) => this.computer.callTool("sign_in_prepare", args),
            fill: (args) => this.computer.view("view_sign_in", args),
            post: (entry) => this.conversation.post(entry),
            notice: (text) => this.conversation.notice(text),
        });
        const tools = toolbox([
            { id: "computer", tools: () => COMPUTER_TOOLS, call: (name, args) => this.computer.callTool(name, args), instructions: () => COMPUTER_INSTRUCTIONS },
            messagesToolset({ say: (text, replyTo) => this.conversation.say(text, replyTo) }),
            this.memory.toolset(),
            this.routines.toolset(),
            this.signIns.toolset(),
            mcpToolset(this.servers),
            actionsToolset({ host: t.actions, enabled: () => this.servers.config.actions }),
        ]);
        // any tool but its messages means the agent is working, not typing, whatever its harness reports
        this.tools = {
            ...tools,
            call: (name, args) => {
                if (name !== "send_message") this.conversation?.working();
                return tools.call(name, args);
            },
        };
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
        // after the conversation exists: a one-off missed while the service was down runs as soon as it's read
        await this.routines.load();
        // a broken index shows in state.memory.error from the start; the failure itself is reported there
        await this.memory.list().then(
            () => undefined,
            (e) => console.error("[ai] memory is unreadable:", String(e)),
        );
    }

    async shutdown() {
        // before the conversation closes, so a waiting request's bubble says it lapsed
        this.signIns?.shutdown();
        const stops = await Promise.allSettled([this.routines?.shutdown(), this.conversation?.shutdown(), this.computer?.shutdown(), this.servers?.shutdown()]);
        for (const r of stops) if (r.status === "rejected") console.error("[ai] shutdown:", String(r.reason));
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

    /**
     * The settings live in the panel's config document. An install from before has them in agent.json
     * instead: moved once, the first time the config document is empty, and the old file left as it was.
     */
    private async loadSettings(): Promise<Settings | null> {
        const saved = await this.host.readSettings();
        if (saved !== null) return parseSettings(saved);
        // TODO(remove after v0.3): the move from agent.json, with readLegacySettings
        const legacy = parseSettings(await this.host.readLegacySettings());
        if (!legacy) return null;
        await this.host.writeSettings(legacy);
        console.warn("[ai] moved the agent's settings from agent.json into the panel's config; agent.json is no longer read (this move goes away in v0.3)");
        return legacy;
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

    /** Start a new conversation, or continue a past one: a waiting sign-in belongs to the one being put away. */
    async newConversation() {
        this.signIns?.shutdown();
        const r = await this.conversation.newConversation();
        this.ctx.emit(EVENTS.switched, {});
        return r;
    }

    async openConversation(id: unknown) {
        this.signIns?.shutdown();
        const r = await this.conversation.open(id);
        this.ctx.emit(EVENTS.switched, {});
        return r;
    }

    // ------------------------------------------------------------- the Tools page

    toolsView(): Promise<ToolsView> {
        return this.servers.view();
    }
    toolsSave(i: Record<string, unknown>) {
        return this.servers.save(i.server);
    }
    toolsRemove(i: Record<string, unknown>) {
        return this.servers.remove(i.name);
    }
    toolsRestart(i: Record<string, unknown>) {
        return this.servers.restart(i.name);
    }
    toolsSetActions(i: Record<string, unknown>) {
        return this.servers.setActions(i.on);
    }
    toolsSetSecret(i: Record<string, unknown>) {
        return this.servers.setSecret(i.server, i.name, i.value);
    }
    toolsDeleteSecret(i: Record<string, unknown>) {
        return this.servers.deleteSecret(i.server, i.name);
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
