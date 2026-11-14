import { createSignal } from "solid-js";
import { computersApi, logToMain } from "./shell";
import { errorMessage } from "./errorMessage";

/**
 * Whether a paired computer answers, for the dialogs that offer to try it
 * again. A newer check, or a reset, makes an older one's answer moot. A
 * check that finds the computer resolves true; reconnecting to it is the
 * caller's, and the same for every dialog.
 */
export function createReachCheck() {
    const [checking, setChecking] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    let request = 0;

    const check = async (computer: { host: string; port: number }): Promise<boolean> => {
        const mine = ++request;
        setChecking(true);
        setError(null);
        try {
            const probe = await computersApi.probe(computer.host, computer.port);
            if (mine !== request) return false;
            if (probe?.reachable) return true;
            setError(probe?.error || "Unreachable");
        } catch (err) {
            logToMain("error", "Checking a computer failed:", err);
            if (mine === request) setError(errorMessage(err));
        } finally {
            // only the newest check may clear the busy flag
            if (mine === request) setChecking(false);
        }
        return false;
    };

    /** drops a check still out, and shows `shown` as the last answer */
    const reset = (shown: string | null) => {
        request++;
        setChecking(false);
        setError(shown);
    };

    return { checking, error, check, reset };
}
