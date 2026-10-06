// A scripted stand-in for `ollama serve` on loopback: the same HTTP routes
// and NDJSON streams the panel reads. Run directly, it behaves like the real
// binary at startup (binds port 0, logs "Listening on ..." in slog format),
// so the runtime lifecycle can be tested against a real child process.

export interface FakeChatTurn {
    content?: string;
    thinking?: string;
    toolCalls?: { name: string; arguments: unknown }[];
    /** reply chunks are sent this far apart */
    chunkDelayMs?: number;
    error?: string;
}

export interface FakeModel {
    name: string;
    size: number;
    capabilities: string[];
}

export interface FakeOllama {
    url: string;
    port: number;
    chatRequests: any[];
    pulls: string[];
    script: FakeChatTurn[];
    models: FakeModel[];
    /** hold pulls open until released (to test cancel/caps) */
    holdPulls: boolean;
    releasePulls: () => void;
    /** hold chat replies open until released (to test concurrent-reply caps) */
    holdChats: boolean;
    releaseChats: () => void;
    stop: () => Promise<void>;
}

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startFakeOllama(): FakeOllama {
    const state: Omit<FakeOllama, "url" | "port" | "stop"> = {
        chatRequests: [],
        pulls: [],
        script: [],
        models: [{ name: "tooly:latest", size: 5e9, capabilities: ["completion", "tools"] }],
        holdPulls: false,
        releasePulls: () => {
            state.holdPulls = false;
        },
        holdChats: false,
        releaseChats: () => {
            state.holdChats = false;
        },
    };

    const stream = (gen: (push: (obj: unknown) => void) => Promise<void>) =>
        new Response(
            new ReadableStream({
                async start(controller) {
                    try {
                        await gen((obj) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`)));
                    } catch (err) {
                        console.debug("[fake-ollama] stream ended early:", String(err));
                    }
                    try {
                        controller.close();
                    } catch {
                        // client already went away
                    }
                },
            }),
            { headers: { "Content-Type": "application/x-ndjson" } },
        );

    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            const body = req.method === "GET" ? null : await req.json().catch(() => null);
            switch (url.pathname) {
                case "/api/version":
                    return Response.json({ version: "0.0.0-fake" });
                case "/api/tags":
                    return Response.json({
                        models: state.models.map((m) => ({ name: m.name, model: m.name, size: m.size, details: { family: "fake", parameter_size: "8B", quantization_level: "Q4_K_M" } })),
                    });
                case "/api/show": {
                    const m = state.models.find((x) => x.name === body?.model);
                    if (!m) return Response.json({ error: `model '${body?.model}' not found` }, { status: 404 });
                    return Response.json({
                        capabilities: m.capabilities,
                        model_info: {
                            "general.architecture": "fake",
                            "fake.block_count": 32,
                            "fake.attention.head_count": 32,
                            "fake.attention.head_count_kv": 8,
                            "fake.attention.key_length": 128,
                            "fake.context_length": 40960,
                        },
                    });
                }
                case "/api/delete": {
                    const before = state.models.length;
                    state.models = state.models.filter((m) => m.name !== body?.model);
                    return before === state.models.length ? Response.json({ error: "not found" }, { status: 404 }) : new Response(null);
                }
                case "/api/pull": {
                    const model = String(body?.model);
                    state.pulls.push(model);
                    return stream(async (push) => {
                        push({ status: "pulling manifest" });
                        push({ status: "pulling abc", digest: "sha256:abc", total: 1000, completed: 250 });
                        while (state.holdPulls) await sleep(5);
                        push({ status: "pulling abc", digest: "sha256:abc", total: 1000, completed: 1000 });
                        if (model.startsWith("broken")) {
                            push({ error: "pull model manifest: file does not exist" });
                            return;
                        }
                        state.models.push({ name: model, size: 1000, capabilities: ["completion"] });
                        push({ status: "success" });
                    });
                }
                case "/api/chat": {
                    state.chatRequests.push(body);
                    const turn = state.script.shift() ?? { content: "(no script)" };
                    if (turn.error) return Response.json({ error: turn.error }, { status: 500 });
                    return stream(async (push) => {
                        while (state.holdChats) await sleep(5);
                        for (const piece of (turn.thinking ?? "").match(/.{1,4}/gs) ?? []) {
                            push({ message: { role: "assistant", content: "", thinking: piece }, done: false });
                        }
                        for (const piece of (turn.content ?? "").match(/.{1,4}/gs) ?? []) {
                            if (turn.chunkDelayMs) await sleep(turn.chunkDelayMs);
                            push({ message: { role: "assistant", content: piece }, done: false });
                        }
                        if (turn.toolCalls?.length) {
                            push({
                                message: {
                                    role: "assistant",
                                    content: "",
                                    tool_calls: turn.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })),
                                },
                                done: false,
                            });
                        }
                        push({ message: { role: "assistant", content: "" }, done: true, eval_count: 40, eval_duration: 2e9, prompt_eval_count: 120 });
                    });
                }
                default:
                    return new Response("404 page not found", { status: 404 });
            }
        },
    });

    return {
        ...(state as FakeOllama),
        get chatRequests() {
            return state.chatRequests;
        },
        get pulls() {
            return state.pulls;
        },
        get script() {
            return state.script;
        },
        set script(v) {
            state.script = v;
        },
        get models() {
            return state.models;
        },
        set models(v) {
            state.models = v;
        },
        get holdPulls() {
            return state.holdPulls;
        },
        set holdPulls(v) {
            state.holdPulls = v;
        },
        get holdChats() {
            return state.holdChats;
        },
        set holdChats(v) {
            state.holdChats = v;
        },
        releasePulls: () => state.releasePulls(),
        releaseChats: () => state.releaseChats(),
        url: `http://127.0.0.1:${server.port}`,
        port: server.port!,
        stop: () => server.stop(true),
    };
}

// Child-process mode: `bun test/fakeOllama.ts serve`, like the real binary.
// FAKE_OLLAMA_MODE=exit-early exits before listening; ignore-term ignores
// SIGTERM so the runtime has to escalate.
if (import.meta.main && process.argv.includes("serve")) {
    const mode = process.env.FAKE_OLLAMA_MODE ?? "";
    const log = (msg: string, extra = "") =>
        process.stderr.write(`time=${new Date().toISOString()} level=INFO source=fake.go:1 msg="${msg}"${extra}\n`);
    if (mode === "exit-early") {
        process.stderr.write('Error: listen tcp 127.0.0.1:0: bind: address already in use\n');
        process.exit(1);
    }
    if (mode === "ignore-term") process.on("SIGTERM", () => log("ignoring SIGTERM"));
    const fake = startFakeOllama();
    log("inference compute", ' id=0 library=Vulkan name=Vulkan0 description="Fake GPU 9000" type=discrete total="16.0 GiB" available="15.0 GiB"');
    log(`Listening on 127.0.0.1:${fake.port} (version 0.0.0-fake)`);
    process.stderr.write(`env OLLAMA_MODELS=${process.env.OLLAMA_MODELS} HOME=${process.env.HOME} OLLAMA_NO_CLOUD=${process.env.OLLAMA_NO_CLOUD}\n`);
}
