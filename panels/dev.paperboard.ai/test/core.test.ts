import { describe, it, expect } from "bun:test";
import { BuiltinArgumentError, builtinArguments, MAX_COMMAND_CHARS, shellArgv } from "../src/core/builtins";
import { systemPrompt, PROMPT_STYLES } from "../src/core/conversation";
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
    formatToolResult,
    MAX_TOOL_RESULT_CHARS,
    prepareArguments,
    ToolArgumentError,
    type RegistryAction,
} from "../src/core/tools";
import {
    APP_ACTION_TOOLS,
    buildActionIndex,
    formatFoundActions,
    MAX_FIND_RESULT_CHARS,
    MAX_FOUND_ACTIONS,
    MAX_INDEXED_ACTIONS,
    resolveActionCall,
    searchActions,
} from "../src/core/appActions";
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

    it("holds only chat models: no embedding, decision or safety-classifier models", () => {
        // these answer with a verdict ("safe"/"unsafe", "Yes"/"No"), not a conversation
        const classifiers = ["llama-guard3", "shieldgemma", "granite3-guardian", "granite4.1-guardian", "gpt-oss-safeguard", "bespoke-minicheck"];
        // typed to in a chat, these echo the prompt, loop on fake turns, or answer only in SQL
        const noReply = ["deepseek-ocr", "duckdb-nsql", "sqlcoder", "starcoder", "starcoder2", "yarn-llama2", "yarn-mistral"];
        for (const m of catalog.models) {
            expect(classifiers).not.toContain(m.name);
            expect(noReply).not.toContain(m.name);
            expect(m.capabilities).not.toContain("embedding");
            expect(m.capabilities).not.toContain("decision");
            expect(m.description).not.toMatch(/\bdecision model\b/i);
        }
        // codegemma:2b is the code-completion variant; it answers a greeting with a filename
        expect(catalog.models.find((m) => m.name === "codegemma")?.tags.map((t) => t.tag)).not.toContain("2b");
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

        // newest keeps the library's newest-first file order
        const newest = searchCatalog(catalog, { sort: "newest" });
        expect(newest.map((m) => m.name)).toEqual(catalog.models.map((m) => m.name));

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

/** n panels with ten actions each, every field as large as a panel could make it */
function bigRegistry(panels: number): RegistryAction[] {
    // one shared inputs object: the size is in what a panel declares, not in test memory
    const inputs = Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [
            `input${i}`.repeat(10),
            {
                type: "string",
                label: "L".repeat(500),
                description: "D".repeat(5000),
                required: i % 2 === 0,
                options: Array.from({ length: 50 }, (_, o) => ({ label: `${o}`, value: `value-${o}`.repeat(20) })),
            },
        ]),
    );
    const filler = "filler words ".repeat(400);
    const out: RegistryAction[] = [];
    for (let p = 0; p < panels; p++) {
        for (let a = 0; a < 10; a++) {
            out.push({
                panelId: `com.example.panel${p}`,
                action: `do-thing-${a}`,
                schema: {
                    name: `Thing ${a} of panel ${p}`,
                    description: `Does thing ${a}. ${filler}`,
                    inputs,
                },
            });
        }
    }
    return out;
}

