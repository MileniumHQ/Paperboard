// Providers: how the panel reaches a model. The user adds connections: the
// local Ollama runtime the panel installs and starts, and any number of
// OpenAI-compatible endpoints it is simply pointed at. The transport
// differs, everything above it does not: models carry their connection id,
// so a chat, an install or a stop is routed and labelled truthfully.

export type ProviderKind = "ollama" | "openai-compatible";

export interface ProviderDefinition {
    id: string;
    label: string;
    kind: ProviderKind;
    /** a local binary that must be installed and started before use */
    runtime?: { packageId: string };
    /** an OpenAI-compatible endpoint base URL (no trailing slash) */
    baseUrl?: string;
    /** models can be pulled from the provider's library by name */
    canPull: boolean;
    /**
     * Capabilities to assume for models this provider lists when it cannot
     * report them itself (most OpenAI-compatible endpoints do not).
     */
    defaultCapabilities?: string[];
}

export const OLLAMA_PROVIDER_ID = "ollama";
/** at most this many providers can be added */
export const MAX_CONNECTIONS = 16;
export const MAX_CONNECTION_LABEL_CHARS = 60;

export const OLLAMA_PROVIDER: ProviderDefinition = {
    id: OLLAMA_PROVIDER_ID,
    label: "Ollama",
    kind: "ollama",
    runtime: { packageId: "ollama" },
    canPull: true,
};

/**
 * A provider the user added. Ollama is at most one connection with the
 * fixed id "ollama"; each OpenAI-compatible endpoint is its own connection
 * with a generated id, and its API key is a vault secret named for that id.
 */
export interface Connection {
    id: string;
    kind: ProviderKind;
    label: string;
    /** openai-compatible: the endpoint URL */
    baseUrl?: string;
    /** openai-compatible: an API key is stored in the vault */
    hasApiKey?: boolean;
}

const API_ID = /^api-[0-9a-f]{8}$/;

export function isApiConnectionId(id: string): boolean {
    return API_ID.test(id);
}

/** The vault secret holding an endpoint connection's API key. */
export function apiKeySecretName(connectionId: string): string {
    if (!isApiConnectionId(connectionId)) throw new Error(`"${connectionId}" is not an endpoint connection.`);
    return `api-key-${connectionId}`;
}

/** How the service reaches a connection. */
export function definitionOf(connection: Connection): ProviderDefinition {
    if (connection.kind === "ollama") return OLLAMA_PROVIDER;
    return {
        id: connection.id,
        label: connection.label,
        kind: "openai-compatible",
        baseUrl: connection.baseUrl ?? "",
        canPull: false,
        defaultCapabilities: ["completion", "tools"],
    };
}

/** A connection's display name, or the id when it was removed. */
export function connectionLabel(connections: readonly Connection[], id: string | undefined): string {
    return connections.find((c) => c.id === id)?.label ?? id ?? "Unknown provider";
}

/** A short default name for an endpoint: its host. */
/**
 * Why a chat's model can't be used: its provider was removed, the endpoint
 * no longer lists it, or (Ollama) it isn't downloaded.
 */
export function unlistedModelReason(connections: readonly Connection[], model: string, provider: string | undefined): string {
    const owner = provider === undefined ? undefined : connections.find((c) => c.id === provider);
    if (provider !== undefined && !owner) return `The provider ${model} ran on was removed. Pick a model from Models.`;
    if (owner && owner.kind !== "ollama") return `${owner.label} doesn't list ${model}. Pick a model from Models.`;
    return `${model} is not downloaded. Pick one from Models.`;
}

export function endpointLabel(baseUrl: string): string {
    try {
        return new URL(baseUrl).host || baseUrl;
    } catch (err) {
        console.debug("[ai] endpoint URL could not be parsed for a label:", String(err));
        return baseUrl;
    }
}

// A custom endpoint must be a real http(s) URL; a typo is refused here, at
// the boundary, never dialed.
export function normalizeBaseUrl(raw: string): string {
    const value = raw.trim().replace(/\/+$/, "");
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`"${raw.trim()}" is not a valid URL.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("The endpoint URL must start with http:// or https://");
    }
    return value;
}

/**
 * Whether an API key may travel to this endpoint. A credential is only sent
 * over TLS or to this machine: plaintext to any other host would put the key
 * on the wire. The endpoint itself stays usable without a key (local
 * servers usually ignore auth); it just never receives one.
 */
export function credentialsAllowed(baseUrl: string): boolean {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch (err) {
        console.debug("[ai] endpoint URL could not be parsed; no credential will be sent:", String(err));
        return false;
    }
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
