// The project and file changes a person starts from a menu or a button: one
// at a time, and each one that fails says why.
import { createSignal } from "solid-js";

export function oneAtATime() {
    const [busy, setBusy] = createSignal(false);
    /** Runs `work` unless a change is already running; what it throws goes to `failed`. */
    const run = async (work: () => Promise<void>, failed: (err: unknown) => void): Promise<void> => {
        if (busy()) return;
        setBusy(true);
        try {
            await work();
        } catch (err) {
            failed(err);
        } finally {
            setBusy(false);
        }
    };
    return { busy, run };
}
