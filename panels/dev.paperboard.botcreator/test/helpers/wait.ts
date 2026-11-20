// Waiting on real signals, each with an upper bound that fails saying what
// never happened.
import { blocksApi, getTransport, problemsApi, STATE_EVENT, STATE_VALUE, type PanelProblem } from "@mileniumhq/paperapi";

export function within<T>(what: string, promise: Promise<T>, ms = 20_000, context?: () => string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for ${what}${context ? `\n${context()}` : ""}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Resolves with a panel service's state once `accept` holds: checked now
 * and again on every state sync the service sends.
 */
export function stateWhere<T>(panelId: string, accept: (state: T) => boolean, what: string, ms = 20_000): Promise<T> {
    let off = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const found = new Promise<T>((resolve, reject) => {
        let last: T | undefined;
        const check = () =>
            blocksApi.read<T>(panelId, STATE_VALUE).then((state) => {
                last = state;
                if (accept(state)) resolve(state);
            }, reject);
        off = blocksApi.onEvent(panelId, STATE_EVENT, () => void check());
        void check();
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for ${what}; last state: ${JSON.stringify(last)}`)), ms);
    });
    return found.finally(() => {
        off();
        clearTimeout(timer);
    });
}

/** The panel's problems, as the daemon holds them, once `accept` takes the whole list: now, or after a change. */
export function problemsWhere(panelId: string, accept: (problems: PanelProblem[]) => boolean, what: string, ms = 20_000): Promise<PanelProblem[]> {
    let off = () => {};
    const found = new Promise<PanelProblem[]>((resolve, reject) => {
        off = problemsApi.watch(panelId, (problems) => {
            if (accept(problems)) resolve(problems);
        }, reject);
    });
    return within(what, found, ms).finally(() => off());
}

/** Resolves once the daemon has taken every subscription made so far: an event fired after it is heard. */
export const subscribed = (): Promise<void> => getTransport().subscriptionsSettled();

/** Every payload a panel's event fires from the moment this resolves, in order. */
export async function heard(panelId: string, event: string, project?: string): Promise<{ payloads: Record<string, unknown>[]; next: () => Promise<Record<string, unknown>>; off: () => void }> {
    const payloads: Record<string, unknown>[] = [];
    const waiting = new Set<() => void>();
    const off = blocksApi.onEvent(panelId, event, (payload) => {
        payloads.push(payload);
        for (const wake of [...waiting]) wake();
    }, project);
    await subscribed();
    let seen = 0;
    const next = () =>
        within(`${event} to fire`, new Promise<Record<string, unknown>>((resolve) => {
            const take = () => {
                if (payloads.length <= seen) return;
                waiting.delete(take);
                resolve(payloads[seen++]!);
            };
            waiting.add(take);
            take();
        }));
    return { payloads, next, off };
}

/** The next payload a panel's event fires; `ready` is when its subscription has reached the daemon. */
export function nextEvent(panelId: string, event: string, project?: string): { payload: Promise<Record<string, unknown>>; ready: Promise<void> } {
    const listening = heard(panelId, event, project);
    const payload = listening.then(({ next, off }) => next().finally(off));
    return { payload, ready: listening.then(() => undefined) };
}
