// Providers: how the panel reaches a model. A provider is either a local
// binary the panel installs and starts (Ollama), or an OpenAI-compatible
// endpoint it is simply pointed at. The transport differs, everything above
// it does not: models always carry their provider id, so installs and stops
// can be labelled truthfully and more providers can be added by declaring one
// here plus an adapter (see service/provider.ts).
//
// No auth tokens: every provider this panel can reach is local or loopback.

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

export const PROVIDERS: readonly ProviderDefinition[] = [
    {
        id: OLLAMA_PROVIDER_ID,
        label: "Ollama",
        kind: "ollama",
        runtime: { packageId: "ollama" },
        canPull: true,
    },
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
