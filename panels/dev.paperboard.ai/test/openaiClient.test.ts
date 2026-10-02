// The OpenAI-compatible adapter against a loopback fixture: model listing,
// SSE streaming, reasoning vs content, and tool-call fragment assembly.
import { describe, expect, it, afterEach } from "bun:test";
import type { ProviderDefinition } from "../src/core/providers";
import { OpenAICompatibleClient } from "../src/service/openaiClient";
import type { ChatChunk } from "../src/service/ollamaClient";

const provider: ProviderDefinition = {
    id: "local",
    label: "Local",
    kind: "openai-compatible",
    canPull: false,
    baseUrl: "",
    defaultCapabilities: ["completion", "tools"],
};

let server: ReturnType<typeof Bun.serve> | null = null;
let lastChatBody: any = null;
let lastAuth: string | null = null;

function start(): string {
    lastChatBody = null;
    lastAuth = null;
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const url = new URL(req.url);
            if (req.method === "GET" && url.pathname === "/v1/models") {
                lastAuth = req.headers.get("authorization");
                return Response.json({ data: [{ id: "local:7b" }, { id: "vision:1" }, { id: "models/gemini-x" }] });
            }
            if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
                lastChatBody = await req.json();
                const enc = new TextEncoder();
                const events = [
                    { choices: [{ delta: { content: "Hel" } }] },
                    { choices: [{ delta: { content: "lo", reasoning_content: "hmm" } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "do_thing", arguments: '{"a":' } }] } }] },
                    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] },
                    { choices: [{ finish_reason: "tool_calls" }], usage: { completion_tokens: 7 } },
                ];
                return new Response(
                    new ReadableStream({
                        start(controller) {
                            for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
                            controller.enqueue(enc.encode("data: [DONE]\n\n"));
                            controller.close();
                        },
                    }),
                    { headers: { "Content-Type": "text/event-stream" } },
                );
            }
            return new Response("not found", { status: 404 });
        },
    });
    return `http://127.0.0.1:${server.port}`;
}

afterEach(() => {
    server?.stop(true);
    server = null;
});

describe("OpenAI-compatible client", () => {
    it("lists models from /v1/models", async () => {
        const client = new OpenAICompatibleClient({ ...provider, baseUrl: start() });
        // a Google-style "models/" prefix is stripped from every id
        expect((await client.tags()).map((t) => t.name)).toEqual(["local:7b", "vision:1", "gemini-x"]);
    });

    it("reports the provider's declared capabilities", async () => {
        const client = new OpenAICompatibleClient({ ...provider, baseUrl: start() });
        expect((await client.show("local:7b")).capabilities).toEqual(["completion", "tools"]);
    });

    it("sends a configured vault API key as a bearer token", async () => {
        const client = new OpenAICompatibleClient({ ...provider, baseUrl: start() }, async () => "secret-key");
        await client.tags();
        expect(lastAuth).toBe("Bearer secret-key");
    });

    it("sends no Authorization header when no key is configured", async () => {
        const client = new OpenAICompatibleClient({ ...provider, baseUrl: start() });
        await client.tags();
        expect(lastAuth).toBeNull();
    });

    it("streams content, reasoning, and assembled tool calls", async () => {
        const client = new OpenAICompatibleClient({ ...provider, baseUrl: start() });
        const chunks: ChatChunk[] = [];
        await client.chat(
            {
                model: "local:7b",
                think: "low",
                messages: [
                    { role: "system", content: "sys" },
                    {
                        role: "user",
                        content: "what is this",
                        images: ["data:image/png;base64,AAAA"],
                    },
                ],
            },
            AbortSignal.timeout(5_000),
            (chunk) => chunks.push(chunk),
        );

        const text = chunks.map((c) => c.message?.content ?? "").join("");
        expect(text).toBe("Hello");
        expect(chunks.map((c) => c.message?.thinking).filter(Boolean)).toEqual(["hmm"]);
        const final = chunks.at(-1)!;
        expect(final.done).toBe(true);
        expect(final.eval_count).toBe(7);
        expect(final.message?.tool_calls).toEqual([{ function: { name: "do_thing", arguments: { a: 1 } } }]);

        // the request kept the OpenAI shape: reasoning effort and an image part
        expect(lastChatBody.reasoning_effort).toBe("low");
        expect(lastChatBody.model).toBe("local:7b");
        const userMessage = lastChatBody.messages.find((m: any) => m.role === "user");
        expect(Array.isArray(userMessage.content)).toBe(true);
        expect(userMessage.content[0]).toEqual({ type: "text", text: "what is this" });
        expect(userMessage.content[1].type).toBe("image_url");
    });
});
