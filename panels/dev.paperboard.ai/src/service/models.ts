// Installed models and downloads, across every reachable provider. The
// manager is transport-agnostic: it lists whatever the provider clients
// report, tags each model with its provider, and routes a pull to the
// provider that owns it (only providers with a pull surface can download).

import { isValidModelRef } from "../core/catalog";
import { OLLAMA_PROVIDER, OLLAMA_PROVIDER_ID } from "../core/providers";
import { architectureFromModelInfo, type ModelArchitecture } from "../core/fit";
import type { InstalledModel, PullProgress } from "../core/types";
import type { ProviderClients } from "./provider";

export const MAX_CONCURRENT_PULLS = 2;
const PROGRESS_INTERVAL_MS = 250;

export interface ModelDeps {
    /** clients for the providers that are reachable right now */
    clients: () => ProviderClients;
    /** every listing, plus why a connection could not be listed (unavailable, not empty) */
    onModels: (models: InstalledModel[], errors: Record<string, string>) => void;
    onPulls: (pulls: PullProgress[]) => void;
}

/** Ollama names models "name:tag"; a bare name means ":latest". */
export function canonicalRef(ref: string): string {
    const r = ref.trim();
    return r.includes(":") ? r : `${r}:latest`;
}

export class ModelManager {
    private models: InstalledModel[] = [];
    private pulls = new Map<string, { progress: PullProgress; abort: AbortController }>();
    private refreshing: Promise<InstalledModel[]> | null = null;
    private queued: Promise<InstalledModel[]> | null = null;

    constructor(private readonly deps: ModelDeps) {}

    get list(): InstalledModel[] {
        return this.models;
    }

    /**
     * A listed model. Names can repeat across connections, so a chat names
     * its connection; without one, the first connection listing the name
     * serves it (flow blocks pick models by name).
     */
    find(model: string, provider?: string): InstalledModel | undefined {
        const matches = (m: InstalledModel) => m.name === model || m.name === canonicalRef(model);
        return this.models.find((m) => (provider === undefined || m.provider === provider) && matches(m));
    }

    /** The connection that serves a model name, or undefined when none lists it. */
    providerOf(model: string): string | undefined {
        return this.find(model)?.provider;
    }

    capabilities(model: string, provider?: string): string[] | undefined {
        return this.find(model, provider)?.capabilities;
    }

    architecture(model: string, provider?: string): ModelArchitecture | null {
        return this.find(model, provider)?.architecture ?? null;
    }

    /**
     * Re-reads every reachable provider's list; one refresh in flight at a
     * time. A refresh asked for meanwhile may follow a connection change the
     * running one never saw, so it runs once more after it (at most one waits).
     */
    refresh(): Promise<InstalledModel[]> {
        if (!this.refreshing) {
            this.refreshing = this.load().finally(() => {
                this.refreshing = null;
            });
            return this.refreshing;
        }
        this.queued ??= this.refreshing
            .then(
                () => undefined,
                (err) => console.debug("[ai] the earlier model refresh failed:", String(err)),
            )
            .then(() => {
                this.queued = null;
                return this.refresh();
            });
        return this.queued;
    }

