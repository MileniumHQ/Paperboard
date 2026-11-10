// Waiting on real signals, each with an upper bound that fails saying what
// never happened.
import { actionsApi, STATE_SYNC_EVENT } from "@mileniumhq/paperapi";

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
            actionsApi.call<T>(panelId, "__getState", {}).then((state) => {
                last = state;
                if (accept(state)) resolve(state);
            }, reject);
        off = actionsApi.on(panelId, STATE_SYNC_EVENT, () => void check());
        void check();
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms waiting for ${what}; last state: ${JSON.stringify(last)}`)), ms);
    });
    return found.finally(() => {
        off();
        clearTimeout(timer);
    });
}
