// The models Ollama holds in memory, and unloading one. An unload is reported
// done only once /api/ps no longer lists the model: Ollama accepting the
// request is not the memory being free.

import type { LoadedModel } from "../core/types";
import type { PsEntry } from "./ollamaClient";

export interface LoadedClient {
    ps(): Promise<PsEntry[]>;
    unload(model: string): Promise<void>;
}

// a reply streams in the model it already holds; more than this many loaded
// at once is beyond any machine the panel targets, and the widget shows one
export const MAX_LOADED_MODELS = 16;
const UNLOAD_POLL_MS = 250;
export const UNLOAD_CONFIRM_MS = 5_000;

const bytes = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export async function listLoaded(client: LoadedClient): Promise<LoadedModel[]> {
    const entries = await client.ps();
    return entries
        .filter((e) => typeof e?.name === "string" && e.name)
        .slice(0, MAX_LOADED_MODELS)
        .map((e) => ({
            name: e.name,
            sizeBytes: bytes(e.size),
            vramBytes: Math.min(bytes(e.size_vram), bytes(e.size)),
            ...(typeof e.expires_at === "string" ? { expiresAt: e.expires_at } : {}),
        }));
}

/**
 * Unloads a loaded model and waits until Ollama stops listing it. Refuses a
 * model that is not loaded, and fails if it is still in memory after
 * `confirmMs`.
 */
export async function unloadAndConfirm(client: LoadedClient, name: string, confirmMs = UNLOAD_CONFIRM_MS): Promise<LoadedModel[]> {
    const before = await listLoaded(client);
    if (!before.some((m) => m.name === name)) throw new Error(`${name} is not loaded.`);
    await client.unload(name);
    const deadline = Date.now() + confirmMs;
    for (;;) {
        const now = await listLoaded(client);
        if (!now.some((m) => m.name === name)) return now;
        if (Date.now() >= deadline) throw new Error(`Ollama accepted the unload, but ${name} is still in memory.`);
        await new Promise((r) => setTimeout(r, UNLOAD_POLL_MS));
    }
}
