// The service's runtime: what starts a flow, what it listens to, how many
// runs a project may have, and what stops them. It runs over the real
// project store and the page's own calls; the registry it runs through is
// one in memory that a test fires events on, and its own Projects blocks
// register in PaperAPI's in-memory registry.
import { describe, expect, test } from "bun:test";
import { memoryBlocks, type BlocksHandle, type BlockSchema } from "@mileniumhq/paperapi";
import { createRuntime, MAX_RUNS_PER_PROJECT, type RuntimeDeps } from "../src/runtime";
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

const text = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });
const say = (t: string): SavedBlock => ({ type: BUILTIN.log, inputs: { TEXT: text(t) } });
const flows = (...hats: SavedBlock[]): SavedFlows => ({
    workspace: { blocks: { languageVersion: 0, blocks: hats.map((hat, i) => ({ id: `hat${i}`, x: 0, y: i * 100, ...hat })) } },
    schemas: { [JOINED]: { panelId: GAME, entry: "event.joined", schema: JOINED_SCHEMA } },
});
const joined = (player: string, then: SavedBlock): SavedBlock => ({ type: JOINED, inputs: { player: text(player), DO: { block: then } } });
const onRun = (then: SavedBlock): SavedBlock => ({ type: BUILTIN.onRun, inputs: { DO: { block: then } } });

/** Lets the runtime's promises run; it answers nothing from a timer. */
async function until(what: string, holds: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (holds()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`never happened: ${what}`);
}

function setup(options: { storage?: ProjectStorage; handle?: (handle: BlocksHandle) => BlocksHandle } = {}) {
    const files = new Map<string, unknown>();
    const storage: ProjectStorage = options.storage ?? {
        get: async (path) => structuredClone(files.get(path ?? "") ?? null),
        set: async (value, path) => void files.set(path ?? "", structuredClone(value)),
    };
    // who listens to what, by "panel entry", and the commands a flow runs
    const listeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
    const waiting: { resolve: (v: unknown) => void }[] = [];
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
            return new Promise((resolve) => waiting.push({ resolve }));
        }) as RuntimeDeps["blocks"]["run"],
        read: (async () => {
            throw new Error("the test reads nothing");
        }) as RuntimeDeps["blocks"]["read"],
        property: (async () => {
            throw new Error("the test reads no fields");
        }) as RuntimeDeps["blocks"]["property"],
    };
    const fired: { event: string; payload: Record<string, unknown> }[] = [];
    const changed: string[] = [];
    const registry = memoryBlocks(PANEL_ID, { fired: (event, payload) => fired.push({ event, payload }), changed: (value) => changed.push(value) });
    const runtime = createRuntime({ storage, blocks, handle: options.handle ? options.handle(registry.panel) : registry.panel });
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
    return { ready, call, make, subscribers, fire, said, fired, changed, registry, waiting, state: () => state };
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

    test(`a project runs at most ${MAX_RUNS_PER_PROJECT} flows at once, and Stop ends them`, async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Runaway", flows(onRun({ type: WAIT })));
        for (let i = 0; i <= MAX_RUNS_PER_PROJECT; i++) await s.call.runFlows({ project: id });
        await until("the runs to start", () => s.waiting.length === MAX_RUNS_PER_PROJECT);
        expect(s.state().running[id]).toBe(MAX_RUNS_PER_PROJECT);
        expect(s.said(id)).toEqual([`error: A flow didn't start: ${MAX_RUNS_PER_PROJECT} of this project's flows are already running. Stop them, or check for a flow that starts itself.`]);
        expect(await s.call.stopFlows({ project: id })).toBe(MAX_RUNS_PER_PROJECT);
        await until("the runs to end", () => !s.state().running[id]);
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

    test("a failure that doesn't reach the registry is said in the run log", async () => {
        const s = setup({
            handle: (handle) => ({
                ...handle,
                fire: async () => {
                    throw new Error("the registry is away");
                },
            }),
        });
        await s.ready;
        const broken = await s.make("Broken", flows(onRun({ type: "pb_no_such_block" })));
        await s.call.runFlows({ project: broken });
        await until("the failure to be said", () => s.said(broken).length === 2);
        expect(s.said(broken)[1]).toBe('error: "When a Flow Fails" didn\'t hear this failure: the registry is away');
    });

    test("a change to the project list that doesn't reach the registry is shown, and told again once it is back", async () => {
        let away = true;
        const s = setup({
            handle: (handle) => ({
                ...handle,
                changed: async (value) => {
                    if (away) throw new Error("the registry is away");
                    return handle.changed(value);
                },
            }),
        });
        await s.ready;
        const id = await s.make("New", flows(onRun(say("hi"))));
        await until("the failure to show", () => s.state().blocksError !== null);
        expect(s.state().blocksError).toBe("The other panels weren't told the projects changed: the registry is away");
        expect(s.changed).toEqual([]);

        // the same project list again: the registry never heard it, so it is told now, and the banner goes
        away = false;
        await s.call.updateProject({ project: id, name: "Renamed" });
        await until("the list to be told", () => s.changed.length === 1);
        expect(s.changed).toEqual(["projects"]);
        await until("the banner to clear", () => s.state().blocksError === null);
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

    test("say the list changed only when its projects did", async () => {
        const s = setup();
        await s.ready;
        const id = await s.make("Mine", flows(onRun(say("hi"))));
        expect(s.changed).toEqual(["projects"]);
        await s.call.updateProject({ project: id, name: "Renamed" });
        expect(s.changed).toEqual(["projects"]);
    });
});
