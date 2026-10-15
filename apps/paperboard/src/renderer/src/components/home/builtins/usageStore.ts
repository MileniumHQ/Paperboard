// One usage poller per computer, shared by every CPU and Memory widget and
// gallery preview showing it. It runs only while a visible widget is
// watching, and forgets the computer when the last one stops.
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, type Setter } from "solid-js";
import { systemApi, type UsageReport } from "@mileniumhq/paperapi";
import { logToMain } from "../../../lib/shell";

const POLL_MS = 2_000;
// a computer that failed is asked again this much later, not every poll
const FAILED_POLL_MS = 15_000;
/** Readings kept for the trend line: two minutes of them. */
export const USAGE_HISTORY_SAMPLES = 60;

export type UsageState =
    | { kind: "loading" }
    | { kind: "ready"; report: UsageReport }
    | { kind: "unavailable"; message: string };

interface Poller {
    watchers: number;
    state: Accessor<UsageState>;
    setState: Setter<UsageState>;
    /** the newest USAGE_HISTORY_SAMPLES readings, oldest first */
    history: Accessor<UsageReport[]>;
    setHistory: Setter<UsageReport[]>;
    timer?: ReturnType<typeof setTimeout>;
    inFlight: boolean;
}

const pollers = new Map<string, Poller>();

function describe(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (/Unknown action/i.test(message)) return "This computer's Paperboard Server is too old to report usage. Update it to see this.";
    return message;
}

async function poll(computerId: string, poller: Poller): Promise<void> {
    clearTimeout(poller.timer);
    if (poller.inFlight || pollers.get(computerId) !== poller) return;
    poller.inFlight = true;
    let next = POLL_MS;
    try {
        const report = await systemApi.getUsage(computerId);
        poller.setState({ kind: "ready", report });
        poller.setHistory((previous) => [...previous, report].slice(-USAGE_HISTORY_SAMPLES));
    } catch (err) {
        logToMain("warn", `Couldn't read usage from ${computerId}:`, err);
        poller.setState({ kind: "unavailable", message: describe(err) });
        next = FAILED_POLL_MS;
    } finally {
        poller.inFlight = false;
    }
    if (poller.watchers > 0 && pollers.get(computerId) === poller) {
        poller.timer = setTimeout(() => void poll(computerId, poller), next);
    }
}

function watch(computerId: string): Poller {
    let poller = pollers.get(computerId);
    if (!poller) {
        const [state, setState] = createSignal<UsageState>({ kind: "loading" });
        const [history, setHistory] = createSignal<UsageReport[]>([]);
        poller = { watchers: 0, state, setState, history, setHistory, inFlight: false };
        pollers.set(computerId, poller);
    }
    poller.watchers++;
    if (poller.watchers === 1) void poll(computerId, poller);
    return poller;
}

function unwatch(computerId: string, poller: Poller): void {
    poller.watchers--;
    if (poller.watchers > 0) return;
    clearTimeout(poller.timer);
    if (pollers.get(computerId) === poller) pollers.delete(computerId);
}

export interface ShownUsage {
    computerId: string;
    state: UsageState;
}

/**
 * What a widget shows next. A widget shown again keeps its last reading
 * until the next one lands, but only for the same computer: another
 * computer starts from loading, never under the old one's numbers.
 */
export function nextShownUsage(previous: ShownUsage, computerId: string, next: UsageState): ShownUsage {
    const keep = next.kind === "loading" && previous.computerId === computerId && previous.state.kind !== "loading";
    return keep ? previous : { computerId, state: next };
}

/**
 * A computer's usage while `active` (the widget is on screen). Hidden
 * widgets keep the last reading but stop asking.
 */
export function useUsage(computerId: Accessor<string>, active: Accessor<boolean>) {
    const [watched, setWatched] = createSignal<{ computerId: string; poller: Poller } | null>(null);
    // the poller for the computer asked about now; a stale one (the effect
    // hasn't moved yet) is no poller, never another computer's readings
    const current = () => {
        const w = watched();
        return w && w.computerId === computerId() ? w.poller : null;
    };
    createEffect(() => {
        if (!active()) return;
        const id = computerId();
        const poller = watch(id);
        setWatched({ computerId: id, poller });
        onCleanup(() => unwatch(id, poller));
    });
    const shown = createMemo<ShownUsage>(
        (previous) => nextShownUsage(previous, computerId(), current()?.state() ?? { kind: "loading" }),
        { computerId: "", state: { kind: "loading" } },
    );
    const state = () => shown().state;
    const retry = () => {
        const poller = current();
        const id = computerId();
        if (poller && pollers.get(id) === poller) void poll(id, poller);
    };
    // readings since something began watching this computer; they go with the poller
    const history = () => current()?.history() ?? [];
    return { state, history, retry };
}