describe("app actions: searched, never all listed", () => {
    const index = buildActionIndex(registry, "dev.paperboard.ai", { "dev.paperboard.gameserver": "Game Server" });

    it("indexes only callable actions of other panels, by their exact panelId:action id", () => {
        expect([...index.byId.keys()].sort()).toEqual([
            "com.other.gameserver:start-server",
            "dev.paperboard.gameserver:kick-player",
            "dev.paperboard.gameserver:start-server",
        ]);
    });

    it("finds the action a query describes, best match first", () => {
        expect(searchActions(index, "kick a player").matches[0]!.id).toBe("dev.paperboard.gameserver:kick-player");
        expect(searchActions(index, "minecraft").matches.map((m) => m.id)).toEqual(["dev.paperboard.gameserver:start-server"]);
        expect(searchActions(index, "start the minecraft server").matches.slice(0, 2).map((m) => m.id)).toEqual(["dev.paperboard.gameserver:start-server", "com.other.gameserver:start-server"]);
        expect(searchActions(index, "teleport").matches).toHaveLength(0);
        // the result names the exact id and the arguments a call needs
        const text = formatFoundActions(index, "kick");
        expect(text).toContain("id: dev.paperboard.gameserver:kick-player");
        expect(text).toContain("player (string, required)");
        expect(text).toContain('one of "soft", "hard"');
    });

    it("resolves a call only by an exact id, never a guessed one", () => {
        const { target, rawArguments } = resolveActionCall(index, { id: "dev.paperboard.gameserver:kick-player", arguments: { player: "Steve" } });
        expect(target).toMatchObject({ panelId: "dev.paperboard.gameserver", action: "kick-player" });
        expect(prepareArguments(target, rawArguments)).toEqual({ player: "Steve" });
        // arguments sent beside the id are read too
        expect(resolveActionCall(index, '{"id":"dev.paperboard.gameserver:kick-player","player":"Alex"}').rawArguments).toEqual({ player: "Alex" });
        expect(() => resolveActionCall(index, { id: "kick-player" })).toThrow(/no app action with the id "kick-player"/);
        expect(() => resolveActionCall(index, { id: "dev.paperboard.gameserver:get-state" })).toThrow(ToolArgumentError); // internal
        expect(() => resolveActionCall(index, { id: "dev.paperboard.ai:ask" })).toThrow(ToolArgumentError); // self
        expect(() => resolveActionCall(index, {})).toThrow(/missing required argument "id"/);
        expect(() => resolveActionCall(index, { id: "dev.paperboard.gameserver:kick-player", arguments: [1] })).toThrow(/JSON object/);
    });

    it("1000 panels: the offered tools stay fixed and a search stays under its cap", () => {
        const big = buildActionIndex(bigRegistry(1000), "dev.paperboard.ai");
        expect(big.entries).toHaveLength(10_000);
        // what the model is offered does not depend on the registry at all
        expect(JSON.stringify(APP_ACTION_TOOLS).length).toBeLessThan(1500);
        for (const query of ["thing 7 of panel 999", "filler", "", "nothing matches zzz"]) {
            const text = formatFoundActions(big, query);
            expect(text.length).toBeLessThanOrEqual(MAX_FIND_RESULT_CHARS);
            expect(MAX_FIND_RESULT_CHARS).toBeLessThan(MAX_TOOL_RESULT_CHARS); // never cut by the result cap
            expect(formatToolResult(text)).toBe(text);
        }
        expect(searchActions(big, "filler").matches).toHaveLength(MAX_FOUND_ACTIONS);
        expect(searchActions(big, "filler").total).toBe(10_000);
        expect(searchActions(big, "com.example.panel999:do-thing-7").matches[0]!.id).toBe("com.example.panel999:do-thing-7");
        expect(() => resolveActionCall(big, { id: "com.example.panel1000:do-thing-0" })).toThrow(/no app action/);
    });

    it("says how many actions it left out past the index cap", () => {
        const over = buildActionIndex(bigRegistry(MAX_INDEXED_ACTIONS / 10 + 1), "dev.paperboard.ai");
        expect(over.entries).toHaveLength(MAX_INDEXED_ACTIONS);
        expect(over.omitted).toBe(10);
        expect(formatFoundActions(over, "thing")).toContain("10 actions were not searched");
    });

    it("prepares arguments: coerces scalars, drops unknowns, refuses bad input", () => {
        const kick = index.byId.get("dev.paperboard.gameserver:kick-player")!;
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
    it("checks built-in arguments", () => {
        expect(builtinArguments("run_shell_command", '{"command":" ls "}')).toEqual({ command: "ls" });
        expect(builtinArguments("find_app_actions", { query: " kick " })).toEqual({ query: "kick" });
        expect(() => builtinArguments("find_app_actions", { query: "x".repeat(201) })).toThrow(BuiltinArgumentError);
        expect(() => builtinArguments("run_shell_command", {})).toThrow(BuiltinArgumentError);
        expect(() => builtinArguments("run_shell_command", { command: "x".repeat(MAX_COMMAND_CHARS + 1) })).toThrow(BuiltinArgumentError);
    });

    it("runs shell commands through the platform shell", () => {
        expect(shellArgv("ls | wc -l", "linux")).toEqual({ command: "/bin/sh", args: ["-c", "ls | wc -l"] });
        expect(shellArgv("dir", "win32")).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", "dir"] });
    });

    it("never offers the terminal panel's actions", () => {
        const index = buildActionIndex(
            [{ panelId: "dev.paperboard.terminal", action: "run", schema: { name: "Run" } }],
            "dev.paperboard.ai",
        );
        expect(index.entries).toHaveLength(0);
        expect(formatFoundActions(index, "run")).toBe("No other app offers actions right now.");
    });

    it("keeps every built-in personality compact even with all tools enabled", () => {
        for (const style of PROMPT_STYLES) {
            expect(systemPrompt({ style, model: "qwen3:8b", shellCommands: true, panelActions: true }).length).toBeLessThan(1300);
        }
    });

    it("tells the model only about the tools it has", () => {
        const none = systemPrompt({ style: "quirky", model: "qwen3:8b", shellCommands: false, panelActions: false });
        expect(none).not.toContain("Crane");
        expect(none).toContain("qwen3:8b");
        expect(none).not.toContain("run_shell_command");
        const shell = systemPrompt({ style: "no-nonsense", model: "qwen3:8b", shellCommands: true, panelActions: false });
        expect(shell).toContain("run_shell_command");
        expect(shell).not.toContain("web_search");
    });
});
