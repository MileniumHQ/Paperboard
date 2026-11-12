// The Blocks panel's service: it keeps the projects and their flows, listens
// for the events the switched-on projects start from, and runs them, whether
// or not a window is open. The page edits one project's flows at a time and
// shows the run log this service keeps.
import { blockEntry, blocksApi, config, definePanelService, type ServiceContext } from "@mileniumhq/paperapi";
import { BlockError, hatInputs, isHat, runHat, type Host, type SavedBlock } from "./lib/interpreter";
import { BUILTIN, parseEntry, parseRegistryBlockType, registryBlockType } from "./lib/names";
import { BlocksAnnouncer, FLOW_FAILED_EVENT, blocksPanelBlocks } from "./blocks";
import { readFlows } from "./lib/flows";
import { ProjectStore, readPreview } from "./lib/projects";
import { DEFAULT_STATE, MAX_LOG, PANEL_ID, SERVICE_CALLS, type LogEntry, type PanelState, type SavedFlows } from "./panel";

type Ctx = ServiceContext<PanelState>;

let ctx: Ctx;
const store = new ProjectStore({
    get: (path) => config.get<unknown>(PANEL_ID, path),
    set: async (value, path) => {
        await config.set(value, PANEL_ID, path);
    },
});
let nextLogId = 1;
// every run in progress and its project, so Stop ends a project's runs
const runs = new Map<AbortController, string>();
// one subscription per event or value the flows start from
const listening = new Map<string, () => void>();
const announcer = new BlocksAnnouncer(blocksApi.panel(PANEL_ID));
// the hat of this panel's own "When a Flow Fails": a flow it starts that fails doesn't fire it again
const FLOW_FAILED_HAT = registryBlockType({ kind: "event", panelId: PANEL_ID, entry: blockEntry("event", FLOW_FAILED_EVENT) });
/** The most runs one project has at once, so a flow that starts its own project can't run away. */
export const MAX_RUNS_PER_PROJECT = 50;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function log(project: string, level: LogEntry["level"], text: string, blockId?: string): void {
    const entry: LogEntry = { id: nextLogId++, at: Date.now(), level, message: text, project, ...(blockId ? { blockId } : {}) };
    ctx.setState((prev) => ({ log: [...prev.log, entry].slice(-MAX_LOG) }));
}

function publishRunning(): void {
    const running: Record<string, number> = {};
    for (const project of runs.values()) running[project] = (running[project] ?? 0) + 1;
    ctx.setState({ running });
}

/** The project list changed: every window hears it, and the listening follows. */
function publishProjects(): void {
    ctx.setState({ projects: store.list() });
    announcer.projects(keptProjects());
    listen();
}

/** The projects a flow can name: a draft isn't kept until it has a block. */
const keptProjects = () => store.list().filter((p) => !p.draft).map((p) => p.id);

const runningCount = (project: string) => [...runs.values()].filter((owner) => owner === project).length;

/**
 * A call to another panel, as long as it takes (a backup or an install can
 * take minutes), unless the run is stopped first: then the flow stops
 * waiting for it. The other panel still finishes what it started.
 */
function untilStopped<T>(signal: AbortSignal, call: Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(new Error("The run was stopped"));
    return new Promise<T>((resolve, reject) => {
        const stop = () => reject(new Error("The run was stopped"));
        signal.addEventListener("abort", stop, { once: true });
        call.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    });
}

function host(project: string, signal: AbortSignal): Host {
    return {
        signal,
        run: (panelId, entry, inputs) => {
            const { project: target, id } = parseEntry(entry);
            return untilStopped(signal, blocksApi.run(panelId, id, inputs, { ...(target ? { project: target } : {}), timeoutMs: null }));
        },
        read: (panelId, entry, inputs) => {
            const { project: target, id } = parseEntry(entry);
            return untilStopped(signal, blocksApi.read(panelId, id, inputs, target ? { project: target } : {}));
        },
        property: (typeRef, field, value, target) => untilStopped(signal, blocksApi.property(typeRef, field, value, target ? { project: target } : {})),
        log: (text, blockId) => log(project, "info", text, blockId),
    };
}

async function start(project: string, flows: SavedFlows, hat: SavedBlock, payload: Record<string, unknown> | null): Promise<void> {
    if (runningCount(project) >= MAX_RUNS_PER_PROJECT) {
        log(project, "error", `A flow didn't start: ${MAX_RUNS_PER_PROJECT} of this project's flows are already running. Stop them, or check for a flow that starts itself.`, hat.id);
        return;
    }
    const controller = new AbortController();
    runs.set(controller, project);
    publishRunning();
    try {
        await runHat(hat, payload, flows.workspace, host(project, controller.signal));
    } catch (err) {
        log(project, "error", message(err), err instanceof BlockError ? err.blockId : hat.id);
        // a run that was stopped didn't fail
        if (!controller.signal.aborted && hat.type !== FLOW_FAILED_HAT) announcer.failed(project, message(err));
    } finally {
        runs.delete(controller);
        publishRunning();
    }
}

const topBlocks = (flows: SavedFlows) => (flows.workspace.blocks?.blocks ?? []).filter((b) => b.enabled !== false);

