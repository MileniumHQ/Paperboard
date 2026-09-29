import { describe, it, expect } from "bun:test";
import {
    BuiltinArgumentError,
    builtinArguments,
    MAX_QUERY_CHARS,
    parseDuckDuckGoResults,
    SearchUnavailableError,
    shellArgv,
} from "../src/core/builtins";
import { systemPrompt } from "../src/core/conversation";
import fs from "node:fs";
import path from "node:path";
import rawCatalog from "../src/data/models.json";
import {
    findCatalogTag,
    isValidModelRef,
    parseCatalog,
    searchCatalog,
    splitModelRef,
} from "../src/core/catalog";
import { architectureFromModelInfo, estimateFit, gpuBudget, kvCacheBytes } from "../src/core/fit";
import {
    buildToolSet,
    formatToolResult,
    MAX_TOOL_RESULT_CHARS,
    prepareArguments,
    ToolArgumentError,
    toolName,
    type RegistryAction,
} from "../src/core/tools";
import {
    appendTail,
    LineSplitter,
    parseHumanBytes,
    parseInferenceCompute,
    parseListening,
} from "../src/core/ollamaLog";
import { markInterrupted, titleFrom, toOllamaMessages } from "../src/core/conversation";
import type { Conversation, HardwareState } from "../src/core/types";

const GiB = 1024 ** 3;

describe("shipped model catalog", () => {
    const catalog = parseCatalog(rawCatalog);

    it("validates, and holds no cloud-only entries", () => {
        expect(catalog.models.length).toBeGreaterThan(100);
        for (const m of catalog.models) {
            expect(m.tags.length).toBeGreaterThan(0);
            for (const t of m.tags) expect(t.tag).not.toContain("cloud");
        }
    });

    it("every maker logo the catalog names is bundled", () => {
        const dir = path.join(import.meta.dir, "..", "src", "assets", "makers");
        for (const maker of Object.values(catalog.makers)) {
            if (maker.icon) expect(fs.existsSync(path.join(dir, `${maker.icon}.svg`))).toBe(true);
        }
    });

    it("search filters by text, maker and tool support", () => {
        const tools = searchCatalog(catalog, { toolsOnly: true });
        expect(tools.every((m) => m.capabilities.includes("tools"))).toBe(true);
        expect(searchCatalog(catalog, { text: "ibm" }).some((m) => m.name.startsWith("granite"))).toBe(true);
    });

    it("sorts newest first by default, or by downloads", () => {
        const downloads = searchCatalog(catalog, { sort: "downloads" });
        expect(downloads[0]!.pulls).toBeGreaterThanOrEqual(downloads[1]!.pulls);

        const newest = searchCatalog(catalog, { sort: "newest" });
        for (let i = 0; i < 10; i++) {
            expect((newest[i]!.updatedAt ?? "") >= (newest[i + 1]!.updatedAt ?? "")).toBe(true);
        }

        // newest is the default order
        expect(searchCatalog(catalog, {})).toEqual(newest);
    });

    it("resolves model refs to tags", () => {
        expect(splitModelRef("qwen3:8b")).toEqual({ name: "qwen3", tag: "8b" });
        expect(splitModelRef("qwen3")).toEqual({ name: "qwen3", tag: "latest" });
        expect(findCatalogTag(catalog, "qwen3:8b")?.tag.bytes).toBeGreaterThan(GiB);
        expect(findCatalogTag(catalog, "qwen3:999b")).toBeNull();
    });

    it("refuses model refs outside the Ollama library", () => {
        expect(isValidModelRef("qwen3:8b")).toBe(true);
        expect(isValidModelRef("someone/model:q4_K_M")).toBe(true);
        expect(isValidModelRef("hf.co/user/repo:Q4")).toBe(false);
        expect(isValidModelRef("../etc")).toBe(false);
        expect(isValidModelRef("a b")).toBe(false);
    });

    it("rejects a malformed catalog", () => {
        expect(() => parseCatalog({ schemaVersion: 2 })).toThrow(/unsupported/);
        expect(() =>
            parseCatalog({ schemaVersion: 1, makers: {}, models: [{ name: "x", maker: "nobody", tags: [] }] }),
        ).toThrow(/unknown maker/);
    });
});

