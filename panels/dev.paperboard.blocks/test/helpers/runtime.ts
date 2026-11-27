// The service's runtime as the tests run it: over the real project store,
// with files in memory, a registry in memory that a test fires events on,
// PaperAPI's in-memory registry for its own Projects blocks, and a clock a
// test can turn. Two runtimes over the same files are the service before and
// after a restart.
import { memoryBlocks, type BlockSchema } from "@mileniumhq/paperapi";
import { createRuntime, type RuntimeDeps } from "../../src/runtime";
import { FLOW_FAILED_EVENT } from "../../src/blocks";
import { BUILTIN, registryBlockType } from "../../src/lib/names";
import { PANEL_ID, blocksContract, type PanelState, type SavedFlows } from "../../src/panel";
import type { ProjectStorage } from "../../src/lib/projects";
import type { SavedBlock } from "../../src/lib/interpreter";
import type { Clock } from "../../src/lib/scheduler";

export const GAME = "dev.test.game";
export const JOINED = registryBlockType({ kind: "event", panelId: GAME, entry: "event.joined" });
export const JOINED_SCHEMA = {
    kind: "event",
    id: "joined",
    name: "Player Joined",
    inputs: { player: { type: "text", name: "Player", optional: true } },
    filters: { player: "player" },
    values: { player: { type: "text", name: "Player" } },
} as unknown as BlockSchema;
export const WAIT = registryBlockType({ kind: "command", panelId: GAME, entry: "command.wait" });
export const FLOW_FAILED = registryBlockType({ kind: "event", panelId: PANEL_ID, entry: `event.${FLOW_FAILED_EVENT}` });

/** A block as the tests write it: ids are given to it (and what it holds, and what follows it) once a flow is saved. */
export type Draft = Omit<SavedBlock, "id" | "inputs" | "next"> & { inputs?: Record<string, { block?: Draft; shadow?: Draft }>; next?: { block: Draft } };
export const identified = (draft: Draft, id: string): SavedBlock => {
    const { inputs, next, ...rest } = draft;
    const held = (name: string, input: { block?: Draft; shadow?: Draft }) => ({
        ...(input.block && { block: identified(input.block, `${id}.${name}`) }),
        ...(input.shadow && { shadow: identified(input.shadow, `${id}.${name}.shadow`) }),
    });
    return {
        ...rest,
        id,
        ...(inputs && { inputs: Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, held(name, input)])) }),
        ...(next && { next: { block: identified(next.block, `${id}.next`) } }),
    };
};

export const text = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });
export const say = (t: string): Draft => ({ type: BUILTIN.log, inputs: { TEXT: text(t) } });
export const flows = (...hats: Draft[]): SavedFlows => ({
    workspace: { blocks: { languageVersion: 0, blocks: hats.map((hat, i) => ({ x: 0, y: i * 100, ...identified(hat, `hat${i}`) })) } },
    schemas: { [JOINED]: { panelId: GAME, entry: "event.joined", schema: JOINED_SCHEMA } },
});
export const joined = (player: string, then: Draft): Draft => ({ type: JOINED, inputs: { player: text(player), DO: { block: then } } });
export const onRun = (then: Draft): Draft => ({ type: BUILTIN.onRun, inputs: { DO: { block: then } } });

/** Lets the runtime's promises run; it answers nothing from a timer. */
export async function until(what: string, holds: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (holds()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`never happened: ${what}`);
}

export function setup(
    options: {
        storage?: ProjectStorage;
        files?: Map<string, unknown>;
        clock?: Clock;
        /** commands the flows can run beside "wait", which never ends: each call is kept in `ran` */
        commands?: Record<string, (inputs: Record<string, unknown>) => unknown>;
    } = {},
) {
    const ran: { panelId: string; command: string; inputs: Record<string, unknown> }[] = [];
    const files = options.files ?? new Map<string, unknown>();
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
        run: (async (panelId: string, command: string, inputs: Record<string, unknown>) => {
            const answer = options.commands?.[command];
            if (answer) {
                ran.push({ panelId, command, inputs });
                return answer(inputs);
            }
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
    const runtime = createRuntime({ storage, blocks, handle: registry.panel, ...(options.clock ? { clock: options.clock } : {}) });
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
    return { ready, call, make, subscribers, fire, said, fired, ran, registry, files, runtime, state: () => state };
}

