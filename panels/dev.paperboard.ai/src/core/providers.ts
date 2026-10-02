// Providers: how the panel reaches a model. A provider is either a local
// binary the panel installs and starts (Ollama), or an OpenAI-compatible
// endpoint it is simply pointed at. The transport differs, everything above
// it does not: models always carry their provider id, so installs and stops
// can be labelled truthfully and more providers can be added by declaring one
// here plus an adapter (see service/provider.ts).

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
export const CUSTOM_PROVIDER_ID = "custom";

const OLLAMA_PROVIDER: ProviderDefinition = {
    id: OLLAMA_PROVIDER_ID,
    label: "Ollama",
    kind: "ollama",
    runtime: { packageId: "ollama" },
    canPull: true,
};

/**
 * The user-supplied OpenAI-compatible endpoint. Its baseUrl is empty until
 * configured; `activeProviders` substitutes the stored URL at runtime so the
 * static definition (label, kind, capabilities) resolves in both processes.
 */
export const CUSTOM_PROVIDER: ProviderDefinition = {
    id: CUSTOM_PROVIDER_ID,
    label: "OpenAI-compatible endpoint",
    kind: "openai-compatible",
    canPull: false,
    defaultCapabilities: ["completion", "tools"],
};

export const PROVIDERS: readonly ProviderDefinition[] = [
    OLLAMA_PROVIDER,
    CUSTOM_PROVIDER,
];

export const DEFAULT_PROVIDER_ID = OLLAMA_PROVIDER_ID;

export function providerById(id: string | undefined): ProviderDefinition | undefined {
    return PROVIDERS.find((p) => p.id === id);
}

/** The provider a model belongs to; unknown ids fall back to the default. */
export function providerFor(id: string | undefined): ProviderDefinition {
    return providerById(id) ?? providerById(DEFAULT_PROVIDER_ID)!;
}

export function providerLabel(id: string | undefined): string {
    return providerFor(id).label;
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

/**
 * The providers reachable right now. The custom endpoint only joins when it
 * has a configured URL, so an unconfigured panel never dials an empty base.
 */
export function activeProviders(customBaseUrl?: string | null): ProviderDefinition[] {
    const base = (customBaseUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) return [OLLAMA_PROVIDER];
    return [OLLAMA_PROVIDER, { ...CUSTOM_PROVIDER, baseUrl: base }];
}
