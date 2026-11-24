// The service's runtime: what starts a flow, what it listens to, how many
// runs a project may have, and what stops them. It runs over the real
// project store and the page's own calls; the registry it runs through is
// one in memory that a test fires events on, and its own Projects blocks
// register in PaperAPI's in-memory registry.
import { describe, expect, test } from "bun:test";
import { memoryBlocks, type BlockSchema } from "@mileniumhq/paperapi";
import { createRuntime, type RuntimeDeps } from "../src/runtime";
import { FLOW_FAILED_EVENT } from "../src/blocks";
import { BUILTIN, registryBlockType } from "../src/lib/names";
import { PANEL_ID, blocksContract, type PanelState, type SavedFlows } from "../src/panel";
import type { ProjectStorage } from "../src/lib/projects";
import type { SavedBlock } from "../src/lib/interpreter";

const GAME = "dev.test.game";
const JOINED = registryBlockType({ kind: "event", panelId: GAME, entry: "event.joined" });
const JOINED_SCHEMA = {
    kind: "event",
    id: "joined",
    name: "Player Joined",
    inputs: { player: { type: "text", name: "Player", optional: true } },
    filters: { player: "player" },
    values: { player: { type: "text", name: "Player" } },
} as unknown as BlockSchema;
const WAIT = registryBlockType({ kind: "command", panelId: GAME, entry: "command.wait" });
const FLOW_FAILED = registryBlockType({ kind: "event", panelId: PANEL_ID, entry: `event.${FLOW_FAILED_EVENT}` });

/** A block as the tests write it: ids are given to it (and what it holds) once a flow is saved. */
type Draft = Omit<SavedBlock, "id" | "inputs"> & { inputs?: Record<string, { block?: Draft; shadow?: Draft }> };
const identified = (draft: Draft, id: string): SavedBlock => {
    const { inputs, ...rest } = draft;
    if (!inputs) return { ...rest, id };
    const held = (name: string, input: { block?: Draft; shadow?: Draft }) => ({
        ...(input.block && { block: identified(input.block, `${id}.${name}`) }),
        ...(input.shadow && { shadow: identified(input.shadow, `${id}.${name}.shadow`) }),
    });
    return { ...rest, id, inputs: Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, held(name, input)])) };
};

const text = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });
const say = (t: string): Draft => ({ type: BUILTIN.log, inputs: { TEXT: text(t) } });
const flows = (...hats: Draft[]): SavedFlows => ({
    workspace: { blocks: { languageVersion: 0, blocks: hats.map((hat, i) => ({ x: 0, y: i * 100, ...identified(hat, `hat${i}`) })) } },
    schemas: { [JOINED]: { panelId: GAME, entry: "event.joined", schema: JOINED_SCHEMA } },
});
const joined = (player: string, then: Draft): Draft => ({ type: JOINED, inputs: { player: text(player), DO: { block: then } } });
const onRun = (then: Draft): Draft => ({ type: BUILTIN.onRun, inputs: { DO: { block: then } } });

/** Lets the runtime's promises run; it answers nothing from a timer. */
async function until(what: string, holds: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (holds()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`never happened: ${what}`);
}

function setup(options: { storage?: ProjectStorage } = {}) {
    const files = new Map<string, unknown>();
    const storage: ProjectStorage = options.storage ?? {
        get: async (path) => structuredClone(files.get(path ?? "") ?? null),
        set: async (value, path) => void files.set(path ?? "", structuredClone(value)),
    };
    // who listens to what, by "panel entry", and the commands a flow runs
    const listeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
    const listen = (key: string, callback: (payload: Record<string, unknown>) => void) => {
        const set = listeners.get(key) ?? new Set();
        listeners.set(key, set.add(callback));
        return () => void set.delete(callback);
    };
    const blocks: RuntimeDeps["blocks"] = {
        onEvent: (panelId, event, callback, project) => listen(`${panelId} ${project ?? ""}/event.${event}`, callback),
        onChange: (panelId, value, callback, project) => listen(`${panelId} ${project ?? ""}/value.${value}`, () => callback()),
        run: (async (_panelId: string, command: string) => {
            if (command !== "wait") throw new Error(`the test has no command "${command}"`);
            return new Promise<unknown>(() => {});
        }) as RuntimeDeps["blocks"]["run"],
        read: (async () => {
            throw new Error("the test reads nothing");
        }) as RuntimeDeps["blocks"]["read"],
        property: (async () => {
            throw new Error("the test reads no fields");
        }) as RuntimeDeps["blocks"]["property"],
    };
    const fired: { event: string; payload: Record<string, unknown> }[] = [];
    const registry = memoryBlocks(PANEL_ID, { fired: (event, payload) => fired.push({ event, payload }) });
    const runtime = createRuntime({ storage, blocks, handle: registry.panel });
    let state: PanelState = structuredClone(blocksContract.state.initial);
    const ready = runtime.init((patch) => {
        state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    });
    const call = runtime.calls;
    const make = async (name: string, saved: SavedFlows) => {
        const made = await call.createProject({ name });
        await call.saveFlows({ project: made.id, flows: saved, preview: null });
        return made.id;
    };
    const subscribers = (key: string) => listeners.get(key)?.size ?? 0;
    const fire = (key: string, payload: Record<string, unknown>) => {
        for (const listener of listeners.get(key) ?? []) listener(payload);
    };
    const said = (project: string) => state.log.filter((l) => l.project === project).map((l) => `${l.level}: ${l.message}`);
    return { ready, call, make, subscribers, fire, said, fired, registry, files, runtime, state: () => state };
}

