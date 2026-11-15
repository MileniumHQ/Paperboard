// The Agents panel's service: the agent, its computer and its one conversation.
//
// Everything the UI shows comes from here, so every open shell (and none)
// sees the same agent: settings and status travel as synced state, the
// conversation as chat-entry events plus a history call.

import path from "node:path";
import { DEFAULT_MODEL, HARNESSES, EVENTS, TRIGGER_IDS, parseSettings, type AiState, type Harness, type Settings } from "../contract";
import { HomeFolder, moveHomeFolder } from "./homeFolder";
import { Checkpoints } from "./checkpoints";
import { shellToolset } from "./shell";
import { Pages } from "./pages";
import { BrowserComputer, type ComputerHost } from "./browser";
import { browserTool } from "./browserTools";
import { browserView } from "./browserView";
import { Brains, type BrainPackages } from "./brains";
import { errorText } from "../lib/failure";
import { Providers } from "./providers";
import type { LoginMethod } from "./brainLogin";
import { startComputerMcp, type ComputerMcp } from "./computerMcp";
import { Conversation, type TurnHost } from "./conversation";
import { CLAUDE_MEMORY_OFF, HARNESS_NAMES, customSection } from "./harness";
import { COMPUTER_INSTRUCTIONS, COMPUTER_TOOLS } from "./computerTools";
import { filesToolset } from "./attachmentTools";
import { actionsToolset, type ActionsHost } from "./actionsToolset";
import { McpServers, type Vault } from "./mcpServers";
import { checkSecretName } from "./mcpConfig";
import { mcpToolset } from "./mcpToolset";
import { TOOLS_EVENT, type ToolsConfig } from "../toolsContract";
import { askClaudeModels, listModels } from "./models";
import { Memory } from "./memory";
import { messagesToolset } from "./messages";
import { Routines } from "./routines";
import { SignIns } from "./signIn";
import { Access } from "./access";
import { Prompts } from "./prompts";
import { ServerTools } from "./serverTools";
import { describeSchedule, localStamp } from "../routineText";
import { toolbox, type Toolbox } from "./toolsets";
import { Asker } from "./ask";
import { FlowActionsPublisher, flowActions, type ConversationChoice, type FlowHost, type MessageReceived } from "./flowActions";
import { BlocksSync } from "./blocksSync";
import { flowBlocks, replyPayload, type ConversationFacts } from "./flowBlocks";
import type { ActionDefinition, BlocksHandle } from "@mileniumhq/paperapi";
export { findProgram } from "./which";
import type { Launch } from "./which";
import { openTurnLog, type TurnLog } from "./turnLog";

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

