// A panel's problems: failures no button was waiting for (a poll, a timer,
// a reconnect, a Blocks event), told to the person the same way for every
// panel. The service, or the page, reports one; the computer's Paperboard
// Server keeps the newest few of each panel; the shell shows them by the
// panel's name until they are fixed or dismissed.
import { getTransport, invokeIn } from "./ipc";
import { newClientId } from "./channels";
import { errorCode, errorMessage } from "./errors";
import { requirePanelId } from "./panelIdentity";
import { clipProblemReport, PROBLEMS_EVENT, problemKey, readProblemReport, type PanelProblem, type ProblemReport } from "./problemShape";

export { PROBLEMS_PER_PANEL, type PanelProblem, type ProblemReport } from "./problemShape";

type Op = { action: "problems:report" | "problems:clear"; params: Record<string, unknown> };

// how long a report that could not reach the daemon waits before it tries
// again, doubling each time
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;
// reports waiting for the daemon; the daemon keeps fewer than this of a
// panel anyway, so past it the oldest is dropped
const MAX_WAITING = 100;
// the daemon's refusals: sent again, they are refused again
const REFUSALS = new Set(["BAD_PROTOCOL", "NOT_FOUND", "INVALID_PARAMS", "FORBIDDEN", "CONFLICT", "INTERNAL"]);

// One line of reports and clears per computer, sent in order, one at a time.
// A newer one about the same problem takes the place of one still waiting,
// and a clear of all a panel's problems takes the place of all of them, so
// what waits is bounded by what the daemon would keep. One that could not
// reach the daemon is sent again until it does.
class Delivery {
    private waiting = new Map<string, Op>();
    private sending = false;
    private failures = 0;

    constructor(private readonly scope: string | undefined) {}

    put(slot: string, op: Op, replaces?: (slot: string) => boolean): void {
        if (replaces) for (const other of [...this.waiting.keys()]) if (replaces(other)) this.waiting.delete(other);
        this.waiting.delete(slot);
        this.waiting.set(slot, op);
        if (this.waiting.size > MAX_WAITING) {
            const [oldest, dropped] = this.waiting.entries().next().value!;
            this.waiting.delete(oldest);
            console.error(`[paperapi] ${MAX_WAITING} problems are waiting for the Paperboard Server; the oldest is dropped:`, dropped.params);
        }
        if (!this.sending) void this.send();
    }

