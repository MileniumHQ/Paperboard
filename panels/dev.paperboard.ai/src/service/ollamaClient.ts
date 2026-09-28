// HTTP client for the panel's own `ollama serve` on loopback.

import { LineSplitter } from "../core/ollamaLog";
import { imageBase64 } from "../core/attachments";
import type { OllamaMessage } from "../core/conversation";
import type { OllamaTool } from "../core/tools";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

export class OllamaError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
    }
}

export interface TagEntry {
    name: string;
    model?: string;
    size: number;
    modified_at?: string;
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
    remote_host?: string;
}

export interface ShowResponse {
    capabilities?: string[];
    model_info?: Record<string, unknown>;
    details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export interface PullEvent {
    status: string;
    digest?: string;
    total?: number;
    completed?: number;
}

export interface ChatChunk {
    message?: {
        role?: string;
        content?: string;
        thinking?: string;
        tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
    };
    done?: boolean;
    done_reason?: string;
    eval_count?: number;
    eval_duration?: number;
    /** tokens of the prompt the model read this turn */
    prompt_eval_count?: number;
    error?: string;
}

export interface ChatRequest {
    model: string;
    messages: OllamaMessage[];
    tools?: OllamaTool[];
    /** false disables thinking; a level asks for that much */
    think?: boolean | string;
    options?: { num_ctx?: number; num_predict?: number };
}

/** Ollama takes raw base64 images; the internal history carries data URLs. */
function toOllamaMessages(messages: OllamaMessage[]): OllamaMessage[] {
    return messages.map((m) => {
        if (!m.images?.length) return m;
        const images = m.images.map((url) => imageBase64(url)).filter((b): b is string => Boolean(b));
        return images.length ? { ...m, images } : { ...m, images: undefined };
    });
}

async function readError(res: Response): Promise<string> {
    const text = await res.text().catch((err) => `unreadable body (${String(err)})`);
    try {
        const body = JSON.parse(text) as { error?: string };
        if (body.error) return body.error;
    } catch {
        // not JSON: the raw body is the message
    }
    return text.slice(0, 500) || `HTTP ${res.status}`;
}

export class OllamaClient {
    constructor(readonly baseUrl: string) {}

    private async json<T>(path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
            signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new OllamaError(await readError(res), res.status);
        const text = await res.text();
        if (text.length > MAX_JSON_BYTES) throw new OllamaError(`response from ${path} exceeds ${MAX_JSON_BYTES} bytes`);
        return JSON.parse(text) as T;
    }

    version(timeoutMs = 3_000): Promise<{ version: string }> {
        return this.json("/api/version", undefined, timeoutMs);
    }

    async tags(): Promise<TagEntry[]> {
        const body = await this.json<{ models?: TagEntry[] }>("/api/tags");
        return Array.isArray(body.models) ? body.models : [];
    }

    show(model: string): Promise<ShowResponse> {
        return this.json("/api/show", { method: "POST", body: JSON.stringify({ model }) });
    }

    async delete(model: string): Promise<void> {
        const res = await fetch(`${this.baseUrl}/api/delete`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) throw new OllamaError(await readError(res), res.status);
    }

    /** Streams NDJSON objects; `onEvent` runs for each. Rejects on an error line. */
    private async stream<T extends { error?: string }>(
        path: string,
        body: unknown,
        signal: AbortSignal,
        onEvent: (event: T) => void,
    ): Promise<void> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
        });
        if (!res.ok || !res.body) throw new OllamaError(await readError(res), res.status);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        const lines = new LineSplitter();
        const handle = (line: string) => {
            if (!line.trim()) return;
            const event = JSON.parse(line) as T;
            if (event.error) throw new OllamaError(event.error);
            onEvent(event);
        };
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of lines.push(value)) handle(line);
            }
            for (const line of lines.flush()) handle(line);
        } finally {
            // both ends: an abort or a parse failure must not leave the
            // response body open
            await reader.cancel().catch((err) => console.debug("[ai] stream cancel after end:", String(err)));
        }
    }

    pull(model: string, signal: AbortSignal, onEvent: (event: PullEvent) => void): Promise<void> {
        return this.stream<PullEvent & { error?: string }>("/api/pull", { model, stream: true }, signal, onEvent);
    }

    chat(request: ChatRequest, signal: AbortSignal, onChunk: (chunk: ChatChunk) => void): Promise<void> {
        return this.stream<ChatChunk>("/api/chat", { ...request, messages: toOllamaMessages(request.messages), stream: true }, signal, onChunk);
    }
}