function hw(partial: Partial<HardwareState>): HardwareState {
    return { gpus: [], ramBytes: 32 * GiB, errors: [], loaded: true, ...partial };
}

describe("fit estimate", () => {
    const rx7800 = { name: "Radeon RX 7800 XT", vendor: "amd", memoryTotalBytes: 16 * GiB };
    const apu = { name: "Raphael", vendor: "amd", memoryTotalBytes: 0.5 * GiB };

    it("ignores APU carve-outs and keeps headroom on the real card", () => {
        const budget = gpuBudget(hw({ gpus: [apu, rx7800] }));
        expect(budget).toBeLessThan(16 * GiB);
        expect(budget).toBeGreaterThan(14 * GiB);
    });

    it("an 8B at Q4 runs on a 16 GB card", () => {
        const fit = estimateFit(5.2e9, 8192, hw({ gpus: [apu, rx7800] }));
        expect(fit.rating).toBe("gpu");
        expect(fit.exact).toBe(false);
    });

    it("a 32B at Q4 on a 16 GB card is partly offloaded", () => {
        const fit = estimateFit(20e9, 8192, hw({ gpus: [rx7800] }));
        expect(fit.rating).toBe("partial");
        expect(fit.gpuShare).toBeGreaterThan(0.5);
        expect(fit.gpuShare).toBeLessThan(1);
    });

    it("no GPU: small models run on the CPU, giants do not fit", () => {
        expect(estimateFit(2e9, 4096, hw({})).rating).toBe("cpu");
        expect(estimateFit(400e9, 4096, hw({})).rating).toBe("too-big");
    });

    it("an unreadable GPU inventory is unknown, never CPU-only", () => {
        expect(estimateFit(2e9, 4096, hw({ errors: ["nvidia-smi: failed"] })).rating).toBe("unknown");
        expect(estimateFit(2e9, 4096, hw({ loaded: false })).rating).toBe("unknown");
    });

    it("unified memory has no spill space", () => {
        const mac = { name: "Apple M2 Pro", vendor: "apple", memoryTotalBytes: 16 * GiB, unifiedMemory: true };
        expect(estimateFit(5e9, 8192, hw({ gpus: [mac], ramBytes: 16 * GiB })).rating).toBe("gpu");
        expect(estimateFit(14e9, 8192, hw({ gpus: [mac], ramBytes: 16 * GiB })).rating).toBe("too-big");
    });

    it("installed models use their real attention geometry", () => {
        const arch = architectureFromModelInfo({
            "general.architecture": "qwen3",
            "qwen3.block_count": 36,
            "qwen3.attention.head_count": 32,
            "qwen3.attention.head_count_kv": 8,
            "qwen3.attention.key_length": 128,
        });
        expect(arch).toEqual({ layers: 36, kvHeads: 8, headDim: 128 });
        const kv = kvCacheBytes(5e9, 8192, arch);
        expect(kv).toEqual({ bytes: 2 * 36 * 8 * 128 * 2 * 8192, exact: true });
        expect(architectureFromModelInfo({ "general.architecture": "x" })).toBeNull();
    });
});

const registry: RegistryAction[] = [
    {
        panelId: "dev.paperboard.gameserver",
        action: "start-server",
        schema: { name: "Start Server", description: "Starts the Minecraft server" },
    },
    {
        panelId: "dev.paperboard.gameserver",
        action: "kick-player",
        schema: {
            name: "Kick Player",
            inputs: {
                player: { type: "string", label: "Player", required: true },
                count: { type: "number", label: "Count" },
                mode: { type: "string", label: "Mode", options: [{ label: "Soft", value: "soft" }, { label: "Hard", value: "hard" }] },
            },
        },
    },
    { panelId: "dev.paperboard.gameserver", action: "get-state", schema: { name: "State", internal: true } },
    { panelId: "dev.paperboard.gameserver", action: "player-joined", schema: { name: "Player Joined", eventOnly: true } },
    { panelId: "dev.paperboard.ai", action: "ask", schema: { name: "Ask AI" } },
    { panelId: "com.other.gameserver", action: "start-server", schema: { name: "Start Other" } },
    { panelId: "dev.paperboard.terminal", action: "bare-handler" },
];

