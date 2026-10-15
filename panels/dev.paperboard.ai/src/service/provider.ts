// Provider transport contracts. Every provider the panel can talk to is
// normalized to these shapes: listing/showing/pulling models and streaming a
// chat turn. OllamaClient implements them natively; OpenAICompatibleClient
// implements them over the /v1 surface every local provider (llama.cpp, LM
// Studio, Apple Foundation Models servers, ...) exposes.

import { definitionOf, type Connection } from "../core/providers";
import type { ChatChunk, ChatRequest, PullEvent, ShowResponse, TagEntry } from "./ollamaClient";
import { OpenAICompatibleClient } from "./openaiClient";

export interface ChatClient {
    chat(request: ChatRequest, signal: AbortSignal, onChunk: (chunk: ChatChunk) => void): Promise<void>;
}

/** A listed model; an agent's also carries the name and description it gives it. */
export type ListedModel = TagEntry & { label?: string; description?: string; efforts?: string[]; defaultEffort?: string };

export interface ModelClient extends ChatClient {
    tags(): Promise<ListedModel[]>;
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
    /** resolves a provider's vault-stored API key, if it has one */
    apiKeyFor?: (providerId: string) => Promise<string | undefined>;
}

/**
 * Builds a client per reachable connection. An endpoint gets the
 * OpenAI-compatible client; Ollama uses the native client so it keeps its
 * richer pull/show/thinking surface, and is absent until its runtime is
 * ready.
 */
export function providerClients(deps: ProviderClientDeps, connections: readonly Connection[]): ProviderClients {
    const clients: ProviderClients = new Map();
    for (const connection of connections) {
        if (connection.kind === "ollama") {
            if (deps.ollama) clients.set(connection.id, deps.ollama);
            continue;
        }
        if (!connection.baseUrl) continue;
        const apiKeyFor = deps.apiKeyFor;
        clients.set(
            connection.id,
            new OpenAICompatibleClient(definitionOf(connection), apiKeyFor ? () => apiKeyFor(connection.id) : undefined),
        );
    }
    return clients;
}
