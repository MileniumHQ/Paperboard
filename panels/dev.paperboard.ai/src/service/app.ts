// The AI service: owns the Ollama runtime, models, conversations and the
// approval gate, and mirrors them into panel state for the UI.

import { createHash, randomBytes } from "node:crypto";
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
import { askSystemPrompt, isConversationId, isPromptStyle, MAX_CUSTOM_PROMPT_CHARS, MAX_USER_MESSAGE_CHARS } from "../core/conversation";
import {
    apiKeySecretName,
    connectionLabel,
    credentialsAllowed,
    definitionOf,
    endpointLabel,
    MAX_CONNECTION_LABEL_CHARS,
    MAX_CONNECTIONS,
    normalizeBaseUrl,
    OLLAMA_PROVIDER,
    OLLAMA_PROVIDER_ID,
    type Connection,
    type ProviderKind,
} from "../core/providers";
import { isReasoningLevel } from "../core/reasoning";
import { quickAskModel } from "../core/widgets";
import type { RegistryAction } from "../core/tools";
import {
    DEFAULT_SETTINGS,
    type AiState,
    type Conversation,
    type ConversationSnapshot,
    type LoadedModelsReport,
    type ModelSpeed,
    type PromptStyle,
    type RuntimeState,
    type Settings,
} from "../core/types";
import { republishPublicActions } from "./actions";
import { runShell } from "./builtins";
import { askOnce, ChatEngine, type ApprovalDecision } from "./chat";
import { listLoaded, unloadAndConfirm } from "./loaded";
import { canonicalRef, ModelManager } from "./models";
import { OpenAICompatibleClient } from "./openaiClient";
import { providerClients } from "./provider";
import { OllamaRuntime, type ProcessHost, type RuntimeLayout } from "./runtime";
import { ConversationStore } from "./store";

export type Ctx = ServiceContext<AiState>;

/** A connection as saved; whether it has an API key is the vault's fact. */
interface StoredConnection {
    id: string;
    kind: ProviderKind;
    label: string;
    baseUrl?: string;
}

interface StoredConfig {
    /** CONFIG_VERSION once migrated; absent on 0.2 configs */
    version?: number;
    settings?: Partial<Settings>;
    alwaysAllowed?: string[];
    speeds?: Record<string, ModelSpeed>;
    /** the providers the user added; API keys live in the vault */
    connections?: StoredConnection[];
    // TODO(remove after v0.3): the single provider choice of 0.2 configs,
    // read once by migrateSingleProvider and then deleted from the document
    provider?: { id?: string; baseUrl?: string };
}

