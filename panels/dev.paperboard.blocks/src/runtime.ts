// What the Blocks service does, given the registry and the storage it does
// it over: it keeps the projects and their flows, listens for the events the
// switched-on projects start from, and runs them. service.ts hands it the
// daemon's; the tests hand it a registry and storage in memory.
import { blockEntry, type BackupContents, type blocksApi, type BlocksHandle, type CallHandlers, type ServiceContext, errorMessage } from "@mileniumhq/paperapi";
import { BlockError, hatInputs, isHat, runHat, type Host, type SavedBlock } from "./lib/interpreter";
import { BUILTIN, parseEntry, parseRegistryBlockType, registryBlockType } from "./lib/names";
import { BlocksAnnouncer, FLOW_FAILED_EVENT, blocksPanelBlocks } from "./blocks";
import { RUN_STOPPED } from "./lib/failure";
import { ProjectStore, readPreview, type ProjectStorage } from "./lib/projects";
import { MAX_LOG, PANEL_ID, blocksContract, type LogEntry, type PanelState, type SavedFlows } from "./panel";

/** The most runs one project has at once, so a flow that starts its own project can't run away. */
export const MAX_RUNS_PER_PROJECT = 50;

export interface RuntimeDeps {
    storage: ProjectStorage;
    /** the registry the flows run and listen through */
    blocks: Pick<typeof blocksApi, "run" | "read" | "property" | "onEvent" | "onChange">;
    /** this panel's own handle, for its Projects blocks */
    handle: BlocksHandle;
}

type SetState = ServiceContext<PanelState>["setState"];

/** The stacks that run: a switched-off stack starts from nothing. */
const enabledStacks = (flows: SavedFlows) => (flows.workspace.blocks?.blocks ?? []).filter((b) => b.enabled !== false);
// the hat of this panel's own "When a Flow Fails": a flow it starts that fails doesn't fire it again
const FLOW_FAILED_HAT = registryBlockType({ kind: "event", panelId: PANEL_ID, entry: blockEntry("event", FLOW_FAILED_EVENT) });

