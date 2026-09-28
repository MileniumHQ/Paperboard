// Provider transport contracts. Every provider the panel can talk to is
// normalized to these shapes: listing/showing/pulling models and streaming a
// chat turn. OllamaClient implements them natively; OpenAICompatibleClient
// implements them over the /v1 surface every local provider (llama.cpp, LM
// Studio, Apple Foundation Models servers, ...) exposes.

import type { ProviderDefinition } from "../core/providers";
import type { ChatChunk, ChatRequest, PullEvent, ShowResponse, TagEntry } from "./ollamaClient";
import { OpenAICompatibleClient } from "./openaiClient";

export interface ChatClient {
    chat(request: ChatRequest, signal: AbortSignal, onChunk: (chunk: ChatChunk) => void): Promise<void>;
}

export interface ModelClient extends ChatClient {
    tags(): Promise<TagEntry[]>;
    show(model: string): Promise<ShowResponse>;
    /** absent when the provider has no pull surface (a fixed URL endpoint) */
    pull?(model: string, signal: AbortSignal, onEvent: (event: PullEvent) => void): Promise<void>;
    delete?(model: string): Promise<void>;
}

/** Clients for every reachable provider, keyed by provider id. */
export type ProviderClients = Map<string, ModelClient>;

export interface ProviderClientDeps {
    /** the native Ollama client, or null while its runtime is not ready */
    ollama: ModelClient | null;
}

/**
 * Builds a client per reachable provider. A provider with a baseUrl gets the
 * OpenAI-compatible client; the ollama provider uses the native client so it
 * keeps its richer pull/show/thinking surface, and is absent until its
 * runtime is ready.
 */
export function providerClients(deps: ProviderClientDeps, providers: readonly ProviderDefinition[]): ProviderClients {
    const clients: ProviderClients = new Map();
    for (const provider of providers) {
        if (provider.id === "ollama") {
            if (deps.ollama) clients.set(provider.id, deps.ollama);
            continue;
        }
        if (provider.baseUrl) clients.set(provider.id, new OpenAICompatibleClient(provider));
    }
    return clients;
}
