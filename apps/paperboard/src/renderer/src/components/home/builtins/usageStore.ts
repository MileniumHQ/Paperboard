// One usage poller per computer, shared by every CPU and Memory widget and
// gallery preview showing it. It runs only while a visible widget is
// watching, and forgets the computer when the last one stops.
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, type Setter } from "solid-js";
import { systemApi, type UsageReport } from "@mileniumhq/paperapi";
import { logToMain } from "../../../lib/shell";

const POLL_MS = 2_000;
// a computer that failed is asked again this much later, not every poll
const FAILED_POLL_MS = 15_000;

export type UsageState =
    | { kind: "loading" }
    | { kind: "ready"; report: UsageReport }
    | { kind: "unavailable"; message: string };

interface Poller {
    watchers: number;
    state: Accessor<UsageState>;
    setState: Setter<UsageState>;
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
        poller.setState({ kind: "ready", report: await systemApi.getUsage(computerId) });
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
        poller = { watchers: 0, state, setState, inFlight: false };
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

/**
 * A computer's usage while `active` (the widget is on screen). Hidden
 * widgets keep the last reading but stop asking.
 */
export function useUsage(computerId: Accessor<string>, active: Accessor<boolean>) {
    const [current, setCurrent] = createSignal<Poller | null>(null);
    createEffect(() => {
        if (!active()) return;
        const id = computerId();
        const poller = watch(id);
        setCurrent(poller);
        onCleanup(() => unwatch(id, poller));
    });
    // a widget shown again keeps its last reading until the next one lands
    const state = createMemo<UsageState>((previous) => {
        const next = current()?.state() ?? { kind: "loading" };
        return next.kind === "loading" && previous.kind !== "loading" ? previous : next;
    }, { kind: "loading" });
    const retry = () => {
        const poller = current();
        const id = computerId();
        if (poller && pollers.get(id) === poller) void poll(id, poller);
    };
    return { state, retry };
}
