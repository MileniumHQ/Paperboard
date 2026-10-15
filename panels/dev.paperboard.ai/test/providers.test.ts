import { describe, expect, it } from "bun:test";
import { apiKeySecretName, connectionLabel, credentialsAllowed, definitionOf, endpointLabel, normalizeBaseUrl, unlistedModelReason } from "../src/core/providers";
import { checkCommandShape, commandSuggestions, MAX_AGENT_ARGS, splitArgs, validateCustomAgent } from "../src/core/agents";
import { providerClients } from "../src/service/provider";
import { REASONING_LEVELS, isReasoningLevel, reasoningToThink } from "../src/core/reasoning";
import { compactCount, groupTurns, isRoundEmpty, isThinkingLive, replyText, turnStats } from "../src/core/chain";
import type { AssistantMessage } from "../src/core/types";

describe("providers", () => {
    it("says why a chat's model is unusable: a removed provider and an endpoint that dropped it are not a missing download", () => {
        const connections = [
            { id: "ollama", kind: "ollama" as const, label: "Ollama" },
            { id: "api-0000000a", kind: "openai-compatible" as const, label: "Box", baseUrl: "http://127.0.0.1:1" },
        ];
        expect(unlistedModelReason(connections, "beta", "api-0000000b")).toBe("The provider beta ran on was removed. Pick a model from Models.");
        expect(unlistedModelReason(connections, "beta", "api-0000000a")).toBe("Box doesn't list beta. Pick a model from Models.");
        expect(unlistedModelReason(connections, "qwen3:8b", "ollama")).toBe("qwen3:8b is not downloaded. Pick one from Models.");
        expect(unlistedModelReason(connections, "qwen3:8b", undefined)).toBe("qwen3:8b is not downloaded. Pick one from Models.");
    });

    it("routes Ollama to its runtime and each endpoint to its own URL", () => {
        expect(definitionOf({ id: "ollama", kind: "ollama", label: "Ollama" }).runtime?.packageId).toBe("ollama");
        const endpoint = definitionOf({ id: "api-0000000a", kind: "openai-compatible", label: "Local", baseUrl: "http://127.0.0.1:1234" });
        expect(endpoint).toMatchObject({ id: "api-0000000a", label: "Local", baseUrl: "http://127.0.0.1:1234", canPull: false });
    });

    it("builds a client per reachable connection: Ollama only once running, an endpoint only with a URL", () => {
        const connections = [
            { id: "ollama", kind: "ollama" as const, label: "Ollama" },
            { id: "api-0000000a", kind: "openai-compatible" as const, label: "A", baseUrl: "http://127.0.0.1:1" },
            { id: "api-0000000b", kind: "openai-compatible" as const, label: "B", baseUrl: "" },
        ];
        expect([...providerClients({ ollama: null }, connections).keys()]).toEqual(["api-0000000a"]);
    });

    it("names an endpoint's vault secret for its connection, and nothing else", () => {
        expect(apiKeySecretName("api-0000000a")).toBe("api-key-api-0000000a");
        expect(() => apiKeySecretName("ollama")).toThrow();
        expect(() => apiKeySecretName("api-../x")).toThrow();
    });

    it("labels connections by name, an endpoint by its host by default", () => {
        expect(endpointLabel("https://api.example.com/v1")).toBe("api.example.com");
        expect(connectionLabel([{ id: "ollama", kind: "ollama", label: "Ollama" }], "ollama")).toBe("Ollama");
        expect(connectionLabel([], "api-0000000a")).toBe("api-0000000a");
    });

    it("refuses a non-http endpoint URL", () => {
        expect(normalizeBaseUrl("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234");
        expect(normalizeBaseUrl("https://example.com/v1/")).toBe("https://example.com/v1");
        expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow(/http/);
        expect(() => normalizeBaseUrl("not a url")).toThrow(/valid URL/);
    });

    it("only lets an API key travel over TLS or to this machine", () => {
        expect(credentialsAllowed("https://api.example.com/v1")).toBe(true);
        expect(credentialsAllowed("http://127.0.0.1:1234")).toBe(true);
        expect(credentialsAllowed("http://localhost:11434")).toBe(true);
        expect(credentialsAllowed("http://[::1]:1234")).toBe(true);
        // plaintext to another host would put the key on the wire
        expect(credentialsAllowed("http://192.168.1.5:1234")).toBe(false);
        expect(credentialsAllowed("http://api.example.com")).toBe(false);
        expect(credentialsAllowed("not a url")).toBe(false);
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

    it("copies every round of a reply, dropping blank ones", () => {
        const r1: AssistantMessage = { ...base, id: "r1", content: "first", status: "done" };
        const r2: AssistantMessage = { ...base, id: "r2", content: "", status: "done", toolCalls: [action] };
        const r3: AssistantMessage = { ...base, id: "r3", content: "second", status: "done" };
        expect(replyText([r1, r2, r3])).toBe("first\n\nsecond");
        expect(replyText([{ ...base, content: "" }])).toBe("");
    });

    it("prints counts compactly", () => {
        expect(compactCount(950)).toBe("950");
        expect(compactCount(12_345)).toBe("12.3K");
        expect(compactCount(131_072)).toBe("131K");
    });
});

describe("custom agents", () => {
    it("keeps a command and argv as typed, without a shell", () => {
        expect(validateCustomAgent(" my-agent ", ["--acp", " ", "--model=x y"])).toEqual({ command: "my-agent", args: ["--acp", "--model=x y"] });
        expect(splitArgs("  --acp   --verbose ")).toEqual(["--acp", "--verbose"]);
    });

    it("refuses what can't be one argv entry", () => {
        expect(() => validateCustomAgent("", [])).toThrow("A command is required.");
        expect(() => validateCustomAgent("a\nb", [])).toThrow("line breaks");
        expect(() => validateCustomAgent("a", "--acp")).toThrow("list of strings");
        expect(() => validateCustomAgent("a", Array(MAX_AGENT_ARGS + 1).fill("x"))).toThrow(`At most ${MAX_AGENT_ARGS}`);
    });

    it("suggests an agent's slash commands while one is typed", () => {
        const commands = [{ name: "review", description: "" }, { name: "rename", description: "" }, { name: "plan", description: "" }];
        expect(commandSuggestions("/re", commands).map((c) => c.name)).toEqual(["review", "rename"]);
        expect(commandSuggestions("/review now", commands)).toEqual([]);
        expect(commandSuggestions("hi /re", commands)).toEqual([]);
    });
});

describe("agent commands", () => {
    it("are a name searched on PATH or an absolute path", () => {
        expect(checkCommandShape("codex-acp")).toBe("name");
        expect(checkCommandShape("/usr/bin/codex-acp")).toBe("absolute");
        expect(checkCommandShape("C:\\Tools\\agent.exe")).toBe("absolute");
        expect(checkCommandShape("\\\\server\\share\\agent.exe")).toBe("absolute");
        expect(() => checkCommandShape("./agent")).toThrow("must be a command name or an absolute path");
        expect(() => validateCustomAgent("bin/agent", [])).toThrow("must be a command name or an absolute path");
    });
});
