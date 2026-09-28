// Installed models and downloads, across every reachable provider. The
// manager is transport-agnostic: it lists whatever the provider clients
// report, tags each model with its provider, and routes a pull to the
// provider that owns it (only providers with a pull surface can download).

import { isValidModelRef } from "../core/catalog";
import { DEFAULT_PROVIDER_ID, providerFor } from "../core/providers";
import { architectureFromModelInfo, type ModelArchitecture } from "../core/fit";
import type { InstalledModel, PullProgress } from "../core/types";
import type { ProviderClients } from "./provider";

export const MAX_CONCURRENT_PULLS = 2;
const PROGRESS_INTERVAL_MS = 250;

export interface ModelDeps {
    /** clients for the providers that are reachable right now */
    clients: () => ProviderClients;
    onModels: (models: InstalledModel[]) => void;
    onPulls: (pulls: PullProgress[]) => void;
    onDownloaded: (model: string) => void;
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

    constructor(private readonly deps: ModelDeps) {}

    get list(): InstalledModel[] {
        return this.models;
    }

    /** The provider that serves a model name, as last listed. */
    providerOf(model: string): string {
        const found = this.models.find((m) => m.name === model || m.name === canonicalRef(model));
        return found?.provider ?? DEFAULT_PROVIDER_ID;
    }

    capabilities(model: string): string[] | undefined {
        return this.models.find((m) => m.name === canonicalRef(model) || m.name === model)?.capabilities;
    }

    architecture(model: string): ModelArchitecture | null {
        return this.models.find((m) => m.name === canonicalRef(model) || m.name === model)?.architecture ?? null;
    }

    /** Re-reads every reachable provider's list; one refresh in flight at a time. */
    refresh(): Promise<InstalledModel[]> {
        if (!this.refreshing) {
            this.refreshing = this.load().finally(() => {
                this.refreshing = null;
            });
        }
        return this.refreshing;
    }

    private async load(): Promise<InstalledModel[]> {
        const next: InstalledModel[] = [];
        for (const [providerId, client] of this.deps.clients()) {
            const tags = (await client.tags()).filter((t) => !t.remote_host);
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
        this.deps.onModels(next);
        return next;
    }

    private publishPulls(): void {
        this.deps.onPulls([...this.pulls.values()].map((p) => p.progress));
    }

    /**
     * Starts a download and resolves when it finishes. Refuses a second pull
     * of the same model and more than MAX_CONCURRENT_PULLS at once.
     */
    async pull(ref: string, providerId: string = DEFAULT_PROVIDER_ID): Promise<void> {
        const provider = providerFor(providerId);
        const client = this.deps.clients().get(provider.id);
        if (!client) throw new Error(`${provider.label} is not running.`);
        if (!provider.canPull || !client.pull) {
            throw new Error(`${provider.label} lists models rather than downloading them.`);
        }
        const model = provider.id === "ollama" ? canonicalRef(ref) : ref.trim();
        if (!model) throw new Error("A model name is required.");
        if (provider.id === "ollama" && !isValidModelRef(model)) {
            throw new Error(`"${ref}" is not a model name from the Ollama library.`);
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
            this.deps.onDownloaded(model);
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

    async delete(ref: string, providerId: string = DEFAULT_PROVIDER_ID): Promise<void> {
        const model = canonicalRef(ref);
        if (!this.models.some((m) => m.name === model || m.name === ref.trim())) throw new Error(`${model} is not installed.`);
        const provider = providerFor(providerId);
        const client = this.deps.clients().get(provider.id);
        if (!client?.delete) throw new Error(`${provider.label} cannot delete models.`);
        await client.delete(model);
        await this.refresh();
    }
}