describe("action registry → tools", () => {
    const set = buildToolSet(registry, "dev.paperboard.ai", { "dev.paperboard.gameserver": "Game Server" });

    it("exposes only callable actions of other panels", () => {
        const names = set.tools.map((t) => t.function.name);
        expect(names).toContain("gameserver__start-server");
        expect(names).toContain("gameserver__kick-player");
        expect(names.some((n) => n.includes("get-state"))).toBe(false); // internal
        expect(names.some((n) => n.includes("player-joined"))).toBe(false); // event-only
        expect(names.some((n) => n.includes("ask"))).toBe(false); // self
        expect(names.some((n) => n.includes("bare-handler"))).toBe(false); // no schema
    });

    it("keeps same-named actions of different panels apart", () => {
        const starts = [...set.targets.entries()].filter(([, t]) => t.action === "start-server");
        expect(starts).toHaveLength(2);
        expect(new Set(starts.map(([name]) => name)).size).toBe(2);
        expect(new Set(starts.map(([, t]) => t.panelId))).toEqual(new Set(["com.other.gameserver", "dev.paperboard.gameserver"]));
    });

    it("describes inputs as JSON schema", () => {
        const kick = set.tools.find((t) => t.function.name === "gameserver__kick-player")!;
        expect(kick.function.description).toStartWith("Game Server: Kick Player.");
        expect(kick.function.parameters.required).toEqual(["player"]);
        expect(kick.function.parameters.properties.count!.type).toBe("number");
        expect(kick.function.parameters.properties.mode!.enum).toEqual(["soft", "hard"]);
    });

    it("tool names fit Ollama's function-name rules", () => {
        expect(toolName("a.b.c", "x".repeat(100))).toHaveLength(64);
        for (const t of set.tools) expect(t.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    });

    it("prepares arguments: coerces scalars, drops unknowns, refuses bad input", () => {
        const kick = set.targets.get("gameserver__kick-player")!;
        expect(prepareArguments(kick, { player: "Steve", count: "3", extra: 1 })).toEqual({ player: "Steve", count: 3 });
        expect(prepareArguments(kick, '{"player":"Alex","mode":"hard"}')).toEqual({ player: "Alex", mode: "hard" });
        expect(() => prepareArguments(kick, {})).toThrow(ToolArgumentError);
        expect(() => prepareArguments(kick, { player: "x", count: "many" })).toThrow(/number/);
        expect(() => prepareArguments(kick, { player: "x", mode: "medium" })).toThrow(/one of/);
        expect(() => prepareArguments(kick, "not json")).toThrow(/JSON object/);
    });

    it("bounds tool results", () => {
        expect(formatToolResult(undefined)).toMatch(/no value/);
        expect(formatToolResult({ a: 1 })).toBe('{\n  "a": 1\n}');
        const long = formatToolResult("x".repeat(MAX_TOOL_RESULT_CHARS + 50));
        expect(long).toContain("[truncated: 50 more characters]");
    });
});

describe("ollama serve output", () => {
    it("finds the port the kernel picked", () => {
        const line = 'time=2026-09-26T15:00:00.000-07:00 level=INFO source=routes.go:2065 msg="Listening on 127.0.0.1:43215 (version 0.34.4)"';
        expect(parseListening(line)).toEqual({ host: "127.0.0.1", port: 43215, version: "0.34.4" });
        expect(parseListening("msg=hello")).toBeNull();
    });

    it("reads the compute devices Ollama chose", () => {
        const gpu =
            'time=x level=INFO source=types.go:42 msg="inference compute" id=0 filter_id="" library=Vulkan compute=0.0 name=Vulkan0 description="AMD Radeon RX 7800 XT (RADV NAVI32)" libdirs=ollama,vulkan driver=0.0 pci_id=0000:03:00.0 type=discrete total="16.0 GiB" available="14.6 GiB"';
        expect(parseInferenceCompute(gpu)).toEqual({
            library: "Vulkan",
            name: "AMD Radeon RX 7800 XT (RADV NAVI32)",
            totalBytes: 16 * GiB,
            availableBytes: Math.round(14.6 * GiB),
        });
        const cpu = 'msg="inference compute" id=cpu library=cpu compute="" name=cpu description=cpu libdirs=ollama driver="" pci_id="" type="" total="31.2 GiB" available="20.0 GiB"';
        expect(parseInferenceCompute(cpu)).toMatchObject({ library: "CPU", name: "CPU" });
        expect(parseHumanBytes("512 MiB")).toBe(512 * 1024 ** 2);
    });

    it("splits NDJSON with a bounded line buffer", () => {
        const s = new LineSplitter(16);
        expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
        expect(s.push(":2}\n")).toEqual(['{"b":2}']);
        expect(s.push("tail")).toEqual([]);
        expect(s.flush()).toEqual(["tail"]);
        expect(() => s.push("x".repeat(17))).toThrow(/exceeds/);
    });

    it("keeps a bounded output tail", () => {
        const tail = appendTail([], Array.from({ length: 30 }, (_, i) => `line ${i}`), 5);
        expect(tail).toEqual(["line 25", "line 26", "line 27", "line 28", "line 29"]);
    });
});

describe("conversations", () => {
    const base: Conversation = { id: "c1", title: "t", model: "m", createdAt: 1, updatedAt: 1, messages: [] };

    it("titles come from the first message", () => {
        expect(titleFrom("  hello\n there ")).toBe("hello there");
        expect(titleFrom("x".repeat(100))).toHaveLength(60);
        expect(titleFrom(" ")).toBe("New chat");
    });

    it("history carries tool calls and their results in Ollama's shape", () => {
        const msgs = toOllamaMessages(
            [
                { id: "u", role: "user", content: "start it", createdAt: 1 },
                {
                    id: "a",
                    role: "assistant",
                    model: "m",
                    content: "",
                    status: "done",
                    createdAt: 2,
                    toolCalls: [
                        { id: "t", tool: "gameserver__start-server", panelId: "p", action: "start-server", label: "Start", arguments: {}, status: "done", result: "ok" },
                    ],
                },
                { id: "a2", role: "assistant", model: "m", content: "Started.", status: "done", createdAt: 3 },
            ],
            "sys",
        );
        expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
        expect(msgs[2]!.tool_calls![0]!.function.name).toBe("gameserver__start-server");
        expect(msgs[2]!.tool_calls![0]!.id).toBe("t");
        expect(msgs[3]).toEqual({ role: "tool", tool_name: "gameserver__start-server", tool_call_id: "t", content: "ok" });
    });

    it("attachments reach the model: images as data URLs, files as text", () => {
        const png = "data:image/png;base64,AAAA";
        const msgs = toOllamaMessages(
            [
                {
                    id: "u",
                    role: "user",
                    content: "look at this",
                    createdAt: 1,
                    attachments: [
                        { id: "i", name: "shot.png", kind: "image", mime: "image/png", sizeBytes: 4, dataUrl: png },
                        { id: "f", name: "notes.md", kind: "text", mime: "text/markdown", sizeBytes: 4, text: "# Notes" },
                    ],
                },
            ],
            "sys",
        );
        expect(msgs[1]!.images).toEqual([png]);
        expect(msgs[1]!.content).toContain("look at this");
        expect(msgs[1]!.content).toContain("--- Attached file: notes.md ---\n# Notes");
    });

    it("image history stays bounded to the newest few", () => {
        const png = (n: number) => `data:image/png;base64,${"A".repeat(n)}`;
        const messages = Array.from({ length: 8 }, (_, i) => ({
            id: `u${i}`,
            role: "user" as const,
            content: `msg ${i}`,
            createdAt: i,
            attachments: [{ id: `i${i}`, name: `s${i}.png`, kind: "image" as const, mime: "image/png", sizeBytes: 4, dataUrl: png(8) }],
        }));
        const msgs = toOllamaMessages(messages, "");
        const withImages = msgs.filter((m) => m.images?.length);
        expect(withImages.length).toBe(4);
        expect(withImages.at(-1)!.content).toBe("msg 7");
    });

    it("a reply cut off by a restart is marked stopped, never left streaming", () => {
        const c = markInterrupted({
            ...base,
            messages: [
                {
                    id: "a",
                    role: "assistant",
                    model: "m",
                    content: "half",
                    status: "streaming",
                    createdAt: 1,
                    toolCalls: [{ id: "t", tool: "x", panelId: "p", action: "a", label: "A", arguments: {}, status: "awaiting-approval" }],
                },
            ],
        });
        const m = c.messages[0]!;
        expect(m.role === "assistant" && m.status).toBe("stopped");
        expect(m.role === "assistant" && m.toolCalls![0]!.status).toBe("error");
    });
});

describe("built-ins", () => {
    it("parses DuckDuckGo's result page into titles, links and excerpts, skipping ads", () => {
        const html = fs.readFileSync(path.join(import.meta.dir, "fixtures", "ddg-results.html"), "utf8");
        const results = parseDuckDuckGoResults(html);
        expect(results.length).toBe(3);
        expect(results[0]).toMatchObject({ title: "Stores - SolidJS Documentation", url: "https://docs.solidjs.com/concepts/stores" });
        expect(results[0]!.snippet).toBe("Manage complex nested state efficiently with stores that provide fine-grained reactivity for objects and arrays in Solid.");
        expect(results[2]!.snippet).toContain("Solid's answer to nested reactivity");
        expect(results.every((r) => !r.url.startsWith("https://duckduckgo.com/y.js"))).toBe(true);
    });

    it("a page with no readable results is a failure, not an empty answer", () => {
        expect(() => parseDuckDuckGoResults("<html><title>Just a moment</title></html>")).toThrow(SearchUnavailableError);
    });

    it("checks built-in arguments", () => {
        expect(builtinArguments("web_search", '{"query":" cats "}')).toEqual({ query: "cats" });
        expect(() => builtinArguments("run_shell_command", {})).toThrow(BuiltinArgumentError);
        expect(() => builtinArguments("web_search", { query: "x".repeat(MAX_QUERY_CHARS + 1) })).toThrow(BuiltinArgumentError);
    });

    it("runs shell commands through the platform shell", () => {
        expect(shellArgv("ls | wc -l", "linux")).toEqual({ command: "/bin/sh", args: ["-c", "ls | wc -l"] });
        expect(shellArgv("dir", "win32")).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", "dir"] });
    });

    it("never offers the terminal panel's actions", () => {
        const set = buildToolSet(
            [{ panelId: "dev.paperboard.terminal", action: "run", schema: { name: "Run" } }],
            "dev.paperboard.ai",
        );
        expect(set.tools).toHaveLength(0);
    });

    it("tells the model only about the tools it has", () => {
        const none = systemPrompt({ style: "quirky", model: "qwen3:8b", webSearch: false, shellCommands: false, panelActions: false });
        expect(none).not.toContain("Crane");
        expect(none).toContain("qwen3:8b");
        expect(none).not.toContain("web_search");
        const search = systemPrompt({ style: "no-nonsense", model: "qwen3:8b", webSearch: true, shellCommands: false, panelActions: false });
        expect(search).toContain("web_search");
        expect(search).not.toContain("run_shell_command");
    });
});
