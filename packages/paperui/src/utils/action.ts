import { createSignal, type Accessor } from "solid-js";
import { errorMessage } from "./errorMessage";
import { dismissToast, showError } from "./toasts";

/** An action that didn't happen, as a view shows it: what didn't happen, and why. */
export interface ActionFailure {
    /** the action that didn't happen, such as "Couldn't remove the server" */
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
     * Runs `fn`, busy until it settles. A failure is a danger toast titled
     * `title`, saying why, and it closes once a run of the same title goes
     * through. Resolves whether `fn` went through; never rejects.
     */
    run: (title: string, fn: () => Promise<unknown>) => Promise<boolean>;
}

export interface ActionOptions {
    /**
     * A failure's words, as the view shows them (default its own message).
     * A panel whose failures carry codes says them as sentences here, such as
     * EACCES as "Paperboard isn't allowed to open server.properties".
     */
    message?: (err: unknown) => string;
    /**
     * Whether a failure is a toast (default true). False keeps it only in
     * `error`, for a view that says it in place: a field's error, a
     * widget's own message.
     */
    toast?: boolean;
}

/** An action a button starts: busy while it runs, and a toast when it didn't happen. Make one per action. */
export function createAction(options: ActionOptions = {}): Action {
    const message = options.message ?? errorMessage;
    const [running, setRunning] = createSignal(0);
    const [error, setError] = createSignal<ActionFailure | null>(null);
    // the toast of each title's last failure
    const failed = new Map<string, string>();
    const run: Action["run"] = async (title, fn) => {
        setRunning((n) => n + 1);
        setError(null);
        try {
            await fn();
            const toast = failed.get(title);
            failed.delete(title);
            if (toast) dismissToast(toast);
            return true;
        } catch (err) {
            const words = message(err);
            setError({ title, message: words });
            if (options.toast ?? true) failed.set(title, showError(title, words));
            return false;
        } finally {
            setRunning((n) => n - 1);
        }
    };
    return { busy: () => running() > 0, error, setError, run };
}
