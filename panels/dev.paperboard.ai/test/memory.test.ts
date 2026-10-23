import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS } from "../src/contract";
import { Memory, MemoryError, type MemoryChange } from "../src/service/memory";
import { toolbox } from "../src/service/toolsets";

describe("the agent's memory", () => {
    let root = "";
    afterEach(() => {
        if (root) fs.rmSync(root, { recursive: true, force: true });
        root = "";
    });
    function make() {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-"));
        const dir = path.join(root, "memory");
        const changes: MemoryChange[] = [];
        return { dir, changes, memory: new Memory({ dir, onChange: (c) => changes.push(c) }) };
    }

    test("facts and notes round-trip through a fresh instance on the same folder", async () => {
        const { memory, dir } = make();
        const fact = await memory.addFact("  Likes tea  ");
        await memory.saveNote("wifi-setup", "when the user asks about the router", "# Router\n\nlong text");
        const again = new Memory({ dir, onChange: () => {} });
        expect(await again.list()).toEqual({ facts: [{ id: fact.id, text: "Likes tea" }], notes: [{ key: "wifi-setup", when: "when the user asks about the router" }] });
        expect((await again.readNote("wifi-setup")).body).toBe("# Router\n\nlong text");
        // the body is its own file; the index holds only key and when
        expect(fs.readFileSync(path.join(dir, "index.json"), "utf8")).not.toContain("long text");
    });

    test("edit, replace and delete", async () => {
        const { memory } = make();
        const f = await memory.addFact("a");
        expect((await memory.addFact("a")).id).toBe(f.id); // the same fact twice is one fact
        await memory.editFact(f.id, "b");
        await memory.saveNote("n", "w1", "one");
        await memory.saveNote("n", "w2", "two");
        expect(await memory.list()).toEqual({ facts: [{ id: f.id, text: "b" }], notes: [{ key: "n", when: "w2" }] });
        expect((await memory.readNote("n")).body).toBe("two");
        await memory.deleteFact(f.id);
        await memory.deleteNote("n");
        expect(await memory.list()).toEqual({ facts: [], notes: [] });
        await expect(memory.readNote("n")).rejects.toThrow("no note");
        await expect(memory.deleteFact(f.id)).rejects.toThrow("no fact");
    });

    test("limits are enforced by the store", async () => {
        const { memory } = make();
        const L = LIMITS.memory;
        await expect(memory.addFact("x".repeat(L.factChars + 1))).rejects.toThrow(MemoryError);
        await expect(memory.addFact("two\nlines")).rejects.toThrow("one line");
        await expect(memory.addFact("  ")).rejects.toThrow();
        await expect(memory.saveNote("Bad Key", "w", "b")).rejects.toThrow("key");
        await expect(memory.saveNote("../escape", "w", "b")).rejects.toThrow("key");
        await expect(memory.saveNote("k".repeat(L.keyChars + 1), "w", "b")).rejects.toThrow("key");
        await expect(memory.saveNote("k", "w".repeat(L.whenChars + 1), "b")).rejects.toThrow("characters");
        await expect(memory.saveNote("k", "w", "b".repeat(L.bodyBytes + 1))).rejects.toThrow("KiB");
        await expect(memory.saveNote("k", "w", " ")).rejects.toThrow("body");
        expect(await memory.list()).toEqual({ facts: [], notes: [] });
        for (let i = 0; i < L.facts; i++) await memory.addFact(`fact ${i}`);
        await expect(memory.addFact("one too many")).rejects.toThrow(`${L.facts} facts`);
    }, 20_000);

    test("the note count is capped, but replacing a note at the cap is fine", async () => {
        const { memory } = make();
        for (let i = 0; i < LIMITS.memory.notes; i++) await memory.saveNote(`n${i}`, "w", "b");
        await expect(memory.saveNote("extra", "w", "b")).rejects.toThrow("notes already");
        await memory.saveNote("n0", "changed", "b");
        expect((await memory.list()).notes[0]!.when).toBe("changed");
    }, 30_000);

    test("an unreadable index is an error everywhere and is never overwritten", async () => {
        const { memory, dir, changes } = make();
        fs.mkdirSync(dir, { recursive: true });
        const index = path.join(dir, "index.json");
        fs.writeFileSync(index, "{ not json");
        await expect(memory.list()).rejects.toThrow("unreadable");
        await expect(memory.addFact("x")).rejects.toThrow("unreadable");
        await expect(memory.saveNote("k", "w", "b")).rejects.toThrow("unreadable");
        expect(fs.readFileSync(index, "utf8")).toBe("{ not json");
        expect(fs.existsSync(path.join(dir, "notes", "k.md"))).toBe(false);
        expect(changes.at(-1)!.error).toContain("unreadable");
        // the agent is told, not given an empty memory
        expect(await memory.instructions()).toContain("unavailable");
        // a well-formed document of another shape is unreadable too
        fs.writeFileSync(index, JSON.stringify({ version: 1, facts: [{ id: 1 }], notes: [] }));
        await expect(memory.list()).rejects.toThrow("malformed");
        // once the user repairs it, memory works and the error clears
        fs.writeFileSync(index, JSON.stringify({ version: 1, facts: [], notes: [] }));
        await memory.addFact("back");
        expect(changes.at(-1)!.error).toBeNull();
    });

    test("concurrent changes are all kept", async () => {
        const { memory } = make();
        await Promise.all(Array.from({ length: 20 }, (_, i) => memory.addFact(`fact ${i}`)));
        expect((await memory.list()).facts.length).toBe(20);
    });

    test("the revision counts changes, not reads", async () => {
        const { memory, changes } = make();
        await memory.list();
        await memory.addFact("a");
        await memory.list();
        expect(changes.map((c) => c.revision)).toEqual([0, 1, 1]);
    });

    test("tools through the Toolbox, refusals as tool errors", async () => {
        const { memory } = make();
        const box = toolbox([memory.toolset()]);
        expect((await box.list()).map((t) => t.name)).toEqual(["remember", "forget", "save_note", "read_note"]);
        const said = await box.call("remember", { fact: "Name is Sam" });
        const id = /\((f-[0-9a-f]+)\)/.exec(said.text)![1]!;
        await box.call("save_note", { key: "recipe", when: "cooking questions", body: "boil water" });
        expect((await box.call("read_note", { key: "recipe" })).text).toBe("boil water");
        expect(await box.call("read_note", { key: "nope" })).toMatchObject({ isError: true });
        expect(await box.call("remember", { fact: "x".repeat(500) })).toMatchObject({ isError: true });
        expect(await box.call("forget", {})).toMatchObject({ isError: true });
        await box.call("forget", { fact: id });
        await box.call("forget", { note: "recipe" });
        expect(await memory.list()).toEqual({ facts: [], notes: [] });
    });

    test("the instructions carry every fact and each note's key and when, never a body", async () => {
        const { memory } = make();
        expect(await memory.instructions()).toContain("(nothing yet)");
        const f = await memory.addFact("Lives in Oslo");
        await memory.saveNote("taxes", "when doing the user's taxes", "SECRET-BODY-TEXT");
        const text = (await toolbox([memory.toolset()]).instructions())[0]!;
        expect(text).toContain(`[${f.id}] Lives in Oslo`);
        expect(text).toContain("- taxes: when doing the user's taxes");
        expect(text).not.toContain("SECRET-BODY-TEXT");
        expect(text).toContain("secrets");
    });
});
