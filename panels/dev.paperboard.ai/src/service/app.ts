// The AI service: owns the Ollama runtime, models, conversations and the
// approval gate, and mirrors them into panel state for the UI.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    actionsApi,
    config,
    fileApi,
    packageApi,
    panelsApi,
    processApi,
    secretsApi,
    systemApi,
    type ServiceContext,
} from "@mileniumhq/paperapi";
import { EVENTS, OLLAMA_PACKAGE, OLLAMA_PROC_ID, PANEL_ID, TRIGGER_IDS } from "../contract";
import { askSystemPrompt, isConversationId, isPromptStyle } from "../core/conversation";
import {
    activeProviders,
    CUSTOM_PROVIDER,
    CUSTOM_PROVIDER_ID,
    DEFAULT_PROVIDER_ID,
    credentialsAllowed,
    normalizeBaseUrl,
    OLLAMA_PROVIDER_ID,
    providerFor,
} from "../core/providers";
import { isReasoningLevel } from "../core/reasoning";
import type { RegistryAction } from "../core/tools";
import {
    DEFAULT_SETTINGS,
    type AiState,
    type Conversation,
    type ModelSpeed,
    type PromptStyle,
    type ProviderChoice,
    type ProviderConfig,
    type RuntimeState,
    type Settings,
} from "../core/types";
import { republishPublicActions } from "./actions";
import { runShell, webSearch } from "./builtins";
import { askOnce, ChatEngine, type ApprovalDecision } from "./chat";
import { canonicalRef, ModelManager } from "./models";
import { OpenAICompatibleClient } from "./openaiClient";
import { providerClients } from "./provider";
import { OllamaRuntime, type ProcessHost, type RuntimeLayout } from "./runtime";
import { ConversationStore } from "./store";

export type Ctx = ServiceContext<AiState>;

interface StoredConfig {
    settings?: Partial<Settings>;
    alwaysAllowed?: string[];
    speeds?: Record<string, ModelSpeed>;
    /** provider choice and custom endpoint; the API key lives in the vault */
    provider?: { id?: string; baseUrl?: string };
}

// the custom endpoint's API key is a vault secret, never panel config
const OPENAI_API_KEY_SECRET = "openai-api-key";

const MAX_ALWAYS_ALLOWED = 500;
const MAX_SPEEDS = 100;
// under the 30 s default action-call timeout, so flows get a real error
export const ASK_DEADLINE_MS = 28_000;

export const processHost: ProcessHost = {
    start: (options) => processApi.start(options),
    kill: (id, signal) => processApi.kill(id, signal),
    exists: (id) => processApi.exists(id),
    onData: (id, cb) => processApi.onData(id, cb),
    onExit: (id, cb) => processApi.onExit(id, cb),
};

function clampSettings(input: Partial<Settings> | undefined): Settings {
    const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
    return {
        defaultModel: typeof s.defaultModel === "string" ? s.defaultModel.slice(0, 200) : "",
        contextLength: Number.isInteger(s.contextLength) ? Math.min(131_072, Math.max(2048, s.contextLength)) : DEFAULT_SETTINGS.contextLength,
        reasoning: isReasoningLevel(s.reasoning) ? s.reasoning : DEFAULT_SETTINGS.reasoning,
        panelActions: typeof s.panelActions === "boolean" ? s.panelActions : DEFAULT_SETTINGS.panelActions,
        webSearch: typeof s.webSearch === "boolean" ? s.webSearch : DEFAULT_SETTINGS.webSearch,
        shellCommands: typeof s.shellCommands === "boolean" ? s.shellCommands : DEFAULT_SETTINGS.shellCommands,
        promptStyle: isPromptStyle(s.promptStyle) ? s.promptStyle : DEFAULT_SETTINGS.promptStyle,
    };
}

export class AiApp {
    private ctx!: Ctx;
    private filesDir = "";
    private configLoaded = false;
    private stored: StoredConfig = {};
    private configQueue: Promise<unknown> = Promise.resolve();
    readonly runtime: OllamaRuntime;
    readonly models: ModelManager;
    store!: ConversationStore;
    chat!: ChatEngine;
    private resolveReady!: () => void;
    readonly ready = new Promise<void>((resolve) => (this.resolveReady = resolve));

