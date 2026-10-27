// Favorite models, the pure rules: add/remove, the cap, what a stored list
// may hold, and how an action or widget value names a provider.
import { describe, expect, it } from "bun:test";
import {
    addFavorite,
    favoriteChoices,
    favoriteValue,
    MAX_FAVORITES,
    parseModelChoice,
    removeFavorite,
    sanitizeFavorites,
} from "../src/core/favorites";
import type { Connection } from "../src/core/providers";

const connections: Connection[] = [
    { id: "ollama", kind: "ollama", label: "Local AI" },
    { id: "api-0000000a", kind: "openai-compatible", label: "OpenRouter", baseUrl: "https://openrouter.example/api" },
    { id: "agent-0000000b", kind: "agent", label: "Codex", agent: "codex" },
];

describe("favorite list", () => {
    it("adds once, removes by provider and name, and refuses past the cap", () => {
        let list = addFavorite([], { provider: "ollama", model: "qwen3:8b" });
        list = addFavorite(list, { provider: "ollama", model: "qwen3:8b" });
        list = addFavorite(list, { provider: "api-0000000a", model: "qwen3:8b" });
        expect(list).toHaveLength(2);
        expect(removeFavorite(list, { provider: "ollama", model: "qwen3:8b" })).toEqual([{ provider: "api-0000000a", model: "qwen3:8b" }]);
        const full = Array.from({ length: MAX_FAVORITES }, (_, i) => ({ provider: "ollama", model: `m${i}` }));
        expect(() => addFavorite(full, { provider: "ollama", model: "one-more" })).toThrow(`At most ${MAX_FAVORITES}`);
    });

    it("keeps only well-formed favorites of providers that exist, without duplicates, capped", () => {
        const ids = connections.map((c) => c.id);
        expect(
            sanitizeFavorites(
                [
                    { provider: "ollama", model: "qwen3:8b" },
                    { provider: "ollama", model: "qwen3:8b" },
                    { provider: "api-0000dead", model: "gone" },
                    { provider: "ollama", model: " padded " },
                    { provider: "ollama", model: "x".repeat(113) },
                    { provider: "ollama", model: "bad\nname" },
                    "junk",
                    null,
                    { provider: "agent-0000000b", model: "gpt-5" },
                ],
                ids,
            ),
        ).toEqual([
            { provider: "ollama", model: "qwen3:8b" },
            { provider: "agent-0000000b", model: "gpt-5" },
        ]);
        expect(sanitizeFavorites({ not: "a list" }, ids)).toEqual([]);
        const many = Array.from({ length: MAX_FAVORITES + 10 }, (_, i) => ({ provider: "ollama", model: `m${i}` }));
        expect(sanitizeFavorites(many, ids)).toHaveLength(MAX_FAVORITES);
    });
});

describe("favorite values", () => {
    it("names the provider, and reads a plain name saved before favorites as a name", () => {
        expect(favoriteValue({ provider: "api-0000000a", model: "openai/gpt-4o" })).toBe("api-0000000a|openai/gpt-4o");
        expect(parseModelChoice("api-0000000a|openai/gpt-4o")).toEqual({ provider: "api-0000000a", model: "openai/gpt-4o" });
        expect(parseModelChoice("ollama|qwen3:8b")).toEqual({ provider: "ollama", model: "qwen3:8b" });
        expect(parseModelChoice("qwen3:8b")).toEqual({ model: "qwen3:8b" });
        // a separator after something that isn't a connection id is part of the name
        expect(parseModelChoice("weird|name")).toEqual({ model: "weird|name" });
    });

    it("offers favorites labelled with their provider, leaving out coding agents and removed providers", () => {
        const choices = favoriteChoices(
            [
                { provider: "ollama", model: "qwen3:8b" },
                { provider: "agent-0000000b", model: "gpt-5" },
                { provider: "api-0000dead", model: "gone" },
                { provider: "api-0000000a", model: "openai/gpt-4o" },
            ],
            connections,
        );
        expect(choices).toEqual([
            { label: "qwen3:8b", value: "ollama|qwen3:8b", description: "Local AI" },
            { label: "openai/gpt-4o", value: "api-0000000a|openai/gpt-4o", description: "OpenRouter" },
        ]);
    });
});
