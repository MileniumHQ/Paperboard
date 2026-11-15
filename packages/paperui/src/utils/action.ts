import { createSignal, type Accessor } from "solid-js";
import { errorMessage } from "./errorMessage";

/** An action that didn't happen, as a view shows it: what didn't happen, and why. */
export interface ActionFailure {
    /** the action that didn't happen, such as "Server not removed" */
    title: string;
    /** the failure's own words */
    message: string;
}

export interface Action {
    /** a run is going */
    busy: Accessor<boolean>;
    /** why the last run failed, until the next one starts */
    error: Accessor<ActionFailure | null>;
    setError: (failure: ActionFailure | null) => void;
    /**
     * Runs `fn`, busy until it settles. A failure becomes `{ title, message }`
     * in `error`, or in `setFailure` when the run shows it somewhere else (a
     * confirmation that stays open). Resolves whether `fn` went through;
     * never rejects.
     */
    run: (title: string, fn: () => Promise<unknown>, setFailure?: (failure: ActionFailure | null) => void) => Promise<boolean>;
}

/** An action a button starts: busy while it runs, and its own error when it didn't happen. Make one per action. */
export function createAction(): Action {
    const [running, setRunning] = createSignal(0);
    const [error, setError] = createSignal<ActionFailure | null>(null);
    const run: Action["run"] = async (title, fn, setFailure = setError) => {
        setRunning((n) => n + 1);
        setFailure(null);
        try {
            await fn();
            return true;
        } catch (err) {
            setFailure({ title, message: errorMessage(err) });
            return false;
        } finally {
            setRunning((n) => n - 1);
        }
    };
    return { busy: () => running() > 0, error, setError, run };
}