export function createRuntime({ storage, blocks, handle }: RuntimeDeps) {
    const store = new ProjectStore(storage);
    const announcer = new BlocksAnnouncer(handle);
    let setState!: SetState;
    let nextLogId = 1;
    // every run in progress and its project, so Stop ends a project's runs
    const runs = new Map<AbortController, string>();
    // one subscription per event or value the flows start from
    const listening = new Map<string, () => void>();

    function log(project: string, level: LogEntry["level"], text: string, blockId?: string): void {
        // a failure is said as a sentence in the console and on its block, whoever worded it
        const message = level === "error" && !/[.!?…]$/.test(text) ? `${text}.` : text;
        const entry: LogEntry = { id: nextLogId++, at: Date.now(), level, message, project, ...(blockId ? { blockId } : {}) };
        setState((prev) => ({ log: [...prev.log, entry].slice(-MAX_LOG) }));
    }

    function publishRunning(): void {
        const running: Record<string, number> = {};
        for (const project of runs.values()) running[project] = (running[project] ?? 0) + 1;
        setState({ running });
    }

    /** The projects a flow can name: a draft isn't kept until it has a block. */
    const keptProjects = () => store.list().filter((p) => !p.draft).map((p) => p.id);

    const runningCount = (project: string) => [...runs.values()].filter((owner) => owner === project).length;

    // the registry missed the latest project list: the home screen says so until an announcement reaches it.
    // An announcement needs the Projects blocks registered, so this never hides why they weren't
    let announceFailed = false;

    /** The project list changed: every window hears it, the registry is told, and the listening follows. */
    function publishProjects(): void {
        setState({ projects: store.list() });
        announcer.projects(keptProjects()).then(
            (current) => {
                if (!current || !announceFailed) return;
                announceFailed = false;
                setState({ blocksError: null });
            },
            (err: unknown) => {
                announceFailed = true;
                setState({ blocksError: `The other panels weren't told the projects changed: ${errorMessage(err)}` });
            },
        );
        listen();
    }

    /**
     * A call to another panel, as long as it takes (a backup or an install can
     * take minutes), unless the run is stopped first: then the flow stops
     * waiting for it. The other panel still finishes what it started.
     */
    function untilStopped<T>(signal: AbortSignal, call: Promise<T>): Promise<T> {
        if (signal.aborted) return Promise.reject(new Error(RUN_STOPPED));
        return new Promise<T>((resolve, reject) => {
            const stopped = () => reject(new Error(RUN_STOPPED));
            signal.addEventListener("abort", stopped, { once: true });
            call.then(resolve, reject).finally(() => signal.removeEventListener("abort", stopped));
        });
    }

    function host(project: string, signal: AbortSignal): Host {
        const at = (target: string | undefined) => (target ? { project: target } : {});
        return {
            signal,
            run: (panelId, entry, inputs) => {
                const { project: target, id } = parseEntry(entry);
                return untilStopped(signal, blocks.run(panelId, id, inputs, { ...at(target), timeoutMs: null }));
            },
            read: (panelId, entry, inputs) => {
                const { project: target, id } = parseEntry(entry);
                return untilStopped(signal, blocks.read(panelId, id, inputs, at(target)));
            },
            property: (typeRef, field, value, target) => untilStopped(signal, blocks.property(typeRef, field, value, at(target))),
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
            // a run that was stopped didn't fail: it is said, and nothing is pinned on a block
            if (controller.signal.aborted) return log(project, "info", errorMessage(err));
            log(project, "error", errorMessage(err), err instanceof BlockError ? err.blockId : hat.id);
            if (hat.type !== FLOW_FAILED_HAT) {
                announcer.failed(project, errorMessage(err)).catch((why: unknown) => log(project, "error", `"When a Flow Fails" didn't hear this failure: ${errorMessage(why)}`, hat.id));
            }
        } finally {
            runs.delete(controller);
            publishRunning();
        }
    }

    /** The hats of this type in every switched-on project, started with this payload when their filters hold. */
    async function fire(hatType: string, payload: Record<string, unknown> | null): Promise<void> {
        for (const { id: project, flows } of store.running()) {
            const schema = flows.schemas[hatType]?.schema;
            const filters = schema?.kind === "event" ? (schema.filters ?? {}) : {};
            for (const hat of enabledStacks(flows).filter((b) => b.type === hatType)) {
                if (Object.keys(filters).length) {
                    let wanted: Record<string, unknown>;
                    try {
                        // a filter's input is worked out before the flow starts, outside any run
                        wanted = await hatInputs(hat, flows.workspace, host(project, new AbortController().signal));
                    } catch (err) {
                        log(project, "error", errorMessage(err), err instanceof BlockError ? err.blockId : hat.id);
                        continue;
                    }
                    // a filter left empty takes any
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
                enabledStacks(flows)
                    .map((b) => b.type)
                    .filter((type) => {
                        const name = parseRegistryBlockType(type);
                        return name?.kind === "event" || name?.kind === "changes";
                    }),
            ),
        );
        for (const [type, off] of listening) {
            if (wanted.has(type)) continue;
            off();
            listening.delete(type);
        }
        for (const type of wanted) {
            if (listening.has(type)) continue;
            const name = parseRegistryBlockType(type)!;
            const { project, id } = parseEntry(name.entry);
            listening.set(
                type,
                name.kind === "event"
                    ? blocks.onEvent(name.panelId, id, (payload) => void fire(type, payload), project)
                    : blocks.onChange(name.panelId, id, () => void fire(type, null), project),
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
        const hats = enabledStacks(flows).filter((b) => b.type === BUILTIN.onRun);
        if (!hats.length) throw new Error('Add a "When Run is clicked" block for Run to start');
        for (const hat of hats) void start(String(project), flows, hat, null);
        return hats.length;
    }

    // settled once the projects are read: with null, or with why they couldn't be;
    // a read again after a failure takes its place
    let settle!: (failure: string | null) => void;
    let read = new Promise<string | null>((resolve) => (settle = resolve));

    /** A call the panel's own page makes: it waits for the projects to be read, and says so if they couldn't be. */
    const call = <I, O>(run: (input: I) => O | Promise<O>) => async (input: I): Promise<O> => {
        const failure = await read;
        if (failure) throw new Error(`The projects couldn't be read: ${failure}`);
        return run(input);
    };

    /** A project change, then the list every window shows, also after a change that only partly happened. */
    const changing = async <T>(work: Promise<T>): Promise<T> => {
        try {
            return await work;
        } finally {
            publishProjects();
        }
    };

    const calls = {
        loadFlows: call(({ project }) => store.flows(project)),
        saveFlows: call(({ project, flows, preview }) => changing(store.save(project, flows, readPreview(preview)))),
        runFlows: call(({ project }) => runProject(project)),
        stopFlows: call(({ project }) => stop(project)),
        clearLog: call(({ project }) => {
            setState((prev) => ({ log: prev.log.filter((entry) => entry.project !== project) }));
        }),
        createProject: call(({ name }) => changing(store.create(name))),
        updateProject: call(({ project, name, enabled }) => changing(store.update(project, { name, enabled }))),
        duplicateProject: call(({ project }) => changing(store.duplicate(project))),
        deleteProject: call(async ({ project, onlyDraft }) => {
            try {
                return { deleted: await changing(store.remove(project, onlyDraft === true)) };
            } finally {
                // a deleted project's flows stop with it, also when its file couldn't be emptied after
                if (!store.has(project)) stop(project);
            }
        }),
        readProjects: async () => {
            if ((await read) === null) return;
            read = open();
            const failure = await read;
            if (failure) throw new Error(failure);
            await addBlocks();
        },
    } satisfies CallHandlers<typeof blocksContract>;

    /** Reads the projects and starts listening; why they couldn't be read is in the state, and returned. */
    async function open(): Promise<string | null> {
        try {
            await store.open();
        } catch (err) {
            // nothing runs and nothing is written while the projects can't be read
            setState({ projectsError: errorMessage(err), loaded: true });
            console.error(`[${PANEL_ID}] the projects couldn't be read:`, err);
            return errorMessage(err);
        }
        setState({ projects: store.list(), projectsError: null, loaded: true });
        listen();
        return null;
    }

    /** Reads the projects, starts listening, and adds the Projects blocks; every failure ends up in the state. */
    async function init(state: SetState): Promise<void> {
        setState = state;
        const failure = await open();
        settle(failure);
        if (failure === null) await addBlocks();
    }

    /** Adds the Projects blocks, once the projects are read. */
    async function addBlocks(): Promise<void> {
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
            setState({ blocksError: `The Projects blocks couldn't be added: ${errorMessage(err)}` });
            console.error(`[${PANEL_ID}] the Projects blocks couldn't be registered:`, err);
        }
        const flows = store.running().reduce((n, p) => n + enabledStacks(p.flows).filter((b) => isHat(b.type)).length, 0);
        console.log(`[${PANEL_ID}] ${store.list().length} project(s), ${flows} flow(s) switched on.`);
    }

    /** With no page open, no editor shows a draft any more: they go, as leaving one does. */
    async function pagesChanged(open: number): Promise<void> {
        if (open > 0 || (await read) !== null) return;
        if ((await store.dropDrafts()) > 0) publishProjects();
    }

    // Backups: everything Blocks keeps is in the panel's files (the project index and one file per
    // canvas), so a backup is those files, copied while no change is being written.
    const noTarget = (target: string | null) => {
        if (target !== null) throw new Error(`Blocks backs up as a whole, so it has no "${target}" to back up`);
    };

    const backup = {
        beforeBackup: async (target: string | null): Promise<BackupContents> => {
            noTarget(target);
            if ((await read) !== null) throw new Error("The projects couldn't be read, so there is nothing to back up");
            await store.pause();
            return { paths: [""] };
        },
        beforeRestore: async (target: string | null): Promise<void> => {
            noTarget(target);
            if ((await read) !== null) throw new Error("The projects couldn't be read, so they can't be replaced by a backup");
            await store.pause();
        },
        /** the copy is made, or a restore did not happen: the held changes go on */
        resume: async (): Promise<void> => {
            if (store.paused) await store.resume(false);
        },
        /** the files are the backup's: the projects are read again from them and the flows run from those */
        restored: async (): Promise<void> => {
            // the read is done before any held change runs, so none meets the old projects over the new files
            await store.resume(true);
            for (const run of runs.keys()) run.abort();
            setState({ projects: store.list(), projectsError: null, loaded: true });
            publishProjects();
        },
    };

    return { calls, init, pagesChanged, backup };
}