    constructor(
        private readonly host: ProcessHost = processHost,
        options: { readyTimeoutMs?: number } = {},
    ) {
        this.runtime = new OllamaRuntime({
            procId: OLLAMA_PROC_ID,
            host,
            onState: (patch) => this.patchRuntime(patch),
            ...(options.readyTimeoutMs !== undefined ? { readyTimeoutMs: options.readyTimeoutMs } : {}),
        });
        this.models = new ModelManager({
            clients: () => this.buildProviderClients(),
            onModels: (models) => {
                this.ctx.setState({ models });
                // the model dropdowns on Ask AI and the triggers follow this list
                void republishPublicActions(this).catch((err) =>
                    console.error("[ai] republishing action options failed:", String(err)),
                );
            },
            onPulls: (pulls) => this.ctx.setState({ pulls }),
            onDownloaded: (model) => this.ctx.emitTrigger(TRIGGER_IDS.modelDownloaded, model),
        });
    }

    private patchRuntime(patch: Partial<RuntimeState>): void {
        this.ctx.setState((prev) => ({ runtime: { ...prev.runtime, ...patch } }));
        if (patch.status === "ready") {
            this.models.refresh().catch((err) => console.error("[ai] model list failed after start:", String(err)));
        }
        if (patch.status === "stopped" || patch.status === "error") {
            this.models.cancelAll();
        }
    }

    // ─── provider selection ────────────────────────────────────────────────

    /** The providers reachable right now, from the stored provider choice. */
    private configuredProviders() {
        const provider = this.ctx?.state.provider;
        return activeProviders(provider && provider.id === CUSTOM_PROVIDER_ID ? provider.baseUrl : undefined);
    }

    private async apiKeyFor(providerId: string): Promise<string | undefined> {
        if (providerId !== CUSTOM_PROVIDER_ID) return undefined;
        if (!this.ctx?.state.provider.hasApiKey) return undefined;
        const { found, value } = await secretsApi.get(OPENAI_API_KEY_SECRET, PANEL_ID);
        return found && value ? value : undefined;
    }

    private async secretExists(): Promise<boolean> {
        try {
            const { found, value } = await secretsApi.get(OPENAI_API_KEY_SECRET, PANEL_ID);
            return found && Boolean(value);
        } catch (err) {
            console.warn("[ai] could not read the endpoint API key from the vault:", String(err));
            return false;
        }
    }

    private buildProviderClients() {
        return providerClients(
            { ollama: this.runtime.api, apiKeyFor: (id) => this.apiKeyFor(id) },
            this.configuredProviders(),
        );
    }

    private providerStateFromStored(): ProviderConfig {
        const saved = this.stored.provider;
        const id: ProviderChoice = saved?.id === CUSTOM_PROVIDER_ID ? CUSTOM_PROVIDER_ID : OLLAMA_PROVIDER_ID;
        const baseUrl = id === CUSTOM_PROVIDER_ID && typeof saved?.baseUrl === "string" ? saved.baseUrl : "";
        return { id, baseUrl, hasApiKey: false, configured: Boolean(saved?.id) };
    }