const JOINED_KEY = `${GAME} /event.joined`;

describe("the service's runtime", () => {
    test("an event starts the switched-on flows whose filter holds, and an empty filter takes any", async () => {
        const s = setup();
        await s.ready;
        const alice = await s.make("Alice only", flows(joined("alice", say("hello alice"))));
        const anyone = await s.make("Anyone", flows(joined("", say("hello anyone"))));
        s.fire(JOINED_KEY, { player: "bob" });
        await until("the flow for anyone to run", () => s.said(anyone).length === 1);
        expect(s.said(alice)).toEqual([]);
        s.fire(JOINED_KEY, { player: "alice" });
        await until("both flows to run", () => s.said(alice).length === 1 && s.said(anyone).length === 2);
        expect(s.said(alice)).toEqual(["info: hello alice"]);
    });

    test("listens only while a project that starts from the event is switched on", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Greeter", flows(joined("", say("hi"))));
        expect(s.subscribers(JOINED_KEY)).toBe(1);
        await s.call.updateProject({ project: id, enabled: false });
        expect(s.subscribers(JOINED_KEY)).toBe(0);
        s.fire(JOINED_KEY, { player: "bob" });
        await s.call.updateProject({ project: id, enabled: true });
        expect(s.subscribers(JOINED_KEY)).toBe(1);
        // the flow didn't hear the event fired while it was off
        expect(s.said(id)).toEqual([]);
    });

    test("deleting a project stops its runs", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Doomed", flows(onRun({ type: WAIT })));
        await s.call.runFlows({ project: id });
        await until("the run to start", () => s.state().running[id] === 1);
        expect(await s.call.deleteProject({ project: id })).toEqual({ deleted: true });
        await until("the run to end", () => !s.state().running[id]);
        expect(s.said(id)).toEqual(["info: The run was stopped"]);
    });

    test('a failed flow fires "When a Flow Fails", but one that flow starts does not fire it again', async () => {
        const s = setup();
        await s.ready;
        const broken = await s.make("Broken", flows(onRun({ type: "pb_no_such_block" })));
        await s.call.runFlows({ project: broken });
        await until("the failure to fire", () => s.fired.length === 1);
        expect(s.fired[0]).toMatchObject({ event: FLOW_FAILED_EVENT, payload: { project: broken } });

        // a When a Flow Fails flow that fails itself
        const watcher = await s.make("Watcher", flows({ type: FLOW_FAILED, inputs: { DO: { block: { type: "pb_no_such_block" } } } }));
        s.fire(`${PANEL_ID} /event.${FLOW_FAILED_EVENT}`, { project: broken, error: "boom" });
        await until("the watcher to fail", () => s.said(watcher).length === 1);
        await until("everything to end", () => Object.keys(s.state().running).length === 0);
        expect(s.fired).toHaveLength(1);
    });

    test("refuses every call while the projects can't be read", async () => {
        const s = setup({
            storage: {
                get: async () => {
                    throw new Error("the disk is gone");
                },
                set: async () => {
                    throw new Error("nothing may be written");
                },
            },
        });
        await s.ready;
        expect(s.state().projectsError).toBe("the disk is gone");
        await expect(s.call.createProject({ name: "x" })).rejects.toThrow("The projects couldn't be read: the disk is gone");
        await expect(s.call.loadFlows({ project: "p-x" })).rejects.toThrow("The projects couldn't be read");
    });
});

