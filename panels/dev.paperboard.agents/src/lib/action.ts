// Two small patterns every view here shares: an action that is busy while it
// runs and says why it didn't happen, and a read whose answer counts only if
// nothing newer started (and the view is still there).

import { createSignal, getOwner, onCleanup } from "solid-js";
import { failure, type Failure } from "./failure";

/**
 * `run(title, fn)` sets busy while fn runs, and a refusal becomes the failure
 * shown under `title`. Resolves whether fn went through. A run can show its
 * failure somewhere else (a confirmation that stays open) by passing `setFailure`.
 */
export function createAction() {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<Failure | null>(null);
    const run = async (title: string, fn: () => Promise<unknown>, setFailure: (f: Failure | null) => void = setError) => {
        setBusy(true);
        setFailure(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setFailure(failure(title, e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    return { busy, error, setError, run };
}

/**
 * Latest wins: `next()` starts a read and hands back `current()`, true while
 * no newer read has started and the owner hasn't been disposed. An older
 * answer, or one that lands after the view went, is dropped.
 */
export function createLatest() {
    let n = 0;
    let gone = false;
    if (getOwner()) onCleanup(() => (gone = true));
    return () => {
        const mine = ++n;
        return () => !gone && mine === n;
    };
}
