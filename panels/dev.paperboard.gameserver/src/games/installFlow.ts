import { createSignal } from "solid-js";
import { errorMessage } from "../lib/failure";

/**
 * What every game's install shares, as setup and Versions show it: whether
 * it is running, whether it has installed, and the failure to quote. run()
 * resolves true once `work` has finished; the game's own rows read the
 * signals and whatever progress its `work` reports.
 */
export function createInstallFlow() {
    const [error, setError] = createSignal("");
    const [installed, setInstalled] = createSignal(false);
    const [running, setRunning] = createSignal(false);

    const run = async (work: () => Promise<void>): Promise<boolean> => {
        setError("");
        setInstalled(false);
        setRunning(true);
        try {
            await work();
            setInstalled(true);
            return true;
        } catch (err) {
            console.error("[Install] Install failed:", err);
            setError(errorMessage(err));
            return false;
        } finally {
            setRunning(false);
        }
    };

    return { error, installed, running, run, reset: () => setError("") };
}
