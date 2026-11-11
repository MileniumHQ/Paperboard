// The Blocks panel's own blocks: what a flow sees of the projects and what
// it can do to them. They run through PaperAPI's in-memory registry (the
// daemon's checks, with JSON over the "wire") over the real project store.
import { describe, expect, test } from "bun:test";
import { memoryBlocks } from "@mileniumhq/paperapi";
import { BlocksAnnouncer, FLOW_FAILED_EVENT, blocksPanelBlocks } from "../src/blocks";
import { ProjectStore, type ProjectStorage } from "../src/lib/projects";
import { BUILTIN } from "../src/lib/names";
import { PANEL_ID, type SavedFlows } from "../src/panel";

const flows = (...types: string[]): SavedFlows => ({
    workspace: { blocks: { languageVersion: 0, blocks: types.map((type, i) => ({ type, id: `b${i}`, x: 0, y: i * 100 })) } },
    schemas: {},
});

async function setup() {
    const files = new Map<string, unknown>();
    const storage: ProjectStorage = {
        get: async (path) => structuredClone(files.get(path ?? "") ?? null),
        set: async (value, path) => void files.set(path ?? "", structuredClone(value)),
    };
    const store = new ProjectStore(storage);
    await store.open();
    const fired: { event: string; payload: Record<string, unknown> }[] = [];
    const changed: string[] = [];
    const registry = memoryBlocks(PANEL_ID, { fired: (event, payload) => fired.push({ event, payload }), changed: (value) => changed.push(value) });
    const runs: string[] = [];
    const kept = () => store.list().filter((p) => !p.draft).map((p) => p.id);
    const set = blocksPanelBlocks({
        projects: kept,
        project: (id) => store.summaryOf(id),
        runningCount: (id) => runs.filter((r) => r === id).length,
        setEnabled: async (id, enabled) => void (await store.update(id, { enabled })),
        run: (id) => {
            store.flows(id);
            runs.push(id);
            return 1;
        },
        stop: (id) => runs.splice(0).filter((r) => r === store.summaryOf(id).id).length,
    });
    const announcer = new BlocksAnnouncer(registry.panel);
    await announcer.register(set, kept());
    const make = async (name: string) => {
        const made = await store.create(name);
        await store.save(made.id, flows(BUILTIN.onRun), null);
        return made.id;
    };
    return { store, registry, announcer, fired, changed, runs, kept, make };
}

describe("the Projects blocks", () => {
    test("register, and list the kept projects but not a draft", async () => {
        const { store, registry, make } = await setup();
        const kept = await make("Server tools");
        await store.create();
        expect(await registry.read("projects")).toEqual([kept]);
        expect(await registry.property("project", "name", kept)).toBe("Server tools");
        expect(await registry.property("project", "flows", kept)).toBe(1);
        expect(registry.list().map((b) => b.entry).sort()).toEqual(
            ["command.run-project", "command.stop-project", "command.turn-off-project", "command.turn-on-project", "event.flow-failed", "type.project", "value.projects"].sort(),
        );
    });

    test("turn a project off and on, as its switch does", async () => {
        const { store, registry, make } = await setup();
        const id = await make("Mine");
        await registry.run("turn-off-project", { project: id });
        expect(store.summaryOf(id).enabled).toBe(false);
        expect(await registry.property("project", "on", id)).toBe(false);
        await registry.run("turn-on-project", { project: id });
        expect(store.running().map((p) => p.id)).toEqual([id]);
    });

    test("run and stop a project, and say how many", async () => {
        const { registry, make } = await setup();
        const id = await make("Mine");
        expect(await registry.run("run-project", { project: id })).toBe(1);
        expect(await registry.property("project", "running", id)).toBe(true);
        expect(await registry.run("stop-project", { project: id })).toBe(1);
        expect(await registry.property("project", "running", id)).toBe(false);
    });

    test("a project that doesn't exist fails the block and says so", async () => {
        const { registry } = await setup();
        await expect(registry.run("run-project", { project: "p-gone" })).rejects.toThrow("no project");
        await expect(registry.property("project", "name", "p-gone")).rejects.toThrow("no project");
    });

    test("say the list changed only when its projects did, and fire a failure with the project and error", async () => {
        const { announcer, changed, fired, kept, make } = await setup();
        const id = await make("Mine");
        announcer.projects(kept());
        announcer.projects(kept());
        expect(changed).toEqual(["projects"]);
        announcer.failed(id, "The Game Server panel isn't running");
        await Promise.resolve();
        expect(fired).toEqual([{ event: FLOW_FAILED_EVENT, payload: { project: id, error: "The Game Server panel isn't running" } }]);
    });
});
