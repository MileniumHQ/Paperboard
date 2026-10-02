// Chat and model listing over the OpenAI /v1 surface, for providers that are
// an endpoint rather than a managed binary (llama.cpp server, LM Studio, an
// Apple Foundation Models bridge, a hosted OpenAI-compatible API, ...). An
// endpoint may require an API key; when one is configured it is read from the
// vault per request and never stored in panel config or state.

import { LineSplitter } from "../core/ollamaLog";
import { credentialsAllowed, type ProviderDefinition } from "../core/providers";
import type { OllamaMessage } from "../core/conversation";
import type { ChatRequest } from "./ollamaClient";
import type { ChatChunk, ShowResponse, TagEntry } from "./ollamaClient";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

type OpenAIContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

interface OpenAIMessage {
    role: string;
    content: string | OpenAIContentPart[] | null;
    tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    tool_call_id?: string;
}

interface OpenAIStreamEvent {
    choices?: {
        delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: {
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
            }[];
        };
        finish_reason?: string | null;
    }[];
    usage?: { completion_tokens?: number };
}

function toOpenAIMessages(messages: OllamaMessage[]): OpenAIMessage[] {
    return messages.map((m) => {
        if (m.role === "user" && m.images?.length) {
            const parts: OpenAIContentPart[] = [];
            if (m.content) parts.push({ type: "text", text: m.content });
            for (const url of m.images) parts.push({ type: "image_url", image_url: { url } });
            return { role: "user", content: parts };
        }
        if (m.role === "assistant" && m.tool_calls?.length) {
            return {
                role: "assistant",
                content: m.content || null,
                tool_calls: m.tool_calls.map((t, i) => ({
                    id: t.id ?? `call_${i}`,
                    type: "function",
                    function: { name: t.function.name, arguments: JSON.stringify(t.function.arguments ?? {}) },
                })),
            };
        }
        if (m.role === "tool") {
            return { role: "tool", tool_call_id: m.tool_call_id ?? "", content: m.content };
        }
        return { role: m.role, content: m.content };
    });
}

/** Accumulates streamed tool_call fragments, which arrive name-and-args-split. */
interface PendingToolCall {
    id: string;
    name: string;
    args: string;
}

export class OpenAICompatibleClient {
    constructor(
        private readonly provider: ProviderDefinition,
        /** resolves the vault-stored API key, if one is configured */
        private readonly getApiKey?: () => Promise<string | undefined>,
    ) {}

    private get baseUrl(): string {
        return (this.provider.baseUrl ?? "").replace(/\/+$/, "");
    }

    private async authHeaders(): Promise<Record<string, string>> {
        if (!this.getApiKey) return {};
        // never put a vault key on a plaintext non-loopback wire
        if (!credentialsAllowed(this.baseUrl)) return {};
        const key = await this.getApiKey().catch(() => undefined);
        return key ? { Authorization: `Bearer ${key}` } : {};
    }

    private async json<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: { "Content-Type": "application/json", ...(await this.authHeaders()), ...(init?.headers ?? {}) },
            signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(body.slice(0, 500) || `HTTP ${res.status} from ${this.provider.label}`);
        }
        const text = await res.text();
        if (text.length > MAX_JSON_BYTES) throw new Error(`response from ${path} exceeds ${MAX_JSON_BYTES} bytes`);
        return JSON.parse(text) as T;
    }

    async tags(): Promise<TagEntry[]> {
        const body = await this.json<{ data?: { id?: string }[] }>("/v1/models");
        if (!Array.isArray(body.data)) return [];
        return body.data
            .map((m) => {
                if (typeof m.id !== "string") return null;
                // Google's compat endpoint prefixes ids with "models/";
                // strip it so the name is what every other server returns
                const name = m.id.replace(/^models\//, "");
                return name ? { name, size: 0 } : null;
            })
            .filter((m): m is TagEntry => m !== null);
    }

    /** Endpoints do not report capabilities; the provider definition declares them. */
    async show(_model: string): Promise<ShowResponse> {
        return { capabilities: this.provider.defaultCapabilities ?? [] };
    }

    async chat(request: ChatRequest, signal: AbortSignal, onChunk: (chunk: ChatChunk) => void): Promise<void> {
        const think = request.think;
        const body: Record<string, unknown> = {
            model: request.model,
            messages: toOpenAIMessages(request.messages),
            stream: true,
        };
        if (request.tools?.length) {
            body.tools = request.tools;
            body.tool_choice = "auto";
        }
        if (think === true) body.reasoning_effort = "medium";
        else if (typeof think === "string") body.reasoning_effort = think;

        const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(await this.authHeaders()) },
            body: JSON.stringify(body),
            signal,
        });
        if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            throw new Error(text.slice(0, 500) || `HTTP ${res.status} from ${this.provider.label}`);
        }

        const started = performance.now();
        const pending = new Map<number, PendingToolCall>();
        let usage: number | undefined;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        const lines = new LineSplitter();
        const handle = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) return;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") return;
            const event = JSON.parse(data) as OpenAIStreamEvent;
            const choice = event.choices?.[0];
            const delta = choice?.delta;
            if (event.usage?.completion_tokens) usage = event.usage.completion_tokens;
            if (delta) {
                const thinking = delta.reasoning_content ?? delta.reasoning ?? undefined;
                if (delta.content || thinking) {
                    onChunk({ message: { content: delta.content ?? undefined, ...(thinking ? { thinking } : {}) } });
                }
                for (const call of delta.tool_calls ?? []) {
                    const index = call.index ?? 0;
                    const entry = pending.get(index) ?? { id: call.id ?? `call_${index}`, name: "", args: "" };
                    if (call.id) entry.id = call.id;
                    if (call.function?.name) entry.name = call.function.name;
                    if (call.function?.arguments) entry.args += call.function.arguments;
                    pending.set(index, entry);
                }
            }
            if (choice?.finish_reason) {
                const toolCalls = [...pending.entries()]
                    .sort(([a], [b]) => a - b)
                    .map(([, call]) => ({ function: { name: call.name, arguments: parseArguments(call.args) } }));
                onChunk({
                    ...(toolCalls.length ? { message: { tool_calls: toolCalls } } : {}),
                    done: true,
                    ...(usage !== undefined
                        ? { eval_count: usage, eval_duration: Math.max(1, (performance.now() - started) * 1e6) }
                        : {}),
                });
            }
        };
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of lines.push(value)) handle(line);
            }
            for (const line of lines.flush()) handle(line);
        } finally {
            await reader.cancel().catch((err) => console.debug("[ai] stream cancel after end:", String(err)));
        }
    }
}

function parseArguments(raw: string): Record<string, unknown> {
    if (!raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}