    private async send(): Promise<void> {
        this.sending = true;
        while (this.waiting.size > 0) {
            const [slot, op] = this.waiting.entries().next().value!;
            try {
                await getTransport(this.scope).call(op.action, op.params);
                this.failures = 0;
            } catch (err) {
                if (!REFUSALS.has(errorCode(err) ?? "")) {
                    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures++);
                    console.error(`[paperapi] A problem could not reach the Paperboard Server, trying again in ${delay} ms: ${errorMessage(err)}`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                // a refusal is the caller's mistake, which the checks below
                // make before anything is sent; there is no one left to tell
                console.error(`[paperapi] The Paperboard Server refused a problem: ${errorMessage(err)}`, op.params);
            }
            // a newer one in the same slot while this one travelled is sent next
            if (this.waiting.get(slot) === op) this.waiting.delete(slot);
        }
        this.sending = false;
    }
}

const deliveries = new Map<string, Delivery>();
function delivery(scope: string | undefined): Delivery {
    const id = scope ?? "";
    let line = deliveries.get(id);
    if (!line) deliveries.set(id, (line = new Delivery(scope)));
    return line;
}

const slotOf = (panelId: string, key: string) => `${panelId}\u0000${key}`;
const isPanels = (panelId: string) => (slot: string) => slot.startsWith(`${panelId}\u0000`);

function problemList(value: unknown): PanelProblem[] {
    if (!Array.isArray(value)) throw new Error("The Paperboard Server answered a problem list with something that is not one");
    return value as PanelProblem[];
}

/**
 * Follows problems as they change: `heard` takes each change, `list` reads
 * them whole. The whole list is read once the event is heard
 * and again on each reconnect, so nothing said while disconnected is
 * missed. A read that fails goes to onError, and is tried at the next
 * reconnect.
 */
function follow<T>(scope: string | undefined, list: () => Promise<T>, heard: (payload: any) => void, got: (value: T) => void, onError: (err: unknown) => void): () => void {
    const transport = getTransport(scope);
    let live = true;
    let request = 0;
    const read = async () => {
        const mine = ++request;
        try {
            await transport.subscriptionsSettled();
            const value = await list();
            if (live && mine === request) got(value);
        } catch (err) {
            if (live && mine === request) onError(err);
        }
    };
    // the daemon answers a read and sends its events in the order they
    // happen, on this one connection: an event heard after a read's answer
    // is newer than it
    const off = transport.subscribeSource(PROBLEMS_EVENT, (payload) => {
        if (live) heard(payload);
    });
    const status = (s: { connected: boolean }) => {
        if (s.connected) void read();
    };
    transport.onStatus(status);
    void read();
    return () => {
        live = false;
        off();
        transport.offStatus(status);
    };
}

export const problemsApi = {
    /**
     * Tells the person something failed that no button was waiting for:
     * a poll, a timer, a reconnect, a Blocks event. Paperboard shows it by
     * the panel's name until it is cleared or dismissed. Give a key to say
     * what it is about: the same key again replaces it, so a failure that
     * repeats is one problem, and clear(key) takes it away once it is
     * fixed. Returns at once; a problem that can't reach the Paperboard
     * Server is sent again until it does. A title or message too long is
     * cut to fit. Throws when the report is not one (a blank title).
     */
    report: (panelId: string, problem: ProblemReport, scope?: string): void => {
        const owner = requirePanelId(panelId);
        const checked = readProblemReport(clipProblemReport(problem));
        const key = checked.key ?? newClientId("problem");
        delivery(scope).put(slotOf(owner, key), { action: "problems:report", params: { panelId: owner, ...checked, key } });
    },

    /** Takes away the problem with this key once it is fixed; without a key, all the panel's problems. Returns at once, like report. */
    clear: (panelId: string, key?: string, scope?: string): void => {
        const owner = requirePanelId(panelId);
        if (key === undefined) {
            delivery(scope).put(slotOf(owner, "*all"), { action: "problems:clear", params: { panelId: owner } }, isPanels(owner));
            return;
        }
        const checked = problemKey(key);
        delivery(scope).put(slotOf(owner, checked), { action: "problems:clear", params: { panelId: owner, key: checked } });
    },

    /** The panel's problems, the one reported longest ago first. */
    list: async (panelId: string, scope?: string): Promise<PanelProblem[]> =>
        problemList(await invokeIn(scope, "problems-list", { panelId: requirePanelId(panelId) })),

    /**
     * Hears the panel's problems, whole, now and each time they change.
     * A read that fails goes to onError and is tried again when the
     * connection comes back. Returns the unsubscribe.
     */
    watch: (panelId: string, listener: (problems: PanelProblem[]) => void, onError: (err: unknown) => void, scope?: string): (() => void) => {
        const owner = requirePanelId(panelId);
        return follow(
            scope,
            () => problemsApi.list(owner, scope),
            (payload) => {
                if (payload?.panelId === owner) listener(problemList(payload.problems));
            },
            listener,
            onError,
        );
    },

    /**
     * Every panel's problems on the computer, by panel id, now and each
     * time they change. Paperboard's own: it needs the host's credential.
     */
    watchEvery: (listener: (byPanel: Record<string, PanelProblem[]>) => void, onError: (err: unknown) => void, scope?: string): (() => void) => {
        let byPanel: Record<string, PanelProblem[]> = {};
        return follow(
            scope,
            async () => (await invokeIn<{ panels: Record<string, PanelProblem[]> }>(scope, "problems-every")).panels,
            (payload) => {
                if (typeof payload?.panelId !== "string") return;
                const next = { ...byPanel };
                const problems = problemList(payload.problems);
                if (problems.length > 0) next[payload.panelId] = problems;
                else delete next[payload.panelId];
                listener((byPanel = next));
            },
            (all) => listener((byPanel = all)),
            onError,
        );
    },
};
