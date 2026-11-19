import { createSignal } from "solid-js";
import { createLatest } from "@mileniumhq/paperui";
import { computersApi, logToMain } from "./shell";
import { errorMessage } from "@mileniumhq/paperapi";

/**
 * Whether a paired computer answers, for the dialogs that offer to try it
 * again. A newer check, or a reset, makes an older one's answer moot. The
 * last answer stays shown while a check runs, until the new one replaces it. A
 * check that finds the computer resolves true; reconnecting to it is the
 * caller's, and the same for every dialog.
 */
export function createReachCheck() {
    const [checking, setChecking] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const latest = createLatest();

    const check = async (computer: { host: string; port: number }): Promise<boolean> => {
        const current = latest();
        setChecking(true);
        try {
            const probe = await computersApi.probe(computer.host, computer.port);
            if (!current()) return false;
            if (probe?.reachable) {
                setError(null);
                return true;
            }
            setError(probe?.error || "Unreachable");
        } catch (err) {
            logToMain("error", "Checking a computer failed:", err);
            if (current()) setError(errorMessage(err));
        } finally {
            // only the newest check may clear the busy flag
            if (current()) setChecking(false);
        }
        return false;
    };

    /** drops a check still out, and shows `shown` as the last answer */
    const reset = (shown: string | null) => {
        latest.cancel();
        setChecking(false);
        setError(shown);
    };

    return { checking, error, check, reset };
}