const CONFIG_VERSION = 2;
// TODO(remove after v0.3): the 0.2 custom endpoint's vault secret, moved to
// the migrated connection's own secret by migrateSingleProvider
const LEGACY_API_KEY_SECRET = "openai-api-key";

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
    if (typeof s.customSystemPrompt === "string" && s.customSystemPrompt.length > MAX_CUSTOM_PROMPT_CHARS)
        throw new Error(`System prompt must be at most ${MAX_CUSTOM_PROMPT_CHARS} characters.`);
    return {
        defaultModel: typeof s.defaultModel === "string" ? s.defaultModel.slice(0, 200) : "",
        defaultProvider: typeof s.defaultProvider === "string" ? s.defaultProvider.slice(0, 64) : "",
        contextLength: Number.isInteger(s.contextLength) ? Math.min(131_072, Math.max(2048, s.contextLength)) : DEFAULT_SETTINGS.contextLength,
        reasoning: isReasoningLevel(s.reasoning) ? s.reasoning : DEFAULT_SETTINGS.reasoning,
        panelActions: typeof s.panelActions === "boolean" ? s.panelActions : DEFAULT_SETTINGS.panelActions,
        shellCommands: typeof s.shellCommands === "boolean" ? s.shellCommands : DEFAULT_SETTINGS.shellCommands,
        forceCpu: typeof s.forceCpu === "boolean" ? s.forceCpu : DEFAULT_SETTINGS.forceCpu,
        promptStyle: isPromptStyle(s.promptStyle) ? s.promptStyle : DEFAULT_SETTINGS.promptStyle,
        customPromptEnabled: typeof s.customPromptEnabled === "boolean" ? s.customPromptEnabled : false,
        customSystemPrompt: typeof s.customSystemPrompt === "string" ? s.customSystemPrompt : null,
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
            onModels: (models, modelErrors) => {
                this.ctx.setState({ models, modelErrors });
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

    // ─── connections ───────────────────────────────────────────────────────

    private get connections(): Connection[] {
        return this.ctx?.state.connections ?? [];
    }

    private connection(id: string): Connection {
        const found = this.connections.find((c) => c.id === id);
        if (!found) throw new Error("That provider was removed.");
        return found;
    }

    private hasOllama(): boolean {
        return this.connections.some((c) => c.kind === "ollama");
    }

    private async apiKeyFor(connectionId: string): Promise<string | undefined> {
        const connection = this.connections.find((c) => c.id === connectionId);
        if (!connection?.hasApiKey) return undefined;
        const { found, value } = await secretsApi.get(apiKeySecretName(connectionId), PANEL_ID);
        return found && value ? value : undefined;
    }

    private buildProviderClients() {
        return providerClients({ ollama: this.runtime.api, apiKeyFor: (id) => this.apiKeyFor(id) }, this.connections);
    }

    /** Saved connections plus which have a key in the vault. */
    private async connectionsFromStored(stored: readonly StoredConnection[]): Promise<Connection[]> {
        const keys = stored.some((c) => c.kind === "openai-compatible") ? new Set(await secretsApi.list(PANEL_ID)) : new Set<string>();
        return stored.map((c) =>
            c.kind === "openai-compatible"
                ? { id: c.id, kind: c.kind, label: c.label, baseUrl: c.baseUrl ?? "", hasApiKey: keys.has(apiKeySecretName(c.id)) }
                : { id: c.id, kind: c.kind, label: c.label },
        );
    }

    private publishConnections(stored: readonly StoredConnection[], keyed: ReadonlySet<string>): Connection[] {
        const connections: Connection[] = stored.map((c) =>
            c.kind === "openai-compatible" ? { ...c, baseUrl: c.baseUrl ?? "", hasApiKey: keyed.has(c.id) } : { ...c },
        );
        this.ctx.setState({ connections });
        return connections;
    }

    private keyedIds(): Set<string> {
        return new Set(this.connections.filter((c) => c.hasApiKey).map((c) => c.id));
    }

    private static cleanLabel(raw: unknown, fallback: string): string {
        const label = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_CONNECTION_LABEL_CHARS) : "";
        return label || fallback;
    }

    /** Adds Ollama, or an OpenAI-compatible endpoint whose API key goes to the vault. */
    async addConnection(input: { kind?: unknown; label?: unknown; baseUrl?: unknown; apiKey?: unknown }): Promise<Connection> {
        const stored = this.stored.connections ?? [];
        if (stored.length >= MAX_CONNECTIONS) throw new Error(`At most ${MAX_CONNECTIONS} providers can be added.`);
        if (input.kind === "ollama") {
            if (stored.some((c) => c.kind === "ollama")) throw new Error("Ollama is already added.");
            const added: StoredConnection = { id: OLLAMA_PROVIDER_ID, kind: "ollama", label: OLLAMA_PROVIDER.label };
            await this.saveConfig((c) => {
                c.connections = [...(c.connections ?? []), added];
            });
            this.publishConnections(this.stored.connections ?? [], this.keyedIds());
            // setup may have started Ollama already; never bounce a ready
            // runtime, and never await its boot: readiness and failure travel
            // through state.runtime
            if (this.ctx.state.runtime.status !== "ready") {
                void this.startIfInstalled().catch((err) => console.error("[ai] Ollama did not start:", String(err)));
            }
            return this.connection(added.id);
        }
        if (input.kind !== "openai-compatible") throw new Error("Unknown provider kind.");
        if (typeof input.baseUrl !== "string" || !input.baseUrl.trim()) throw new Error("An endpoint URL is required.");
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        const key = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : undefined;
        if (key && !credentialsAllowed(baseUrl)) {
            throw new Error("Refusing to store an API key for a plaintext http endpoint. Use https, or a loopback address.");
        }
        let id: string;
        do id = `api-${randomBytes(4).toString("hex")}`;
        while (stored.some((c) => c.id === id));
        const added: StoredConnection = { id, kind: "openai-compatible", label: AiApp.cleanLabel(input.label, endpointLabel(baseUrl)), baseUrl };
        if (key) await secretsApi.set(apiKeySecretName(id), key, PANEL_ID);
        try {
            await this.saveConfig((c) => {
                c.connections = [...(c.connections ?? []), added];
            });
        } catch (err) {
            // the key belongs to a connection that was never saved
            if (key) {
                await secretsApi.delete(apiKeySecretName(id), PANEL_ID).catch((cleanup) => {
                    throw new Error(`${err instanceof Error ? err.message : String(err)} Its API key could not be removed from the vault: ${String(cleanup)}`);
                });
            }
            throw err;
        }
        const keyed = this.keyedIds();
        if (key) keyed.add(id);
        this.publishConnections(this.stored.connections ?? [], keyed);
        await this.models.refresh();
        return this.connection(id);
    }

    /**
     * Renames an endpoint, points it elsewhere, or replaces its key. A key
     * belongs to the URL it was entered for: a new URL without a new key
     * drops the old one rather than carrying it to another host.
     */
    async updateConnection(input: { id?: unknown; label?: unknown; baseUrl?: unknown; apiKey?: unknown; clearApiKey?: unknown }): Promise<Connection> {
        if (typeof input.id !== "string") throw new Error("Unknown provider.");
        const current = (this.stored.connections ?? []).find((c) => c.id === input.id);
        if (!current) throw new Error("That provider was removed.");
        if (current.kind !== "openai-compatible") throw new Error(`${current.label} has nothing to change.`);
        const baseUrl = typeof input.baseUrl === "string" && input.baseUrl.trim() ? normalizeBaseUrl(input.baseUrl) : current.baseUrl ?? "";
        const key = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : undefined;
        if (key && !credentialsAllowed(baseUrl)) {
            throw new Error("Refusing to store an API key for a plaintext http endpoint. Use https, or a loopback address.");
        }
        const secret = apiKeySecretName(current.id);
        const keyed = this.keyedIds();
        if (key) {
            await secretsApi.set(secret, key, PANEL_ID);
            keyed.add(current.id);
        } else if (input.clearApiKey === true || baseUrl !== current.baseUrl) {
            await secretsApi.delete(secret, PANEL_ID);
            keyed.delete(current.id);
        }
        const label = AiApp.cleanLabel(input.label, current.label);
        await this.saveConfig((c) => {
            c.connections = (c.connections ?? []).map((x) => (x.id === current.id ? { ...x, label, baseUrl } : x));
        });
        this.publishConnections(this.stored.connections ?? [], keyed);
        await this.models.refresh();
        return this.connection(current.id);
    }

    /**
     * Removes a provider. Its models leave the lists; Ollama's downloads stay
     * on disk (user data) and come back when Ollama is added again.
     */
    async removeConnection(id: string): Promise<void> {
        const current = (this.stored.connections ?? []).find((c) => c.id === id);
        if (!current) throw new Error("That provider was removed.");
        const replying = this.ctx.state.conversations.find(
            (c) => this.ctx.state.generating.includes(c.id) && (c.provider ?? this.models.providerOf(c.model)) === id,
        );
        if (replying) throw new Error(`"${replying.title}" is replying with ${current.label}. Stop it first.`);
        await this.saveConfig((c) => {
            c.connections = (c.connections ?? []).filter((x) => x.id !== id);
            if (c.settings?.defaultProvider === id) c.settings = { ...c.settings, defaultModel: "", defaultProvider: "" };
        });
        this.ctx.setState({ settings: clampSettings(this.stored.settings) });
        const keyed = this.keyedIds();
        keyed.delete(id);
        this.publishConnections(this.stored.connections ?? [], keyed);
        if (current.kind === "ollama") {
            this.models.cancelAll();
            await this.runtime.stop();
        } else {
            await secretsApi.delete(apiKeySecretName(id), PANEL_ID).catch((err) => {
                throw new Error(`${current.label} was removed, but its API key could not be deleted from the vault: ${String(err)}`);
            });
        }
        await this.models.refresh();
    }

    /** Probes an endpoint's /v1/models without saving anything. */
    async testConnection(input: { id?: unknown; baseUrl?: unknown; apiKey?: unknown }): Promise<{ models: number }> {
        if (typeof input.baseUrl !== "string" || !input.baseUrl.trim()) throw new Error("An endpoint URL is required.");
        const baseUrl = normalizeBaseUrl(input.baseUrl);
        const typed = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : undefined;
        // an edit may test with the stored key, but only against the URL it was saved for
        const saved = typeof input.id === "string" ? this.connections.find((c) => c.id === input.id) : undefined;
        const key = typed ?? (saved && saved.baseUrl === baseUrl ? await this.apiKeyFor(saved.id) : undefined);
        if (key && !credentialsAllowed(baseUrl)) {
            throw new Error("Refusing to send an API key over plaintext http. Use https, or a loopback address.");
        }
        const probe: Connection = { id: "api-00000000", kind: "openai-compatible", label: endpointLabel(baseUrl), baseUrl };
        const client = new OpenAICompatibleClient(definitionOf(probe), async () => key);
        const tags = await client.tags();
        return { models: tags.length };
    }

    // TODO(remove after v0.3): 0.2 saved one provider choice, with the custom
    // endpoint's key under one vault name. This turns it into connections
    // once; the endpoint's id comes from its URL, so a retry after a failed
    // write lands on the same secret instead of leaving another behind.
    private async migrateSingleProvider(saved: StoredConfig): Promise<StoredConfig> {
        const { provider: legacy, ...rest } = saved;
        const connections: StoredConnection[] = [];
        let movedKey = false;
        if (legacy?.id === "custom" && typeof legacy.baseUrl === "string" && legacy.baseUrl) {
            const id = `api-${createHash("sha256").update(legacy.baseUrl).digest("hex").slice(0, 8)}`;
            connections.push({ id, kind: "openai-compatible", label: endpointLabel(legacy.baseUrl), baseUrl: legacy.baseUrl });
            const { found, value } = await secretsApi.get(LEGACY_API_KEY_SECRET, PANEL_ID);
            if (found && value) {
                await secretsApi.set(apiKeySecretName(id), value, PANEL_ID);
                movedKey = true;
            }
        } else if (legacy?.id) {
            connections.push({ id: OLLAMA_PROVIDER_ID, kind: "ollama", label: OLLAMA_PROVIDER.label });
        }
        const next: StoredConfig = { ...rest, version: CONFIG_VERSION, connections };
        await config.set(next, PANEL_ID);
        if (movedKey) await secretsApi.delete(LEGACY_API_KEY_SECRET, PANEL_ID);
        return next;
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
            capabilities: (model, provider) => this.models.capabilities(model, provider),
            listActions: () => actionsApi.list() as Promise<RegistryAction[]>,
            panelNames: () => this.panelNames(),
            callAction: (panelId, action, args) => actionsApi.call(panelId, action, args),
            isAllowed: (key) => this.ctx.state.alwaysAllowed.includes(key),
            rememberAllowed: (key) => this.allowAlways(key),
            runShell: (command, signal) => runShell(command, signal),
            onDelta: (payload) => this.ctx.emit(EVENTS.chatDelta, payload),
            onMessage: (payload) => this.ctx.emit(EVENTS.chatMessage, payload),
            onReset: (payload) => this.ctx.emit(EVENTS.chatReset, payload),
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
        // endpoints need no runtime; their models list right away, and
        // Ollama's join once its runtime reports ready
        void this.models.refresh().catch((err) => console.error("[ai] listing models failed:", String(err)));
        if (this.hasOllama()) {
            void this.startIfInstalled().catch((err) => console.error("[ai] Ollama startup task failed:", String(err)));
        } else {
            // not added, so not started; setup still needs to know whether
            // adding it means installing or only starting
            void this.checkInstalled().catch((err) => console.error("[ai] Ollama package check failed:", String(err)));
        }
    }

    // ─── settings & permissions (the panel's config document) ────────────

    private async loadConfig(): Promise<void> {
        try {
            const read = (await config.get<StoredConfig | null>(PANEL_ID)) ?? {};
            let saved: StoredConfig = typeof read === "object" ? read : {};
            if (saved.version !== CONFIG_VERSION) saved = await this.migrateSingleProvider(saved);
            this.stored = saved;
            const connections = await this.connectionsFromStored(Array.isArray(saved.connections) ? saved.connections : []);
            this.configLoaded = true;
            this.ctx.setState({
                settings: clampSettings(this.stored.settings),
                connections,
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

    private saveConfig(mutate: (c: StoredConfig) => void | Promise<void>): Promise<void> {
        const next = this.configQueue.then(async () => {
            if (!this.configLoaded) throw new Error("Settings could not be read, so changes are not saved. Restart the panel to retry.");
            const draft: StoredConfig = JSON.parse(JSON.stringify(this.stored));
            await mutate(draft);
            await config.set(draft, PANEL_ID);
            this.stored = draft;
        });
        this.configQueue = next.catch((err) => console.debug("[ai] config write failed:", String(err)));
        return next;
    }

    async updateSettings(patch: Partial<Settings>): Promise<Settings> {
        let settings!: Settings;
        await this.saveConfig(async (c) => {
            settings = clampSettings({ ...c.settings, ...patch });
            // An explicit enable with an empty editor refills it: an empty box
            // means "no prompt", not a deliberate blank one, so disable/enable
            // gives the user a generated starting point again. The patch's
            // flag (not the merged setting) distinguishes enabling from a
            // while-enabled edit that cleared the field to "".
            if (patch.customPromptEnabled === true && !settings.customSystemPrompt) {
                // customPromptEnabled must be off for promptForModel, or the
                // empty string is treated as a deliberate custom prompt and
                // the generator returns it verbatim (also empty).
                const generated = await this.chat.promptForModel(settings.defaultModel, { ...settings, customPromptEnabled: false });
                settings.customSystemPrompt = generated.prompt;
            }
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

    /** Ollama refs are canonicalized ("qwen3" → "qwen3:latest"); endpoints list exact ids. */
    private normalizeModelRef(model: string, provider?: string): string {
        const found = this.models.find(model, provider);
        if (found) return found.name;
        return (provider ?? this.models.providerOf(model)) === OLLAMA_PROVIDER_ID ? canonicalRef(model) : model.trim();
    }

    /** A connection id the UI sent, checked against the ones added. */
    private knownProvider(provider: string | undefined): string | undefined {
        if (provider === undefined || provider === "") return undefined;
        this.connection(provider);
        return provider;
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

    async newConversation(model?: string, provider?: string): Promise<Conversation> {
        const settings = this.ctx.state.settings;
        if (!model?.trim()) return this.chat.create(settings.defaultModel, settings.defaultProvider || undefined);
        const via = this.knownProvider(provider);
        return this.chat.create(this.normalizeModelRef(model, via), via);
    }

    /** What a window shows when it opens a chat, replies in flight included. */
    getConversation(id: string): Promise<ConversationSnapshot> {
        if (!isConversationId(id)) throw new Error("Unknown chat.");
        return this.chat.get(id);
    }

    async renameConversation(id: string, title: string): Promise<void> {
        if (!isConversationId(id)) throw new Error("Unknown chat.");
        const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
        if (!clean) throw new Error("A chat needs a name.");
        await this.chat.rename(id, clean);
    }

    async setConversationModel(id: string, model: string, provider?: string): Promise<void> {
        if (!isConversationId(id)) throw new Error("Unknown chat.");
        if (this.ctx.state.generating.includes(id)) throw new Error("Wait for the reply to finish before switching models.");
        const via = this.knownProvider(provider);
        const c = await this.store.get(id);
        c.model = this.normalizeModelRef(model, via);
        if (via) c.provider = via;
        else delete c.provider;
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

    /**
     * Starts a chat with `text` (the Quick ask widget), on the model its
     * "Model" option names or else the default, and asks a panel
     * window to open it. Resolves once the message is accepted and the reply
     * has started; a chat whose message was refused is removed again.
     */
    async quickAsk(text: string, chosenModel?: string): Promise<{ conversationId: string }> {
        const content = text.trim();
        if (!content) throw new Error("Type a question first.");
        if (content.length > MAX_USER_MESSAGE_CHARS) throw new Error(`Questions are limited to ${MAX_USER_MESSAGE_CHARS} characters.`);
        if (this.connections.length === 0) throw new Error("Set up AI first.");
        const model = quickAskModel(this.ctx.state, chosenModel);
        if (!model) throw new Error("No model is downloaded yet. Pick one in AI.");
        const settings = this.ctx.state.settings;
        const provider = !chosenModel && settings.defaultProvider ? settings.defaultProvider : this.models.providerOf(model);
        if (!provider || !this.models.capabilities(model, provider)) throw new Error(`${model} is not downloaded. Pick a model in AI.`);
        // throws when the provider is not reachable, before a chat exists
        this.chatClientFor(provider);
        const conversation = await this.chat.create(model, provider);
        try {
            await this.chat.send(conversation.id, content);
        } catch (err) {
            try {
                this.ctx.setState({ conversations: await this.store.delete(conversation.id) });
            } catch (cleanup) {
                throw new Error(`${err instanceof Error ? err.message : String(err)} The empty chat could not be removed: ${String(cleanup)}`);
            }
            throw err;
        }
        this.ctx.setState({ openRequest: conversation.id });
        return { conversationId: conversation.id };
    }

    /** Hands the pending open request to one panel window, once. */
    takeOpenRequest(): string | null {
        const id = this.ctx.state.openRequest;
        if (!id) return null;
        this.ctx.setState({ openRequest: null });
        return this.ctx.state.conversations.some((c) => c.id === id) ? id : null;
    }

    async loadedModels(): Promise<LoadedModelsReport> {
        if (!this.hasOllama()) return { status: "unsupported", provider: "Your providers" };
        const api = this.runtime.api;
        if (!api) return { status: "stopped", runtime: this.ctx.state.runtime.status };
        return { status: "ok", models: await listLoaded(api) };
    }

    /** Frees a loaded model's memory; resolves once Ollama no longer lists it. */
    async unloadModel(name: string): Promise<LoadedModelsReport> {
        if (!this.hasOllama()) throw new Error("Only Ollama's models can be unloaded from here.");
        const api = this.runtime.requireApi();
        const replying = this.ctx.state.conversations.find(
            (c) => c.model === name && (c.provider ?? OLLAMA_PROVIDER_ID) === OLLAMA_PROVIDER_ID && this.ctx.state.generating.includes(c.id),
        );
        if (replying) throw new Error(`"${replying.title}" is replying with ${name}. Stop it first.`);
        return { status: "ok", models: await unloadAndConfirm(api, name) };
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

    /** Reports whether Ollama is installed, without starting it. */
    private async checkInstalled(): Promise<void> {
        let installed: boolean;
        try {
            installed = await packageApi.isInstalled(OLLAMA_PACKAGE);
        } catch (err) {
            this.patchRuntime({ status: "error", error: `Could not check for Ollama: ${String(err)}` });
            return;
        }
        this.patchRuntime(installed ? { status: "stopped", packageInstalled: true } : { status: "missing", packageInstalled: false });
    }

    async startIfInstalled(): Promise<void> {
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
        // the download can outlive any caller's patience: acknowledge now,
        // and let progress/failure travel through state.runtime (the UI
        // renders `install` and `error`), never a request/response deadline
        void this.runInstall();
    }

    private async runInstall(): Promise<void> {
        try {
            // replacing a runtime requires its workload to be stopped first
            await this.runtime.stop();
            await packageApi.download(OLLAMA_PACKAGE, (p) => {
                this.patchRuntime({ install: { stage: p.stage, percent: Math.round(p.percent) } });
            });
            this.patchRuntime({ install: undefined, packageInstalled: true });
        } catch (err) {
            this.patchRuntime({ status: "error", error: `Installing Ollama failed: ${err instanceof Error ? err.message : String(err)}`, install: undefined });
            return;
        }
        // start reports its own progress and failure through state too
        void this.startRuntime().catch((err) => console.error("[ai] Ollama did not start:", String(err)));
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
        const provider = !model?.trim() && this.ctx.state.settings.defaultProvider ? this.ctx.state.settings.defaultProvider : this.models.providerOf(chosen);
        if (!provider || !this.models.capabilities(chosen, provider)) throw new Error(`${chosen} is not installed in the AI panel.`);
        return askOnce(
            this.chatClientFor(provider),
            {
                model: chosen,
                prompt,
                system: askSystemPrompt(personality ?? "standard", chosen, system),
                contextLength: this.ctx.state.settings.contextLength,
                forceCpu: this.ctx.state.settings.forceCpu,
            },
            ASK_DEADLINE_MS,
        );
    }

    private chatClientFor(providerId: string) {
        const client = this.buildProviderClients().get(providerId);
        if (!client) {
            throw new Error(
                providerId === OLLAMA_PROVIDER_ID || !this.connections.some((c) => c.id === providerId)
                    ? `${connectionLabel(this.connections, providerId)} is not available. Start or add it in the AI panel first.`
                    : `${connectionLabel(this.connections, providerId)} has no endpoint URL.`,
            );
        }
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
