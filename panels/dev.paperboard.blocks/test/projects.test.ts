// The project store: where every project's flows are kept, how the one
// canvas from before projects becomes a project, and that nothing a person
// made is lost or half-written. The storage is an in-memory map with the
// same contract as the panel's config (JSON by path; no path is the config
// document), so these run the real store with no daemon.
import { describe, expect, test } from "bun:test";
import { MIGRATED_PROJECT_NAME, PROJECTS_FILE, PROJECTS_VERSION, ProjectStore, projectFlowsPath, type ProjectStorage } from "../src/lib/projects";
import type { SavedFlows } from "../src/panel";
import { BUILTIN } from "../src/lib/names";

const ROOT = "<config>";

function memory(initial: Record<string, unknown> = {}) {
    const files = new Map<string, unknown>(Object.entries(initial));
    const writes: string[] = [];
    let failing: string | null = null;
    const storage: ProjectStorage = {
        get: async (path) => structuredClone(files.get(path ?? ROOT) ?? null),
        set: async (value, path) => {
            if (failing && (path ?? ROOT) === failing) throw new Error("the disk is full");
            writes.push(path ?? ROOT);
            files.set(path ?? ROOT, structuredClone(value));
        },
    };
    return { storage, files, writes, failOn: (path: string | null) => (failing = path) };
}

const flows = (...types: string[]): SavedFlows => ({
    workspace: { blocks: { languageVersion: 0, blocks: types.map((type, i) => ({ type, id: `b${i}`, x: 0, y: i * 100 })) } },
    schemas: {},
});

const index = (files: Map<string, unknown>) => files.get(PROJECTS_FILE) as { version: number; projects: { id: string; name: string; enabled: boolean }[] };

describe("the canvas from before projects", () => {
    test('becomes "My flows", and the config document stays as it was', async () => {
        const legacy = flows(BUILTIN.onRun, "text");
        const mem = memory({ [ROOT]: legacy });
        const store = new ProjectStore(mem.storage);
        await store.open();

        const [project] = store.list();
        expect(store.list()).toHaveLength(1);
        expect(project!.name).toBe(MIGRATED_PROJECT_NAME);
        expect(project!.flowCount).toBe(1);
        expect(store.flows(project!.id)).toEqual(legacy);
        expect(mem.files.get(projectFlowsPath(project!.id))).toEqual(legacy);
        expect(mem.files.get(ROOT)).toEqual(legacy);
        expect(mem.writes).not.toContain(ROOT);
        expect(index(mem.files).projects.map((p) => p.id)).toEqual([project!.id]);
    });

    test("moves once: the next open reads the projects, not the old canvas again", async () => {
        const mem = memory({ [ROOT]: flows(BUILTIN.onRun) });
        const first = new ProjectStore(mem.storage);
        await first.open();
        const second = new ProjectStore(mem.storage);
        await second.open();
        expect(second.list().map((p) => p.id)).toEqual(first.list().map((p) => p.id));
    });

    test("an empty one makes no project", async () => {
        for (const legacy of [null, {}, flows()]) {
            const mem = memory({ [ROOT]: legacy });
            const store = new ProjectStore(mem.storage);
            await store.open();
            expect(store.list()).toEqual([]);
            expect(index(mem.files)).toEqual({ version: PROJECTS_VERSION, projects: [] });
        }
    });

    test("an unreadable one stops Blocks and is left untouched", async () => {
        const mem = memory({ [ROOT]: { workspace: "broken" } });
        await expect(new ProjectStore(mem.storage).open()).rejects.toThrow("no workspace");
        expect(mem.writes).toEqual([]);
        expect(mem.files.get(ROOT)).toEqual({ workspace: "broken" });
    });
});

describe("the project list", () => {
    test("a damaged one, or one from a newer Blocks, is refused and never overwritten", async () => {
        for (const saved of [{ projects: "no" }, { version: PROJECTS_VERSION + 1, projects: [] }, { projects: [{ id: "../x", name: "Bad" }] }]) {
            const mem = memory({ [PROJECTS_FILE]: saved });
            await expect(new ProjectStore(mem.storage).open()).rejects.toThrow();
            expect(mem.writes).toEqual([]);
        }
    });

    test("a project that can't be read says why and keeps its file; the others still open", async () => {
        const mem = memory({
            [PROJECTS_FILE]: { version: 1, projects: [{ id: "p-good", name: "Good" }, { id: "p-bad", name: "Bad" }] },
            [projectFlowsPath("p-good")]: flows(BUILTIN.onRun),
            [projectFlowsPath("p-bad")]: { workspace: {}, schemas: "broken" },
        });
        const store = new ProjectStore(mem.storage);
        await store.open();
        expect(store.summaryOf("p-bad").loadError).toContain("no block schemas");
        expect(() => store.flows("p-bad")).toThrow("couldn't be read");
        expect(store.running().map((p) => p.id)).toEqual(["p-good"]);
        expect(mem.writes).toEqual([]);
    });
});