    /**
     * Persists the chosen provider. The custom endpoint's API key goes to the
     * vault (panel id explicit), never to the config document or state.
     */
    async setProvider(input: {
        id?: unknown;
        baseUrl?: unknown;
        apiKey?: unknown;
        clearApiKey?: unknown;
    }): Promise<ProviderConfig> {
        const id: ProviderChoice = input.id === CUSTOM_PROVIDER_ID ? CUSTOM_PROVIDER_ID : OLLAMA_PROVIDER_ID;
        let baseUrl = "";
        if (id === CUSTOM_PROVIDER_ID) {
            if (typeof input.baseUrl !== "string" || !input.baseUrl.trim()) {
                throw new Error("An endpoint URL is required.");
            }
            baseUrl = normalizeBaseUrl(input.baseUrl);
            const previous = this.stored.provider;
            const previousBaseUrl =
                previous?.id === CUSTOM_PROVIDER_ID && typeof previous.baseUrl === "string"
                    ? previous.baseUrl
                    : "";
            if (input.clearApiKey === true) {
                await secretsApi.delete(OPENAI_API_KEY_SECRET, PANEL_ID);
            } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
                if (!credentialsAllowed(baseUrl)) {
                    throw new Error(
                        "Refusing to store an API key for a plaintext http endpoint. Use https, or a loopback address.",
                    );
                }
                await secretsApi.set(OPENAI_API_KEY_SECRET, input.apiKey.trim(), PANEL_ID);
            } else if (baseUrl !== previousBaseUrl) {
                // a key belongs to the endpoint it was entered for:
                // changing the endpoint must not carry it to the new host
                await secretsApi.delete(OPENAI_API_KEY_SECRET, PANEL_ID);
            }
        }
        await this.saveConfig((c) => {
            c.provider = { id, baseUrl };
        });
        const hasApiKey = id === CUSTOM_PROVIDER_ID ? await this.secretExists() : false;
        const provider: ProviderConfig = { id, baseUrl, hasApiKey, configured: true };
        this.ctx.setState({ provider });
        if (id === CUSTOM_PROVIDER_ID) {
            await this.models.refresh();
        } else if (this.ctx.state.runtime.status !== "ready") {
            // setup already started Ollama; never bounce a ready runtime
            await this.startIfInstalled();
        }
        return provider;
    }

    /** Probes a custom endpoint's /v1/models without persisting anything. */
    async testProvider(input: { baseUrl?: unknown; apiKey?: unknown }): Promise<{ models: number }> {
        if (typeof input.baseUrl !== "string" || !input.baseUrl.trim()) {
            throw new Error("An endpoint URL is required.");
        }
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        const typed = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : undefined;
        const key = typed ?? (await this.apiKeyFor(CUSTOM_PROVIDER_ID));
        if (key && !credentialsAllowed(baseUrl)) {
            throw new Error(
                "Refusing to send an API key over plaintext http. Use https, or a loopback address.",
            );
        }
        const client = new OpenAICompatibleClient({ ...CUSTOM_PROVIDER, baseUrl }, async () => key);
        const tags = await client.tags();
        return { models: tags.length };
    }

    async init(ctx: Ctx): Promise<void> {
        this.ctx = ctx;
        this.filesDir = await fileApi.getPath("", PANEL_ID);
        for (const dir of ["models", "home", "conversations"]) {
            await fs.promises.mkdir(path.join(this.filesDir, dir), { recursive: true });
        }
        this.store = new ConversationStore(this.filesDir);
        this.chat = new ChatEngine({
            ownPanelId: PANEL_ID,
            clientFor: (providerId) => this.chatClientFor(providerId),
            providerOf: (model) => this.models.providerOf(model),
            store: this.store,
            settings: () => this.ctx.state.settings,
            capabilities: (model) => this.models.capabilities(model),
            listActions: () => actionsApi.list() as Promise<RegistryAction[]>,
            panelNames: () => this.panelNames(),
            callAction: (panelId, action, args) => actionsApi.call(panelId, action, args),
            isAllowed: (key) => this.ctx.state.alwaysAllowed.includes(key),
            rememberAllowed: (key) => this.allowAlways(key),
            webSearch: (query, signal) => webSearch(query, signal),
            runShell: (command, signal) => runShell(command, signal),
            onDelta: (payload) => this.ctx.emit(EVENTS.chatDelta, payload),
            onMessage: (payload) => this.ctx.emit(EVENTS.chatMessage, payload),
            onSummaries: (conversations) => this.ctx.setState({ conversations }),
            onGenerating: (generating) => this.ctx.setState({ generating }),
            onApprovals: (approvals) => this.ctx.setState({ approvals }),
            onSpeed: (model, tps) => void this.recordSpeed(model, tps),
            onReplyFinished: (payload) => this.ctx.emitTrigger(TRIGGER_IDS.replyFinished, payload),
        });
        await this.loadConfig();
        await this.loadConversations();
        // actions wait for settings and history, not for Ollama to boot —
        // and neither does the daemon's service-ready gate. Awaiting the
        // runtime here coupled readiness to Ollama's 60 s boot, so a slow or
        // crashed Ollama made the daemon kill the service at its 20 s
        // deadline and, after five restarts, abandon the panel entirely
        // (the Windows GPU-crash report). Start it in the background; its
        // state surfaces through patchRuntime either way.
        this.resolveReady();
        void this.refreshHardware();
        if (this.ctx.state.provider.id === CUSTOM_PROVIDER_ID) {
            // a URL provider needs no runtime; just read its model list
            void this.models.refresh().catch((err) => console.error("[ai] listing endpoint models failed:", String(err)));
        } else {
            void this.startIfInstalled().catch((err) => console.error("[ai] Ollama startup task failed:", String(err)));
        }
    }

    // ─── settings & permissions (the panel's config document) ────────────

    private async loadConfig(): Promise<void> {
        try {
            const saved = (await config.get<StoredConfig | null>(PANEL_ID)) ?? {};
            this.stored = typeof saved === "object" ? saved : {};
            this.configLoaded = true;
            const provider = this.providerStateFromStored();
            if (provider.id === CUSTOM_PROVIDER_ID) provider.hasApiKey = await this.secretExists();
            this.ctx.setState({
                settings: clampSettings(this.stored.settings),
                provider,
                alwaysAllowed: Array.isArray(this.stored.alwaysAllowed) ? this.stored.alwaysAllowed.filter((k) => typeof k === "string") : [],
                speeds: this.stored.speeds && typeof this.stored.speeds === "object" ? this.stored.speeds : {},
            });
        } catch (err) {
            // unreadable is not empty: keep defaults in memory, refuse to
            // overwrite the stored document until it can be read
            console.error("[ai] settings unreadable:", String(err));
            this.ctx.setState({ storageError: `Settings could not be read: ${String(err)}` });
        }
    }

    private saveConfig(mutate: (c: StoredConfig) => void): Promise<void> {
        const next = this.configQueue.then(async () => {
            if (!this.configLoaded) throw new Error("Settings could not be read, so changes are not saved. Restart the panel to retry.");
            const draft: StoredConfig = JSON.parse(JSON.stringify(this.stored));
            mutate(draft);
            await config.set(draft, PANEL_ID);
            this.stored = draft;
        });
        this.configQueue = next.catch((err) => console.debug("[ai] config write failed:", String(err)));
        return next;
    }

    async updateSettings(patch: Partial<Settings>): Promise<Settings> {
        const settings = clampSettings({ ...this.ctx.state.settings, ...patch });
        await this.saveConfig((c) => {
            c.settings = settings;
        });
        this.ctx.setState({ settings });
        return settings;
    }

    async allowAlways(key: string): Promise<void> {
        const list = [...new Set([...this.ctx.state.alwaysAllowed, key])];
        if (list.length > MAX_ALWAYS_ALLOWED) throw new Error(`At most ${MAX_ALWAYS_ALLOWED} actions can be always allowed.`);
        await this.saveConfig((c) => {
            c.alwaysAllowed = list;
        });
        this.ctx.setState({ alwaysAllowed: list });
    }

    async revoke(key: string | "*"): Promise<void> {
        const list = key === "*" ? [] : this.ctx.state.alwaysAllowed.filter((k) => k !== key);
        await this.saveConfig((c) => {
            c.alwaysAllowed = list;
        });
        this.ctx.setState({ alwaysAllowed: list });
    }

    private async recordSpeed(model: string, tps: number): Promise<void> {
        if (!Number.isFinite(tps) || tps <= 0) return;
        const prev = this.ctx.state.speeds[model];
        const samples = Math.min(20, (prev?.samples ?? 0) + 1);
        // running mean over the last ~20 replies
        const mean = prev ? prev.tokensPerSecond + (tps - prev.tokensPerSecond) / samples : tps;
        const entries = Object.entries({ ...this.ctx.state.speeds, [model]: { tokensPerSecond: Math.round(mean * 10) / 10, samples } });
        const speeds = Object.fromEntries(entries.slice(-MAX_SPEEDS));
        this.ctx.setState({ speeds });
        await this.saveConfig((c) => {
            c.speeds = speeds;
        }).catch((err) => console.warn("[ai] could not save measured speed:", String(err)));
    }

    // ─── conversations ─────────────────────────────────────────────────────

    /** Ollama refs are canonicalized ("qwen3" → "qwen3:latest"); url providers list exact ids. */
    private normalizeModelRef(model: string): string {
        const provider = providerFor(this.models.providerOf(model));
        return provider.id === DEFAULT_PROVIDER_ID ? canonicalRef(model) : model.trim();
    }

    private async loadConversations(): Promise<void> {
        try {
            const { summaries, unreadable } = await this.store.load();
            this.ctx.setState({
                conversations: summaries,
                ...(unreadable.length
                    ? { storageError: `${unreadable.length} saved chat(s) could not be read and are hidden: ${unreadable.slice(0, 3).join(", ")}` }
                    : {}),
            });
        } catch (err) {
            console.error("[ai] conversations unreadable:", String(err));
            this.ctx.setState({ storageError: `Chat history could not be read: ${String(err)}` });
        }
    }

    async newConversation(model?: string): Promise<Conversation> {
        const chosen = model?.trim() ? this.normalizeModelRef(model) : this.ctx.state.settings.defaultModel;
        return this.chat.create(chosen);
    }

    getConversation(id: string): Promise<Conversation> {
        if (!isConversationId(id)) throw new Error("Unknown chat.");
        return this.store.get(id);
    }

    async renameConversation(id: string, title: string): Promise<void> {
        const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
        if (!clean) throw new Error("A chat needs a name.");
        const c = await this.getConversation(id);
        c.title = clean;
        this.ctx.setState({ conversations: await this.store.save(c) });
    }

    async setConversationModel(id: string, model: string): Promise<void> {
        if (this.ctx.state.generating.includes(id)) throw new Error("Wait for the reply to finish before switching models.");
        const c = await this.getConversation(id);
        c.model = this.normalizeModelRef(model);
        this.ctx.setState({ conversations: await this.store.save(c) });
    }

    rewindConversation(id: string, messageId: string): Promise<Conversation> {
        if (!isConversationId(id)) throw new Error("Unknown chat.");
        return this.chat.rewind(id, messageId);
    }

    async deleteConversation(id: string): Promise<void> {
        if (!isConversationId(id)) throw new Error("Unknown chat.");
        // a stopped reply saves once more; delete after it, not before
        await this.chat.stopAndSettle(id);
        this.ctx.setState({ conversations: await this.store.delete(id) });
    }

    async deleteAllConversations(): Promise<void> {
        // stop every reply and let its final save land before clearing, so a
        // save cannot resurrect a chat after the wipe
        await this.chat.stopAll();
        const conversations = await this.store.deleteAll();
        this.ctx.setState(() => ({
            conversations,
            // the files an unreadable warning described are gone; a config
            // read error is a different failure and stays
            ...(this.configLoaded ? { storageError: undefined } : {}),
        }));
    }

    resolveApproval(id: string, decision: ApprovalDecision): void {
        this.chat.resolveApproval(id, decision);
    }

    // ─── runtime ───────────────────────────────────────────────────────────

    private async layout(): Promise<RuntimeLayout> {
        const windows = process.platform === "win32";
        const home = await packageApi.getPath(OLLAMA_PACKAGE);
        return {
            command: path.join(home, "bin", windows ? "ollama.exe" : "ollama"),
            filesDir: this.filesDir,
            modelsDir: path.join(this.filesDir, "models"),
            homeDir: path.join(this.filesDir, "home"),
            windows,
        };
    }

    private async startIfInstalled(): Promise<void> {
        let installed: boolean;
        try {
            installed = await packageApi.isInstalled(OLLAMA_PACKAGE);
        } catch (err) {
            this.patchRuntime({ status: "error", error: `Could not check for Ollama: ${String(err)}` });
            return;
        }
        if (!installed) {
            this.patchRuntime({ status: "missing", packageInstalled: false });
            return;
        }
        this.patchRuntime({ packageInstalled: true });
        await this.startRuntime().catch((err) => console.error("[ai] Ollama did not start:", String(err)));
    }

    async startRuntime(): Promise<void> {
        await this.runtime.start(await this.layout());
    }

    async stopRuntime(): Promise<void> {
        await this.chat.stopAll();
        this.models.cancelAll();
        await this.runtime.stop();
    }

    async installRuntime(): Promise<void> {
        const status = this.ctx.state.runtime.status;
        if (status === "installing") throw new Error("Ollama is already being installed.");
        this.patchRuntime({ status: "installing", error: undefined, errorDetail: undefined, install: { stage: "checking", percent: 0 } });
        try {
            // replacing a runtime requires its workload to be stopped first
            await this.runtime.stop();
            await packageApi.download(OLLAMA_PACKAGE, (p) => {
                this.patchRuntime({ install: { stage: p.stage, percent: Math.round(p.percent) } });
            });
            this.patchRuntime({ install: undefined, packageInstalled: true });
        } catch (err) {
            this.patchRuntime({ status: "error", error: `Installing Ollama failed: ${err instanceof Error ? err.message : String(err)}`, install: undefined });
            throw err;
        }
        await this.startRuntime();
    }

    // ─── hardware & fit ────────────────────────────────────────────────────

    async refreshHardware(): Promise<void> {
        const ramBytes = os.totalmem();
        try {
            const report = await systemApi.getGpus();
            this.ctx.setState({
                hardware: {
                    gpus: report.gpus.map((g) => ({
                        name: g.name,
                        vendor: g.vendor,
                        memoryTotalBytes: g.memoryTotalBytes,
                        unifiedMemory: g.unifiedMemory,
                    })),
                    ramBytes,
                    errors: report.errors,
                    loaded: true,
                },
            });
        } catch (err) {
            this.ctx.setState({
                hardware: { gpus: [], ramBytes, errors: [`GPU inventory unavailable: ${String(err)}`], loaded: true },
            });
        }
    }

    // ─── public actions ────────────────────────────────────────────────────

    async ask(prompt: string, model?: string, system?: string, personality?: PromptStyle): Promise<string> {
        const chosen = model?.trim() ? this.normalizeModelRef(model) : this.ctx.state.settings.defaultModel;
        if (!prompt?.trim()) throw new Error("Ask AI needs a prompt.");
        if (!chosen) throw new Error("No model given and no default model is set in the AI panel.");
        if (!this.models.capabilities(chosen)) throw new Error(`${chosen} is not installed in the AI panel.`);
        return askOnce(
            this.chatClientFor(this.models.providerOf(chosen)),
            {
                model: chosen,
                prompt,
                system: askSystemPrompt(personality ?? "standard", chosen, system),
                contextLength: this.ctx.state.settings.contextLength,
            },
            ASK_DEADLINE_MS,
        );
    }

    private chatClientFor(providerId: string) {
        const client = this.buildProviderClients().get(providerId);
        if (!client) throw new Error(`${providerFor(providerId).label} is not running. Start it from the AI panel first.`);
        return client;
    }

    private async panelNames(): Promise<Record<string, string>> {
        try {
            const list = await panelsApi.list();
            return Object.fromEntries(list.map((p) => [p.id, p.name]));
        } catch (err) {
            // names only decorate tool descriptions; ids still identify
            console.debug("[ai] panel names unavailable:", String(err));
            return {};
        }
    }

    async shutdown(): Promise<void> {
        await this.chat?.stopAll();
        this.models.cancelAll();
    }
}