/** The hats of this type in every switched-on project, started with this payload when their filters hold. */
async function fire(hatType: string, payload: Record<string, unknown> | null): Promise<void> {
    for (const { id: project, flows } of store.running()) {
        const schema = flows.schemas[hatType]?.schema;
        const filters = schema?.kind === "event" ? schema.filters ?? {} : {};
        for (const hat of topBlocks(flows).filter((b) => b.type === hatType)) {
            if (Object.keys(filters).length) {
                let wanted: Record<string, unknown>;
                try {
                    // a filter's input is worked out before the flow starts, outside any run
                    wanted = await hatInputs(hat, flows.workspace, host(project, new AbortController().signal));
                } catch (err) {
                    log(project, "error", message(err), err instanceof BlockError ? err.blockId : hat.id);
                    continue;
                }
                const holds = Object.entries(filters).every(([input, key]) => {
                    const want = wanted[input];
                    return want === undefined || want === "" || JSON.stringify(want) === JSON.stringify(payload?.[key]);
                });
                if (!holds) continue;
            }
            void start(project, flows, hat, payload);
        }
    }
}

/** Listens for exactly the events and changes the switched-on projects start from. */
function listen(): void {
    const wanted = new Set(
        store.running().flatMap(({ flows }) =>
            topBlocks(flows)
                .map((b) => b.type)
                .filter((type) => {
                    const name = parseRegistryBlockType(type);
                    return name?.kind === "event" || name?.kind === "changes";
                }),
        ),
    );
    for (const [type, off] of listening) {
        if (!wanted.has(type)) {
            off();
            listening.delete(type);
        }
    }
    for (const type of wanted) {
        if (listening.has(type)) continue;
        const name = parseRegistryBlockType(type)!;
        const { project, id } = parseEntry(name.entry);
        listening.set(
            type,
            name.kind === "event"
                ? blocksApi.onEvent(name.panelId, id, (payload) => void fire(type, payload), project)
                : blocksApi.onChange(name.panelId, id, () => void fire(type, null), project),
        );
    }
}

function stop(project: string): number {
    let count = 0;
    for (const [run, owner] of runs) {
        if (owner !== project) continue;
        run.abort();
        count++;
    }
    return count;
}

/** Starts a project's "When Run is clicked" flows; how many started. */
function runProject(project: unknown): number {
    const flows = store.flows(project);
    const hats = topBlocks(flows).filter((b) => b.type === BUILTIN.onRun);
    if (!hats.length) throw new Error('Add a "When Run is clicked" block for Run to start');
    for (const hat of hats) void start(String(project), flows, hat, null);
    return hats.length;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const inputsOf = (inputs: unknown): Record<string, unknown> => (isRecord(inputs) ? inputs : {});

// settled once the projects are read: with null, or with why they couldn't be
let settle!: (failure: string | null) => void;
const read = new Promise<string | null>((resolve) => (settle = resolve));
/** Every call waits for the projects to be read, and says so if they couldn't be. */
async function opened(): Promise<void> {
    const failure = await read;
    if (failure) throw new Error(`The projects couldn't be read: ${failure}`);
}

/** A call the panel's own page makes: it waits for the projects to be read. */
const call = (run: (inputs: Record<string, unknown>) => unknown) => async (_ctx: unknown, input: unknown) => {
    await opened();
    return run(inputsOf(input));
};

/** A project change, then the list every window shows. */
const changing = async <T>(work: Promise<T>): Promise<T> => {
    const result = await work;
    publishProjects();
    return result;
};

export default definePanelService({
    id: PANEL_ID,
    state: DEFAULT_STATE,
    calls: {
        [SERVICE_CALLS.load]: call(({ project }) => store.flows(project)),
        [SERVICE_CALLS.save]: call(({ project, flows, preview }) => changing(store.save(project, readFlows(flows), readPreview(preview)))),
        [SERVICE_CALLS.run]: call(({ project }) => runProject(project)),
        [SERVICE_CALLS.stop]: call(({ project }) => stop(String(project))),
        [SERVICE_CALLS.clearLog]: call(({ project }) => {
            ctx.setState((prev) => ({ log: prev.log.filter((entry) => entry.project !== project) }));
            return true;
        }),
        [SERVICE_CALLS.createProject]: call(({ name }) => changing(store.create(name))),
        [SERVICE_CALLS.updateProject]: call(({ project, name, enabled }) => changing(store.update(project, { name, enabled }))),
        [SERVICE_CALLS.duplicateProject]: call(({ project }) => changing(store.duplicate(project))),
        [SERVICE_CALLS.deleteProject]: call(async ({ project, onlyDraft }) => {
            const deleted = await changing(store.remove(project, onlyDraft === true));
            // a deleted project's flows stop with it
            if (deleted) stop(String(project));
            return { deleted };
        }),
    },
    async onInit(context) {
        ctx = context;
        try {
            await store.open();
        } catch (err) {
            // nothing runs and nothing is written while the projects can't be read
            ctx.setState({ projectsError: message(err), loaded: true });
            console.error(`[${PANEL_ID}] the projects couldn't be read:`, err);
            settle(message(err));
            return;
        }
        publishProjects();
        ctx.setState({ loaded: true });
        settle(null);
        try {
            await announcer.register(
                blocksPanelBlocks({
                    projects: keptProjects,
                    project: (id) => store.summaryOf(id),
                    runningCount,
                    setEnabled: async (id, enabled) => void (await changing(store.update(id, { enabled }))),
                    run: runProject,
                    stop: (id) => stop(store.summaryOf(id).id),
                }),
                keptProjects(),
            );
        } catch (err) {
            // the projects still run; only flows that drive them are missing their blocks
            ctx.setState({ blocksError: `The Projects blocks couldn't be added: ${message(err)}` });
            console.error(`[${PANEL_ID}] the Projects blocks couldn't be registered:`, err);
        }
        const flows = store.running().reduce((n, p) => n + topBlocks(p.flows).filter((b) => isHat(b.type)).length, 0);
        console.log(`[${PANEL_ID}] ${store.list().length} project(s), ${flows} flow(s) switched on.`);
    },
});