describe("a new project", () => {
    test("is a draft, written only once it has a block", async () => {
        const mem = memory();
        const store = new ProjectStore(mem.storage);
        await store.open();
        const made = await store.create();
        expect(made.draft).toBe(true);
        expect(index(mem.files).projects).toEqual([]);
        expect(mem.files.has(projectFlowsPath(made.id))).toBe(false);

        await store.save(made.id, flows(), null);
        expect(mem.files.has(projectFlowsPath(made.id))).toBe(false);

        const kept = await store.save(made.id, flows(BUILTIN.onRun), null);
        expect(kept.draft).toBe(false);
        expect(mem.files.get(projectFlowsPath(made.id))).toEqual(flows(BUILTIN.onRun));
        expect(index(mem.files).projects.map((p) => p.id)).toEqual([made.id]);
    });

    test("left empty is discarded; one kept by now is not", async () => {
        const mem = memory();
        const store = new ProjectStore(mem.storage);
        await store.open();
        const empty = await store.create();
        expect(await store.remove(empty.id, true)).toBe(true);
        expect(store.list()).toEqual([]);

        const kept = await store.create();
        await store.save(kept.id, flows(BUILTIN.onRun), null);
        expect(await store.remove(kept.id, true)).toBe(false);
        expect(store.list().map((p) => p.id)).toEqual([kept.id]);
    });

    test("takes the next free name", async () => {
        const store = new ProjectStore(memory().storage);
        await store.open();
        const a = await store.create();
        const b = await store.create();
        expect([a.name, b.name]).toEqual(["Untitled project", "Untitled project 2"]);
    });
});

describe("changing a project", () => {
    test("a save that can't write the list is taken back, and says why", async () => {
        const mem = memory();
        const store = new ProjectStore(mem.storage);
        await store.open();
        const made = await store.create("Mine");
        await store.save(made.id, flows(BUILTIN.onRun), null);
        mem.failOn(PROJECTS_FILE);
        await expect(store.update(made.id, { name: "Renamed" })).rejects.toThrow("the disk is full");
        expect(store.summaryOf(made.id).name).toBe("Mine");
        expect(index(mem.files).projects[0]!.name).toBe("Mine");
    });

    test("a copy has the same flows under its own file", async () => {
        const mem = memory();
        const store = new ProjectStore(mem.storage);
        await store.open();
        const made = await store.create("Mine");
        await store.save(made.id, flows(BUILTIN.onRun, "text"), null);
        const copy = await store.duplicate(made.id);
        expect(copy.name).toBe("Copy of Mine");
        expect(copy.draft).toBe(false);
        expect(mem.files.get(projectFlowsPath(copy.id))).toEqual(flows(BUILTIN.onRun, "text"));
    });

    test("switched off, its flows don't run; deleted, its file is emptied", async () => {
        const mem = memory();
        const store = new ProjectStore(mem.storage);
        await store.open();
        const made = await store.create("Mine");
        await store.save(made.id, flows(BUILTIN.onRun), null);
        await store.update(made.id, { enabled: false });
        expect(store.running()).toEqual([]);
        expect(index(mem.files).projects[0]!.enabled).toBe(false);

        await store.remove(made.id);
        expect(store.list()).toEqual([]);
        expect(index(mem.files).projects).toEqual([]);
        expect(mem.files.get(projectFlowsPath(made.id))).toBeNull();
    });

    test("names and ids are checked", async () => {
        const store = new ProjectStore(memory().storage);
        await store.open();
        await expect(store.create("   ")).rejects.toThrow("needs a name");
        await expect(store.create("x".repeat(129))).rejects.toThrow("at most 128");
        await expect(store.update("p-nope", { name: "X" })).rejects.toThrow("no project");
        expect(() => projectFlowsPath("../escape")).toThrow("not a project id");
    });
});
