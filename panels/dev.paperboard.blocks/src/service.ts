// The Blocks panel's service: it keeps the flows, listens for the events
// they start from, and runs them, whether or not a window is open. The page
// edits the flows and shows the run log this service keeps.
import { blocksApi, config, definePanelService, defineAction, type ServiceContext } from "@mileniumhq/paperapi";
import { BlockError, hatInputs, isHat, runHat, type Host, type SavedBlock } from "./lib/interpreter";
import { BUILTIN, parseEntry, parseRegistryBlockType } from "./lib/names";
import { readFlows } from "./lib/flows";
import { DEFAULT_STATE, EMPTY_FLOWS, MAX_LOG, PANEL_ID, SERVICE_ACTIONS, type LogEntry, type PanelState, type SavedFlows } from "./panel";

type Ctx = ServiceContext<PanelState>;

let ctx: Ctx;
let flows: SavedFlows = EMPTY_FLOWS;
let nextLogId = 1;
// every run in progress, so Stop ends them all
const runs = new Set<AbortController>();
// one subscription per event or value the flows start from
const listening = new Map<string, () => void>();

function log(level: LogEntry["level"], message: string, blockId?: string): void {
    const entry: LogEntry = { id: nextLogId++, at: Date.now(), level, message, ...(blockId ? { blockId } : {}) };
    ctx.setState((prev) => ({ log: [...prev.log, entry].slice(-MAX_LOG) }));
}

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

function host(signal: AbortSignal): Host {
    return {
        signal,
        run: (panelId, entry, inputs) => {
            const { project, id } = parseEntry(entry);
            return untilStopped(signal, blocksApi.run(panelId, id, inputs, { ...(project ? { project } : {}), timeoutMs: null }));
        },
        read: (panelId, entry, inputs) => {
            const { project, id } = parseEntry(entry);
            return untilStopped(signal, blocksApi.read(panelId, id, inputs, project ? { project } : {}));
        },
        property: (typeRef, field, value) => untilStopped(signal, blocksApi.property(typeRef, field, value)),
        log: (message, blockId) => log("info", message, blockId),
    };
}

async function start(hat: SavedBlock, payload: Record<string, unknown> | null): Promise<void> {
    const controller = new AbortController();
    runs.add(controller);
    ctx.setState({ running: runs.size });
    try {
        await runHat(hat, payload, flows.workspace, host(controller.signal));
    } catch (err) {
        log("error", err instanceof Error ? err.message : String(err), err instanceof BlockError ? err.blockId : hat.id);
    } finally {
        runs.delete(controller);
        ctx.setState({ running: runs.size });
    }
}

const topBlocks = () => (flows.workspace.blocks?.blocks ?? []).filter((b) => b.enabled !== false);

/** The hats of this type, started with this payload when their filters hold. */
async function fire(hatType: string, payload: Record<string, unknown> | null): Promise<void> {
    const schema = flows.schemas[hatType]?.schema;
    const filters = schema?.kind === "event" ? schema.filters ?? {} : {};
    for (const hat of topBlocks().filter((b) => b.type === hatType)) {
        if (Object.keys(filters).length) {
            let wanted: Record<string, unknown>;
            try {
                // a filter's input is worked out before the flow starts, outside any run
                wanted = await hatInputs(hat, flows.workspace, host(new AbortController().signal));
            } catch (err) {
                log("error", err instanceof Error ? err.message : String(err), err instanceof BlockError ? err.blockId : hat.id);
                continue;
            }
            const holds = Object.entries(filters).every(([input, key]) => {
                const want = wanted[input];
                return want === undefined || want === "" || JSON.stringify(want) === JSON.stringify(payload?.[key]);
            });
            if (!holds) continue;
        }
        void start(hat, payload);
    }
}

/** Listens for exactly the events and changes the flows start from. */
function listen(): void {
    const wanted = new Set(topBlocks().map((b) => b.type).filter((type) => {
        const name = parseRegistryBlockType(type);
        return name?.kind === "event" || name?.kind === "changes";
    }));
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

function stopAll(): number {
    const count = runs.size;
    for (const run of runs) run.abort();
    return count;
}

const internal = (id: string, run: (inputs: any) => unknown) =>
    defineAction({ id, name: id, description: "", internal: true, inputs: {}, run: (_ctx: unknown, inputs: any) => run(inputs) });

export default definePanelService({
    id: PANEL_ID,
    state: DEFAULT_STATE,
    actions: [
        internal(SERVICE_ACTIONS.load, () => flows),
        internal(SERVICE_ACTIONS.save, async (inputs: unknown) => {
            const next = readFlows(inputs);
            await config.set(next, PANEL_ID);
            flows = next;
            listen();
            return true;
        }),
        internal(SERVICE_ACTIONS.run, () => {
            const hats = topBlocks().filter((b) => b.type === BUILTIN.onRun);
            if (!hats.length) throw new Error('Add a "When Run is clicked" block for Run to start');
            for (const hat of hats) void start(hat, null);
            return hats.length;
        }),
        internal(SERVICE_ACTIONS.stop, () => stopAll()),
        internal(SERVICE_ACTIONS.clearLog, () => {
            ctx.setState({ log: [] });
            return true;
        }),
    ],
    async onInit(context) {
        ctx = context;
        const saved = await config.get<unknown>(PANEL_ID);
        flows = saved === undefined || saved === null || (typeof saved === "object" && Object.keys(saved).length === 0) ? EMPTY_FLOWS : readFlows(saved);
        const hats = topBlocks().filter((b) => isHat(b.type));
        listen();
        console.log(`[${PANEL_ID}] ${hats.length} flow(s) loaded.`);
    },
});
