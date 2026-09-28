import { describe, expect, it } from "bun:test";
import {
    DEFAULT_PROVIDER_ID,
    PROVIDERS,
    providerFor,
    providerLabel,
} from "../src/core/providers";
import { REASONING_LEVELS, isReasoningLevel, reasoningToThink } from "../src/core/reasoning";
import { compactCount, groupTurns, isRoundEmpty, isThinkingLive, turnStats } from "../src/core/chain";
import type { AssistantMessage } from "../src/core/types";

describe("providers", () => {
    it("ships Ollama as the default local provider", () => {
        expect(DEFAULT_PROVIDER_ID).toBe("ollama");
        expect(providerFor(undefined).id).toBe("ollama");
        expect(providerLabel("ollama")).toBe("Ollama");
        expect(PROVIDERS.find((p) => p.id === "ollama")?.runtime?.packageId).toBe("ollama");
    });

    it("falls back to the default for an unknown provider id", () => {
        expect(providerFor("apple-foundation").id).toBe("ollama");
        expect(providerLabel(undefined)).toBe("Ollama");
    });
});

describe("reasoning", () => {
    it("maps levels to the think wire value", () => {
        expect(reasoningToThink("off")).toBe(false);
        expect(reasoningToThink("low")).toBe("low");
        expect(reasoningToThink("high")).toBe("high");
        expect(REASONING_LEVELS).toEqual(["off", "low", "medium", "high"]);
    });

    it("validates levels", () => {
        expect(isReasoningLevel("medium")).toBe(true);
        expect(isReasoningLevel("none")).toBe(false);
        expect(isReasoningLevel(undefined)).toBe(false);
    });
});

describe("chain", () => {
    const base: AssistantMessage = {
        id: "a",
        role: "assistant",
        model: "m",
        content: "",
        status: "streaming",
        createdAt: 1,
    };

    const user = { id: "u", role: "user" as const, content: "hi", createdAt: 0 };
    const action = { id: "t1", tool: "x", panelId: "p", action: "a", label: "Do", arguments: {}, status: "done" as const, result: "ok" };

    it("groups the rounds of one reply into a single turn", () => {
        const round1: AssistantMessage = { ...base, id: "r1", status: "done", toolCalls: [action], stats: { tokens: 1, tokensPerSecond: 1 } };
        const round2: AssistantMessage = { ...base, id: "r2", content: "answer" };
        const turns = groupTurns([user, round1, round2, { ...user, id: "u2" }, { ...base, id: "r3" }]);
        expect(turns.map((t) => t.kind)).toEqual(["user", "assistant", "user", "assistant"]);
        expect(turns[1]).toEqual({ kind: "assistant", rounds: [round1, round2] });
    });

    it("stops calling a round live once it answers or invokes an action", () => {
        expect(isThinkingLive({ ...base, thinking: "why" })).toBe(true);
        expect(isThinkingLive({ ...base, thinking: "why", content: "a" })).toBe(false);
        expect(isThinkingLive({ ...base, thinking: "why", toolCalls: [action] })).toBe(false);
        expect(isThinkingLive({ ...base, thinking: "why", status: "done" })).toBe(false);
    });

    it("treats a round as empty only before any token", () => {
        expect(isRoundEmpty(base)).toBe(true);
        expect(isRoundEmpty({ ...base, thinking: "w" })).toBe(false);
    });

    it("sums a reply's tokens across rounds and reads context from the last", () => {
        const r1: AssistantMessage = { ...base, id: "r1", status: "done", stats: { tokens: 30, tokensPerSecond: 10, promptTokens: 500, contextLength: 8192 } };
        const r2: AssistantMessage = { ...base, id: "r2", status: "done", stats: { tokens: 70, tokensPerSecond: 12.5, promptTokens: 900, contextLength: 8192 } };
        expect(turnStats([r1, r2])).toEqual({ tokens: 100, tokensPerSecond: 12.5, contextUsed: 970, contextLength: 8192 });
        expect(turnStats([r1, { ...r2, stats: undefined }])).toBeUndefined();
        expect(turnStats([{ ...r2, stats: { tokens: 5, tokensPerSecond: 1 } }])).toEqual({ tokens: 5, tokensPerSecond: 1 });
    });

    it("prints counts compactly", () => {
        expect(compactCount(950)).toBe("950");
        expect(compactCount(12_345)).toBe("12.3K");
        expect(compactCount(131_072)).toBe("131K");
    });
});