    private async load(): Promise<InstalledModel[]> {
        const next: InstalledModel[] = [];
        const errors: Record<string, string> = {};
        for (const [providerId, client] of this.deps.clients()) {
            let tags;
            try {
                tags = (await client.tags()).filter((t) => !t.remote_host);
            } catch (err) {
                // one unreachable endpoint must not hide every other provider's models
                errors[providerId] = err instanceof Error ? err.message : String(err);
                continue;
            }
            for (const tag of tags) {
                // capabilities decide whether a model gets tools, so a model we
                // cannot inspect is listed without any rather than guessed
                let capabilities: string[] = [];
                let contextLength: number | undefined;
                let architecture: ModelArchitecture | null = null;
                try {
                    const show = await client.show(tag.name);
                    capabilities = Array.isArray(show.capabilities) ? show.capabilities.filter((c) => typeof c === "string") : [];
                    architecture = architectureFromModelInfo(show.model_info);
                    const arch = show.model_info?.["general.architecture"];
                    const ctx = typeof arch === "string" ? show.model_info?.[`${arch}.context_length`] : undefined;
                    if (typeof ctx === "number") contextLength = ctx;
                } catch (err) {
                    console.warn(`[ai] could not inspect ${tag.name}:`, String(err));
                }
                next.push({
                    name: tag.name,
                    provider: providerId,
                    sizeBytes: tag.size,
                    family: tag.details?.family,
                    parameterSize: tag.details?.parameter_size,
                    quantization: tag.details?.quantization_level,
                    capabilities,
                    contextLength,
                    modifiedAt: tag.modified_at,
                    ...(architecture ? { architecture } : {}),
                });
            }
        }
        next.sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider));
        this.models = next;
        this.deps.onModels(next, errors);
        return next;
    }

    private publishPulls(): void {
        this.deps.onPulls([...this.pulls.values()].map((p) => p.progress));
    }

    /**
     * Starts a download and resolves when it finishes. Refuses a second pull
     * of the same model and more than MAX_CONCURRENT_PULLS at once.
     */
    /** Downloads come from Ollama's library; endpoints list models rather than download them. */
    async pull(ref: string): Promise<void> {
        const provider = OLLAMA_PROVIDER;
        const client = this.deps.clients().get(provider.id);
        if (!client?.pull) throw new Error(`${provider.label} is not running.`);
        const model = canonicalRef(ref);
        if (!isValidModelRef(model)) {
            throw new Error(`"${ref}" is not a model name from the model library.`);
        }
        if (this.pulls.has(model)) throw new Error(`${model} is already downloading.`);
        if (this.pulls.size >= MAX_CONCURRENT_PULLS) throw new Error(`Only ${MAX_CONCURRENT_PULLS} downloads can run at once.`);
        const abort = new AbortController();
        const progress: PullProgress = { model, provider: provider.id, status: "Starting", completedBytes: 0, totalBytes: 0 };
        this.pulls.set(model, { progress, abort });
        this.publishPulls();

        // layers download one after another; progress is summed per digest
        const layers = new Map<string, { total: number; completed: number }>();
        let last = 0;
        try {
            await client.pull(model, abort.signal, (event) => {
                if (event.digest && event.total) {
                    layers.set(event.digest, { total: event.total, completed: event.completed ?? 0 });
                }
                progress.status = event.status;
                progress.totalBytes = [...layers.values()].reduce((n, l) => n + l.total, 0);
                progress.completedBytes = [...layers.values()].reduce((n, l) => n + Math.min(l.completed, l.total), 0);
                const now = Date.now();
                if (now - last >= PROGRESS_INTERVAL_MS) {
                    last = now;
                    this.publishPulls();
                }
            });
            if (progress.status !== "success") {
                throw new Error(`Download ended without success (last status: ${progress.status || "none"})`);
            }
            this.pulls.delete(model);
            this.publishPulls();
            await this.refresh();
        } catch (err) {
            const cancelled = abort.signal.aborted;
            this.pulls.delete(model);
            this.publishPulls();
            if (cancelled) throw new Error(`Download of ${model} was cancelled.`);
            throw err;
        }
    }

    cancel(ref: string): boolean {
        const model = canonicalRef(ref);
        const entry = this.pulls.get(model) ?? this.pulls.get(ref.trim());
        if (!entry) return false;
        entry.abort.abort();
        return true;
    }

    cancelAll(): void {
        for (const entry of this.pulls.values()) entry.abort.abort();
    }

    /** Only Ollama's models live on this computer to delete. */
    async delete(ref: string): Promise<void> {
        const model = canonicalRef(ref);
        if (!this.find(model, OLLAMA_PROVIDER_ID)) throw new Error(`${model} is not installed.`);
        const client = this.deps.clients().get(OLLAMA_PROVIDER_ID);
        if (!client?.delete) throw new Error(`${OLLAMA_PROVIDER.label} is not running.`);
        await client.delete(model);
        await this.refresh();
    }
}