describe("backups", () => {
    test("hold changes back while the files are copied, then go on", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Mine", flows(onRun(say("one"))));
        expect(await s.runtime.backup.beforeBackup(null)).toEqual({ paths: [""] });
        let written = false;
        const saving = s.call.saveFlows({ project: id, flows: flows(onRun(say("two"))), preview: null }).then(() => (written = true));
        await new Promise((resolve) => setImmediate(resolve));
        expect(written).toBe(false);
        await s.runtime.backup.resume();
        await saving;
        expect(written).toBe(true);
    });

    test("a restore reads the projects the backup's files hold and stops the runs", async () => {
        const s = setup();
        await s.ready;
        const kept = await s.make("Kept", flows(onRun({ type: WAIT })));
        await s.call.runFlows({ project: kept });
        await until("the run to start", () => s.state().running[kept] === 1);
        const index = structuredClone(s.files.get("projects.json")) as { projects: { id: string }[] };
        await s.runtime.backup.beforeRestore(null);
        // the files the daemon swaps in: a project the backup never had, and one only it has
        s.files.set("projects.json", { version: 1, projects: [{ id: "p-old", name: "Old", enabled: true, createdAt: 1, editedAt: 1 }] });
        s.files.set("projects/p-old.json", flows(onRun(say("old"))));
        await s.runtime.backup.restored();
        expect(index.projects.map((p) => p.id)).toEqual([kept]);
        expect(s.state().projects.map((p) => p.name)).toEqual(["Old"]);
        await until("the run to stop", () => !s.state().running[kept]);
        await expect(s.call.loadFlows({ project: kept })).rejects.toThrow("no project");
        expect(s.said("p-old")).toEqual([]);
    });

    test("a restore that fails keeps the changes held until the files are back, then they land", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Mine", flows(onRun(say("one"))));
        const original = structuredClone(s.files.get("projects.json"));
        await s.runtime.backup.beforeRestore(null);
        let renamed = false;
        const renaming = s.call.updateProject({ project: id, name: "Renamed" }).then(() => (renamed = true));
        s.files.set("projects.json", { projects: "damaged" });
        await expect(s.runtime.backup.restored()).rejects.toThrow("damaged");
        await new Promise((resolve) => setImmediate(resolve));
        // the held change has not run against the damaged files
        expect(renamed).toBe(false);
        expect(s.runtime.backup.paused()).toBe(true);
        // the daemon puts the files back and says so
        s.files.set("projects.json", original);
        await s.runtime.backup.resume();
        await renaming;
        expect(s.state().projects.map((p) => p.name)).toEqual(["Renamed"]);
        expect((s.files.get("projects.json") as { projects: { name: string }[] }).projects[0].name).toBe("Renamed");
        expect((await s.call.loadFlows({ project: id })).workspace.blocks?.blocks).toHaveLength(1);
    });

    test("a target is refused, as Blocks backs up as a whole", async () => {
        const s = setup();
        await s.ready;
        await expect(s.runtime.backup.beforeBackup("x")).rejects.toThrow("no \"x\" to back up");
    });
});

// the panel's own blocks, as another project's flow runs them
describe("the Projects blocks", () => {
    test("list the kept projects but not a draft", async () => {
        const s = setup();
        await s.ready;
        const kept = await s.make("Server tools", flows(onRun(say("hi"))));
        await s.call.createProject({});
        expect(await s.registry.read("projects")).toEqual([kept]);
        expect(await s.registry.property("project", "name", kept)).toBe("Server tools");
        expect(await s.registry.property("project", "flows", kept)).toBe(1);
        expect(s.registry.list().map((b) => b.entry).sort()).toEqual(
            ["command.run-project", "command.stop-project", "command.turn-off-project", "command.turn-on-project", "event.flow-failed", "type.project", "value.projects"].sort(),
        );
    });

    test("turn a project off and on, as its switch does, and every window hears it", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Mine", flows(onRun(say("hi"))));
        await s.registry.run("turn-off-project", { project: id });
        expect(s.state().projects.find((p) => p.id === id)!.enabled).toBe(false);
        expect(await s.registry.property("project", "on", id)).toBe(false);
        await s.registry.run("turn-on-project", { project: id });
        expect(s.state().projects.find((p) => p.id === id)!.enabled).toBe(true);
    });

    test("run and stop a project, and say how many", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Mine", flows(onRun({ type: WAIT })));
        expect(await s.registry.run("run-project", { project: id })).toBe(1);
        expect(await s.registry.property("project", "running", id)).toBe(true);
        expect(await s.registry.run("stop-project", { project: id })).toBe(1);
        await until("the run to end", () => !s.state().running[id]);
        expect(await s.registry.property("project", "running", id)).toBe(false);
    });

    test("a project that doesn't exist fails the block and says so", async () => {
        const s = setup();
        await s.ready;
        await expect(s.registry.run("run-project", { project: "p-gone" })).rejects.toThrow("no project");
        await expect(s.registry.property("project", "name", "p-gone")).rejects.toThrow("no project");
    });
});
