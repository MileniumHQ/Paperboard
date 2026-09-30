import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConversationStore } from "../src/service/store";
import { ModelManager, MAX_CONCURRENT_PULLS, canonicalRef } from "../src/service/models";
import { OllamaClient } from "../src/service/ollamaClient";
import { startFakeOllama, type FakeOllama } from "./fakeOllama";
import type { Conversation, InstalledModel, PullProgress } from "../src/core/types";

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-store-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const conv = (id: string, updatedAt: number, extra: Partial<Conversation> = {}): Conversation => ({
    id,
    title: id,
    model: "m:latest",
    createdAt: updatedAt,
    updatedAt,
    messages: [],
    ...extra,
});

describe("conversation store", () => {
    it("saves atomically, lists newest first, and reads back", async () => {
        const store = new ConversationStore(dir);
        await store.load();
        await store.save(conv("aaaaaaaa-1", 1));
        const list = await store.save(conv("bbbbbbbb-2", 2));
        expect(list.map((s) => s.id)).toEqual(["bbbbbbbb-2", "aaaaaaaa-1"]);
        expect((await store.get("aaaaaaaa-1")).title).toBe("aaaaaaaa-1");
        const files = fs.readdirSync(path.join(dir, "conversations"));
        expect(files.some((f) => f.includes(".tmp-"))).toBe(false);
    });

    it("a corrupt index is rebuilt from the conversation files, not treated as empty", async () => {
        const store = new ConversationStore(dir);
        await store.load();
        await store.save(conv("aaaaaaaa-1", 1));
        await store.save(conv("bbbbbbbb-2", 2));
        fs.writeFileSync(path.join(dir, "conversations", "index.json"), "{ not json");
        const reloaded = await new ConversationStore(dir).load();
        expect(reloaded.summaries.map((s) => s.id).sort()).toEqual(["aaaaaaaa-1", "bbbbbbbb-2"]);
        expect(reloaded.unreadable).toEqual([]);
    });

    it("an unreadable conversation is reported and left on disk", async () => {
        fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
        fs.writeFileSync(path.join(dir, "conversations", "cccccccc-3.json"), "garbage");
        const result = await new ConversationStore(dir).load();
        expect(result.unreadable).toEqual(["cccccccc-3.json"]);
        expect(fs.existsSync(path.join(dir, "conversations", "cccccccc-3.json"))).toBe(true);
    });

    it("refuses ids that could leave the conversations folder", async () => {
        const store = new ConversationStore(dir);
        await store.load();
        await expect(store.get("../../etc/passwd")).rejects.toThrow(/invalid conversation id/);
        await expect(store.save(conv("../escape", 1))).rejects.toThrow(/invalid conversation id/);
    });

    it("a reply that was streaming when the service stopped reads back as stopped", async () => {
        const store = new ConversationStore(dir);
        await store.load();
        await store.save(
            conv("dddddddd-4", 1, {
                messages: [{ id: "a", role: "assistant", model: "m", content: "par", status: "streaming", createdAt: 1 }],
            }),
        );
        const m = (await store.get("dddddddd-4")).messages[0]!;
        expect(m.role === "assistant" && m.status).toBe("stopped");
    });

    it("delete removes the chat and its summary", async () => {
        const store = new ConversationStore(dir);
        await store.load();
        await store.save(conv("eeeeeeee-5", 1));
        expect(await store.delete("eeeeeeee-5")).toEqual([]);
        await expect(store.get("eeeeeeee-5")).rejects.toThrow();
    });

    it("delete all removes every chat, including files hidden from the index", async () => {
        const store = new ConversationStore(dir);
        await store.load();
        await store.save(conv("eeeeeeee-5", 1));
        await store.save(conv("ffffffff-6", 2));
        // a conversation that never parsed is on disk but not in the index
        fs.writeFileSync(path.join(dir, "conversations", "gggggggg-7.json"), "garbage");
        expect(await store.deleteAll()).toEqual([]);
        expect(fs.readdirSync(path.join(dir, "conversations"))).toEqual(["index.json"]);
        await expect(store.get("eeeeeeee-5")).rejects.toThrow();
        expect((await new ConversationStore(dir).load()).summaries).toEqual([]);
    });
});

describe("model manager", () => {
    let fake: FakeOllama;
    let models: InstalledModel[];
    let pulls: PullProgress[];
    let downloaded: string[];
    let manager: ModelManager;

    beforeEach(() => {
        fake = startFakeOllama();
        models = [];
        pulls = [];
        downloaded = [];
        manager = new ModelManager({
            clients: () => new Map([["ollama", new OllamaClient(fake.url)]]),
            onModels: (m) => (models = m),
            onPulls: (p) => (pulls = p),
            onDownloaded: (m) => downloaded.push(m),
        });
    });
    afterEach(() => fake.stop());

    it("lists installed models with capabilities and geometry from /api/show", async () => {
        await manager.refresh();
        expect(models).toEqual([
            {
                name: "tooly:latest",
                provider: "ollama",
                sizeBytes: 5e9,
                family: "fake",
                parameterSize: "8B",
                quantization: "Q4_K_M",
                capabilities: ["completion", "tools"],
                contextLength: 40960,
                modifiedAt: undefined,
                architecture: { layers: 32, kvHeads: 8, headDim: 128 },
            },
        ]);
        expect(manager.capabilities("tooly")).toEqual(["completion", "tools"]);
        expect(manager.architecture("tooly:latest")).toEqual({ layers: 32, kvHeads: 8, headDim: 128 });
    });

    it("downloads, refreshes the list, and fires once on success", async () => {
        await manager.pull("small");
        expect(fake.pulls).toEqual(["small:latest"]);
        expect(downloaded).toEqual(["small:latest"]);
        expect(models.map((m) => m.name)).toContain("small:latest");
        expect(pulls).toEqual([]);
    });

    it("a failed download rejects and never fires the trigger", async () => {
        await expect(manager.pull("broken:1b")).rejects.toThrow(/file does not exist/);
        expect(downloaded).toEqual([]);
        expect(pulls).toEqual([]);
    });

    it("bounds concurrent downloads and refuses duplicates", async () => {
        fake.holdPulls = true;
        const running = [manager.pull("one"), manager.pull("two")];
        await expect(manager.pull("one")).rejects.toThrow(/already downloading/);
        await expect(manager.pull("three")).rejects.toThrow(new RegExp(`Only ${MAX_CONCURRENT_PULLS}`));
        fake.releasePulls();
        await Promise.all(running);
    });

    it("cancel aborts the stream and reports cancellation, not success", async () => {
        fake.holdPulls = true;
        const pull = manager.pull("slow");
        while (pulls.length === 0) await new Promise((r) => setTimeout(r, 5));
        expect(manager.cancel("slow")).toBe(true);
        await expect(pull).rejects.toThrow(/cancelled/);
        expect(downloaded).toEqual([]);
        fake.releasePulls();
    });

    it("refuses references outside the Ollama library", async () => {
        await expect(manager.pull("hf.co/someone/model:Q4")).rejects.toThrow(/not a model name/);
        expect(canonicalRef("qwen3")).toBe("qwen3:latest");
    });

    it("deletes installed models only", async () => {
        await manager.refresh();
        await expect(manager.delete("ghost")).rejects.toThrow(/not installed/);
        await manager.delete("tooly");
        expect(models).toEqual([]);
    });
});