export interface AppHost extends Omit<ComputerHost, "packages">, Omit<TurnHost, "write"> {
    /** the daemon's packages: the browser, and the brains */
    packages: BrainPackages;
    tools: ToolsHost;
    storageDir(): Promise<string>;
    /** the panel's config document: the agent's settings */
    readSettings(): Promise<unknown>;
    writeSettings(s: Settings): Promise<void>;
    exec(command: string, args: string[], o?: { timeoutMs?: number; env?: Record<string, string>; cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    /** a program on PATH: for the user's own tool servers */
    findProgram(command: string, args: readonly string[]): Launch | null;
    /** a brain's program already on this computer; the daemon's own lookup when left out */
    findBrain?(harness: Harness): string | null;
    /** register an action again, as it is now: the flow actions' conversation dropdown follows the history */
    registerAction(def: ActionDefinition): Promise<void>;
    /** the panel's blocks for the Blocks panel (Actions API v2) */
    blocks: BlocksHandle;
}

export interface AppContext {
    state: AiState;
    setState(patch: Partial<AiState>): void;
    emit(event: string, payload: unknown): void;
    /** an event flows start from */
    trigger(id: string, payload: unknown): void;
}

export class AiApp {
    private ctx!: AppContext;
    computer!: BrowserComputer;
    brains!: Brains;
    providers!: Providers;
    conversation!: Conversation;
    memory!: Memory;
    routines!: Routines;
    signIns!: SignIns;
    access!: Access;
    prompts!: Prompts;
    serverTools!: ServerTools;
    private mcp: ComputerMcp | null = null;
    pages!: Pages;
    private tools: Toolbox | null = null;
    /** the developer's log of every turn, when PAPERBOARD_AGENT_LOG=1 */
    private turnLog: TurnLog | null = null;
    servers!: McpServers;
    asker!: Asker;
    /** the empty folder Claude runs in when it's asked for its models */
    private modelsDir = "";
    private readonly blocks: BlocksSync;
    private readonly actions: FlowActionsPublisher;
    private settle!: (failure: Error | null) => void;
    private readonly settled = new Promise<Error | null>((ok) => (this.settle = ok));

    /** Wait for init. Actions fail with init's error rather than hang on a service that never got ready. */
    async ready(): Promise<void> {
        const failure = await this.settled;
        if (failure) throw new Error(`the Agent service didn't start: ${failure.message}`);
    }

    constructor(private host: AppHost) {
        this.blocks = new BlocksSync({ blocks: host.blocks, watched: () => this.watched(), memory: () => this.memory.list() });
        this.actions = new FlowActionsPublisher({ choices: () => this.conversationChoices(), actions: () => this.flowActions(), register: (def) => host.registerAction(def) });
    }

    async init(ctx: AppContext) {
        try {
            await this.prepare(ctx);
            await this.blocks.register(this.flowBlocks());
        } catch (e) {
            this.settle(e instanceof Error ? e : new Error(String(e)));
            throw e;
        }
        this.settle(null);
        // the UI follows starting through state.computer
        void this.computer.init().catch((e) => console.error("[agents] the computer didn't start:", String(e)));
    }

    private async prepare(ctx: AppContext) {
        this.ctx = ctx;
        const root = await this.host.storageDir();
        this.modelsDir = path.join(root, "models");
        this.ctx.setState({ settings: await this.loadSettings() });
        this.memory = new Memory({
            dir: path.join(root, "memory"),
            onChange: (memory) => {
                this.ctx.setState({ memory });
                this.blocks.memoryChanged(memory.revision);
            },
        });
        const t = this.host.tools;
        this.servers = new McpServers({
            host: { start: this.host.start, write: t.write, kill: this.host.kill, exists: this.host.exists, onStdout: this.host.onStdout, onStderr: this.host.onStderr, onExit: this.host.onExit, findProgram: this.host.findProgram },
            store: { read: t.readTools, write: t.writeTools },
            vault: t.vault,
            onChange: (view) => {
                this.ctx.emit(TOOLS_EVENT, view);
                this.serverTools?.seen(view);
                this.blocks.announce("tool-servers");
            },
        });
        await this.servers.load();
        this.routines = new Routines({
            file: path.join(root, "routines.json"),
            run: (r, late) => {
                this.conversation.notice(
                    `Your routine [${r.id}] is due (${describeSchedule(r.schedule)}): ${r.what}` +
                        // r.next is still the time it was due
                        (late && r.next ? ` It was due at ${localStamp(r.next)}; it's late because this computer was asleep or off.` : "") +
                        " Do it now. Text the user with send_message if there's something for them; a check that found nothing needs no text.",
                );
                this.blocks.fire("routine-fired", { routine: r.id, task: r.what, late });
            },
            onChange: (routines) => {
                this.ctx.setState({ routines });
                this.blocks.announce("routines");
            },
        });
        this.signIns = new SignIns({
            prepare: (args) => browserTool(this.computer, "sign_in_prepare", args),
            fill: (args) => browserView(this.computer, "view_sign_in", args),
            post: (entry) => this.conversation.post(entry),
            notice: (text) => this.conversation.notice(text),
        });
        this.access = new Access({
            file: path.join(root, "access.json"),
            findProgram: (command, args) => this.host.findProgram(command, args),
            exec: (command, args, o) => this.host.exec(command, args, o),
            post: (entry) => this.conversation.post(entry),
            notice: (text) => this.conversation.notice(text),
            turning: () => this.conversation?.turning() ?? false,
            onChange: (view) => this.ctx.emit(EVENTS.access, view),
        });
        this.access.load();
        this.prompts = new Prompts({
            hasServer: (server) => this.servers.config.servers.some((x) => x.name === server),
            checkSecretName,
            saveSecret: (server, name, value) => this.servers.setSecret(server, name, value),
            post: (entry) => this.conversation.post(entry),
            notice: (text) => this.conversation.notice(text),
        });
        this.serverTools = new ServerTools({
            servers: this.servers,
            findProgram: (command, args) => this.host.findProgram(command, args),
            post: (entry) => this.conversation.post(entry),
            notice: (text) => this.conversation.notice(text),
        });
        const brainsHost = { ...this.host, write: this.host.tools.write };
        this.brains = new Brains({ host: brainsHost, dir: path.join(root, "brains"), find: this.host.findBrain, onState: (brains) => this.ctx.setState({ brains }) });
        this.providers = new Providers({
            host: brainsHost,
            program: () => this.brains.resolve("opencode"),
            env: () => this.brains.env("opencode"),
            cwd: this.brains.home("opencode"),
            onChange: () => this.brains.refresh("opencode"),
        });
        // looked at before the conversation can take a turn, so an installed brain is never "not installed" for a moment
        await this.brains.init();
        // its own folder beside the browser's, where it used to be inside it
        moveHomeFolder(path.join(root, "browser", "home"), path.join(root, "home"));
        const home = new HomeFolder(path.join(root, "home"));
        home.ensure();
        this.turnLog = openTurnLog(path.join(root, "debug"));
        // the service's own files for the pages keep the names they had when pages were apps
        const pages = new Pages({
            home,
            portFile: path.join(root, "apps.json"),
            infoFile: path.join(root, "app-info.json"),
            picturesDir: path.join(root, "app-pictures"),
            exportsDir: path.join(root, "page-exports"),
            picture: (url) => this.computer.picture(url),
            pdf: (url) => this.computer.pdf(url),
            post: (entry) => this.conversation.post(entry),
            onChange: () => {
                this.ctx.setState({ pages: { revision: this.ctx.state.pages.revision + 1 } });
                // the Blocks list keeps its id from when pages were apps
                this.blocks.announce("apps");
            },
        });
        this.pages = pages;
        pages.watch();
        const checkpoints = new Checkpoints({ home, dir: path.join(root, "checkpoints") });
        const tools = toolbox([
            { id: "computer", tools: () => COMPUTER_TOOLS, call: (name, args) => browserTool(this.computer, name, args), instructions: () => COMPUTER_INSTRUCTIONS, context: () => this.computer.openWindowsNote() },
            messagesToolset({ say: (text, replyTo, files) => this.conversation.say(text, replyTo, files) }),
            shellToolset(home),
            pages.toolset(),
            checkpoints.toolset(),
            filesToolset({
                files: () => this.conversation.attachments,
                getFile: (p) => this.computer.getFile(p),
                putFile: (p, data) => this.computer.putFile(p, data),
            }),
            this.memory.toolset(),
            this.routines.toolset(),
            this.signIns.toolset(),
            this.access.toolset(),
            this.prompts.toolset(),
            this.serverTools.toolset(),
            mcpToolset(this.servers),
            actionsToolset({ host: t.actions, enabled: () => this.servers.config.actions }),
        ], () => this.conversation?.mode() ?? { fromFlow: false });
        // any tool but its messages means the agent is working, not typing, whatever its harness reports
        this.tools = {
            ...tools,
            // a flow's turn ends with the user's instructions for it: the flow's own, or else the ones in settings
            instructions: async () => {
                const own = await tools.instructions();
                const mode = this.conversation?.mode();
                const custom = mode?.fromFlow ? (mode.instructions ?? this.ctx.state.settings?.automationInstructions ?? null) : null;
                return custom ? { ...own, now: [...own.now, customSection(custom)] } : own;
            },
            call: async (name, args) => {
                // a summary is written from what it already knows: no texting, no work
                if (this.conversation?.compacting) return { text: "You're writing a summary of the conversation: no texts and no tools until it's done.", isError: true };
                if (name !== "send_message") this.conversation?.working();
                if (!this.turnLog) return tools.call(name, args);
                const started = Date.now();
                try {
                    const result = await tools.call(name, args);
                    this.turnLog.tool({ name, args, result, ms: Date.now() - started, isError: result.isError === true });
                    return result;
                } catch (e) {
                    this.turnLog.tool({ name, args, result: { thrown: errorText(e) }, ms: Date.now() - started, isError: true });
                    throw e;
                }
            },
        };
        this.mcp = await startComputerMcp(this.tools);
        // the VM computer's folder ("computer") is left as it is: it's the user's, and nothing reads it anymore
        this.computer = new BrowserComputer({
            host: this.host,
            dir: path.join(root, "browser"),
            home,
            storagePath: "browser",
            pages: (host, port) => pages.serves(host, port),
            onState: (computer) => {
                this.ctx.setState({ computer });
                this.blocks.announce("computer-running");
            },
        });
        this.conversation = new Conversation({
            host: { ...this.host, write: this.host.tools.write },
            dir: path.join(root, "conversation"),
            log: this.turnLog,
            settings: () => this.ctx.state.settings,
            resolve: (h) => this.brains.resolve(h),
            env: (h) => this.brains.env(h),
            problem: (h) => this.brainProblem(h),
            mcp: () => ({ url: this.mcp!.url, token: this.mcp!.token, onToolsListed: (cb) => this.mcp!.onToolsListed(cb) }),
            instructions: () => this.tools!.instructions(),
            emit: (entry) => {
                this.ctx.emit(EVENTS.entry, entry);
                if (entry.kind === "agent") {
                    const message: MessageReceived = {
                        text: entry.text,
                        attachments: (entry.attachments ?? []).map((a) => ({ name: a.name, kind: a.kind, type: a.type, bytes: a.bytes, path: this.conversation.attachments.path(a.id) })),
                        messageId: entry.id,
                        conversationId: this.conversation.id(),
                        replyTo: entry.replyTo ?? "",
                    };
                    this.ctx.trigger(TRIGGER_IDS.messageReceived, message);
                    this.blocks.fire(TRIGGER_IDS.messageReceived, replyPayload(message));
                }
                // its first message names the current conversation in the dropdown
                if (entry.kind === "user" || entry.kind === "agent") this.publish();
            },
            onTurnFailed: (error) => this.blocks.fire("turn-failed", { error, conversation: this.conversation.id() }),
            onTurnEnd: () => this.access.turnEnded(),
            onState: (chat) => this.ctx.setState({ chat }),
            codexHome: this.brains.homes.codex,
        });
        this.conversation.init();
        this.asker = new Asker({
            host: { ...this.host, write: this.host.tools.write },
            settings: () => this.ctx.state.settings,
            resolve: (h) => this.brains.resolve(h),
            env: (h) => this.brains.env(h),
            problem: (h) => this.brainProblem(h),
            workdir: path.join(root, "ask"),
            filesDir: path.join(root, "ask-run"),
            log: this.turnLog,
        });
        // after the conversation exists: a one-off missed while the service was down runs as soon as it's read
        await this.routines.load();
        // a broken index shows in state.memory.error from the start; the failure itself is reported there
        await this.memory.list().then(
            () => undefined,
            (e) => console.error("[agents] memory is unreadable:", String(e)),
        );
    }

    /** What the conversation was waiting on lapses with it: its sign-in, access, prompt and tool-server requests. */
    private lapseRequests() {
        this.signIns?.shutdown();
        this.access?.shutdown();
        this.prompts?.shutdown();
        this.serverTools?.shutdown();
    }

    async shutdown() {
        // before the conversation closes, so a waiting request's bubble says it lapsed
        this.lapseRequests();
        const stops = await Promise.allSettled([
            this.routines?.shutdown(),
            this.conversation?.shutdown(),
            this.asker?.shutdown(),
            this.computer?.shutdown(),
            this.servers?.shutdown(),
            this.brains?.shutdown(),
            this.providers?.stop(),
        ]);
        for (const r of stops) if (r.status === "rejected") console.error("[agents] shutdown:", String(r.reason));
        await Promise.all([this.mcp?.close(), this.pages?.close()]);
    }

    // ------------------------------------------------------------- actions

    async setup(input: unknown) {
        const settings = parseSettings(((input ?? {}) as Record<string, unknown>).settings);
        const brain = this.brains.snapshot()[settings.harness];
        if (brain.phase !== "ready") {
            throw new Error(`${HARNESS_NAMES[settings.harness]} isn't ready: ${brain.installed ? "sign in to it first" : "install it first"}`);
        }
        await this.host.writeSettings(settings);
        this.ctx.setState({ settings });
        this.blocks.announce("current-brain");
        this.blocks.announce("current-model");
        return { saved: true };
    }

    /** The settings live in the panel's config document; none yet is a fresh install. One that won't read is never taken for none. */
    private async loadSettings(): Promise<Settings | null> {
        const saved = await this.host.readSettings();
        if (saved === null) return null;
        try {
            return parseSettings(saved);
        } catch (e) {
            throw new Error(`the agent's settings can't be read (${errorText(e)}); they were left as they are`);
        }
    }

    /** What a brain can think with, from its harness's own catalog. */
    async models(input: unknown) {
        const harness = this.harnessOf(input);
        // OpenCode's own listing opens the folder its provider server is using
        if (harness === "opencode" && !(await this.providers.quiet())) throw new Error("Finish connecting the provider first.");
        return {
            models: await listModels(harness, this.brains.homes, (command, args, o) => {
                const h: Harness = command === "codex" ? "codex" : "opencode";
                const resolved = this.brains.resolve(h);
                if (!resolved) throw new Error(`${HARNESS_NAMES[h]} isn't installed`);
                return this.host.exec(resolved, args, { timeoutMs: o.timeoutMs, env: this.brains.env(h) });
            }, () => {
                const command = this.brains.resolve("claude-code");
                if (!command) throw new Error("Claude isn't installed");
                return askClaudeModels({ ...this.host, write: this.host.tools.write }, { command, env: { ...this.brains.env("claude-code"), ...CLAUDE_MEMORY_OFF }, cwd: this.modelsDir });
            }),
        };
    }

    /** Why a brain can't think right now, in words that say how to fix it; null when it can. */
    private brainProblem(harness: Harness): string | null {
        const b = this.brains.snapshot()[harness];
        if (b.phase === "ready" || b.phase === "signing-in" || b.phase === "installing") return null;
        const name = HARNESS_NAMES[harness];
        if (b.phase === "installed") return `${name} isn't signed in. Sign in to it in the agent's settings.`;
        if (b.phase === "failed" && b.installed) return `${name} isn't working: ${b.error}`;
        return null;
    }

    private harnessOf(input: unknown): Harness {
        const harness = (input as { harness?: unknown } | undefined)?.harness;
        if (!HARNESSES.includes(harness as Harness)) throw new Error("which brain?");
        return harness as Harness;
    }

    // ------------------------------------------------------------- brains

    installBrain(input: unknown) {
        const harness = this.harnessOf(input);
        const from = (input as { from?: unknown }).from;
        if (from !== undefined && from !== "computer" && from !== "package") throw new Error("install a brain from the computer or from its package");
        // choosing the one on the computer is quick, and a refusal is the asker's to see. A chosen program
        // that then fails is the brain's own error, shown in state.brains: it isn't answered a second time.
        if (from === "computer") {
            return this.brains.useFound(harness).then(
                () => ({ accepted: true }),
                (e) => {
                    if (this.brains.snapshot()[harness].error !== errorText(e)) throw e;
                    console.error(`[agents] ${HARNESS_NAMES[harness]} on this computer wasn't used:`, String(e));
                    return { accepted: true };
                },
            );
        }
        // a download and an unpack: accepted now, followed through state.brains
        void (from === "package" ? this.brains.installOwn(harness) : this.brains.install(harness)).catch((e) => console.error(`[agents] ${HARNESS_NAMES[harness]} didn't install:`, String(e)));
        return { accepted: true };
    }

    async signInBrain(input: unknown) {
        const harness = this.harnessOf(input);
        const method = (input as { method?: unknown }).method;
        if (method !== undefined && method !== "browser" && method !== "code") throw new Error("sign in with the browser or with a code");
        await this.brains.signIn(harness, method as LoginMethod | undefined);
        return { started: true };
    }

    async brainCode(input: unknown) {
        await this.brains.submitCode(this.harnessOf(input), (input as { code?: unknown }).code);
        return { sent: true };
    }

    async brainAddress(input: unknown) {
        await this.brains.finishAt(this.harnessOf(input), (input as { address?: unknown }).address);
        return { sent: true };
    }

    async cancelBrainSignIn(input: unknown) {
        await this.brains.cancelSignIn(this.harnessOf(input));
        return { cancelled: true };
    }

    async signOutBrain(input: unknown) {
        await this.brains.signOut(this.harnessOf(input));
        return { signedOut: true };
    }

    async providerList() {
        return { providers: await this.providers.list() };
    }

    installComputer() {
        // a download and an unpack: accepted now, followed through state.computer
        void this.computer.install().catch((e) => console.error("[agents] computer setup failed:", String(e)));
        return { accepted: true };
    }

    startComputer() {
        void this.computer.start().catch((e) => console.error("[agents] the computer didn't start:", String(e)));
        return { accepted: true };
    }

    async stopComputer() {
        await this.computer.stop();
        return { stopped: true };
    }

    async startOver() {
        this.lapseRequests();
        const r = await this.conversation.clear();
        this.ctx.emit(EVENTS.cleared, {});
        this.publish();
        return r;
    }

    /** Start a new conversation, or continue a past one: what's waiting belongs to the one being put away. */
    async newConversation() {
        this.lapseRequests();
        const r = await this.conversation.newConversation();
        this.ctx.emit(EVENTS.switched, {});
        this.publish();
        return r;
    }

    async openConversation(id: unknown) {
        this.lapseRequests();
        const r = await this.conversation.open(id);
        this.ctx.emit(EVENTS.switched, {});
        this.publish();
        return r;
    }

    deleteConversation(id: unknown) {
        if (id === this.conversation.id()) throw new Error("The current conversation can't be deleted: clear it, or switch to another one first.");
        const r = this.conversation.deletePast(id);
        this.publish();
        return r;
    }

    // ------------------------------------------------------------- flows

    /** The actions flows use, with the conversation dropdown as the history is now. */
    flowActions(): ActionDefinition[] {
        return flowActions(this.flowHost(), this.conversation ? this.conversationChoices() : []);
    }

    /** The blocks flows use in the Blocks panel: the same host as the actions. */
    flowBlocks() {
        return flowBlocks({
            ...this.flowHost(),
            currentConversation: () => this.conversation.id(),
            conversations: () => this.conversationIds(),
            conversation: (id) => this.conversationFacts(id),
            messages: (id) => this.conversation.texts(id).map((e) => e.id),
            message: (conversation, id) => {
                const e = this.conversation.text(conversation, id);
                return { text: e.text, from: e.kind };
            },
            deleteConversation: (id) => this.deleteConversation(id),
            clearConversation: () => this.startOver(),
            memory: this.memory,
            routines: this.routines,
            computerRunning: () => this.computer.state.phase === "ready",
            startComputer: () => this.computer.start(),
            stopComputer: async () => void (await this.stopComputer()),
            models: {
                list: async () => (await this.models({ harness: this.settings().harness })).models,
                current: () => this.settings().model ?? DEFAULT_MODEL,
                choose: async (model) => void (await this.setup({ settings: { ...this.settings(), model } })),
            },
            brains: {
                state: () => this.brains.snapshot(),
                current: () => this.settings().harness,
                // a model belongs to its brain: the new one starts on its own default, as the settings do it
                choose: async (harness) => void (await this.setup({ settings: { ...this.settings(), harness, model: null } })),
                install: (harness) => this.brains.installOwn(harness),
                useFound: (harness) => this.brains.useFound(harness),
                signOut: (harness) => this.brains.signOut(harness),
            },
            toolServers: {
                list: () => this.toolServers(),
                setEnabled: (name, on) => this.servers.setEnabled(name, on),
                restart: (name) => this.servers.restart(name),
            },
            pages: this.pages,
        });
    }

    /** The agent's settings; a flow can't change them before the agent is set up. */
    private settings(): Settings {
        const settings = this.ctx.state.settings;
        if (!settings) throw new Error("The agent isn't set up yet: set it up in the Agent panel first.");
        return settings;
    }

    private toolServers() {
        const status = this.servers.status();
        return this.servers.config.servers.map((s) => ({ ...status.find((x) => x.name === s.name)!, enabled: s.enabled }));
    }

    private flowHost(): FlowHost {
        return {
            ready: () => this.ready(),
            switchConversation: async (id) => {
                if (id === null) await this.newConversation();
                else if (id !== this.conversation.id()) await this.openConversation(id);
                return this.conversation.id();
            },
            send: (text, instructions) => this.conversation.send(text, null, [], { fromFlow: true, instructions }).id,
            ask: (question, instructions) => this.asker.ask(question, instructions),
        };
    }

    private conversationIds(): string[] {
        return this.conversationChoices().map((c) => c.value);
    }

    private conversationFacts(id: string): ConversationFacts {
        if (id === this.conversation.id()) {
            const current = this.conversation.current();
            // every text, not only the ones the chat keeps in memory
            return current ? { title: current.title, messages: this.conversation.texts(id).length } : { title: "New conversation", messages: 0 };
        }
        const past = this.conversation.past().find((c) => c.id === id);
        if (!past) throw new Error(`the agent has no conversation "${id}"; it may have been deleted`);
        return { title: past.title, messages: past.messages };
    }

    /** The values Blocks is told about when they change, read as Blocks compares them. */
    private watched(): Record<string, () => unknown> {
        return {
            "current-conversation": () => this.conversation.id(),
            conversations: () => this.conversationIds(),
            routines: () => this.routines.list().map((r) => r.id),
            "computer-running": () => this.computer.state.phase === "ready",
            // nothing before the agent is set up: its first settings are a change
            "current-brain": () => this.ctx.state.settings?.harness ?? null,
            "current-model": () => (this.ctx.state.settings ? (this.ctx.state.settings.model ?? DEFAULT_MODEL) : null),
            "tool-servers": () => this.servers.config.servers.map((s) => s.name),
            apps: () => this.pages.list().map((a) => a.name),
        };
    }

    /** The current conversation (once it has messages), then the history, newest first. */
    conversationChoices(): ConversationChoice[] {
        const current = this.conversation.current();
        return [
            ...(current ? [{ label: current.title, value: this.conversation.id() }] : []),
            ...this.conversation.past().map((c) => ({ label: c.title, value: c.id })),
        ];
    }

    /** Blocks and flows follow the conversation dropdown: the history, or which conversation is current, changed. */
    publish(): Promise<void> {
        this.blocks.announce("current-conversation");
        this.blocks.announce("conversations");
        return this.actions.publish();
    }

    // ------------------------------------------------------------- the user's view

    /** take (or renew) control with take: true; hand it back with take: false */
    control(i: Record<string, unknown>) {
        if (i.take === true) this.computer.takeControl();
        else this.computer.releaseControl();
        return { userControl: this.computer.state.userControl };
    }
}
