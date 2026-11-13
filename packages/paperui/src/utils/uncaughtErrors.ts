// What nothing caught is said on the page, never only in the console: a
// throw in an event handler, a rejected promise nobody awaited. Each becomes
// a danger toast, which stays until it is closed. The console still gets it,
// as nothing here prevents the event's default. A failure that repeats (a
// throw on every pointer move) is one toast while it shows. A failure the
// page caught and shows in place never gets here, so it isn't said twice.
import { showToast } from "../components/PaperToast";

const TITLE = "Something went wrong";

function describe(err: unknown): string {
    if (err instanceof Error) return err.message || err.name;
    return String(err);
}

function report(err: unknown): void {
    const message = describe(err);
    showToast({ variant: "danger", title: TITLE, message, key: `uncaught:${message}` });
}

function onError(event: ErrorEvent): void {
    // the browser's own notes (a ResizeObserver that ran over) carry no error
    if (event.error === undefined || event.error === null) return;
    report(event.error);
}

function onRejection(event: PromiseRejectionEvent): void {
    report(event.reason);
}

let installs = 0;

/**
 * Shows the document's uncaught errors and unhandled rejections as toasts;
 * PaperProvider calls it. Returns the matching uninstall.
 */
export function installUncaughtErrors(): () => void {
    if (typeof window === "undefined") return () => undefined;
    if (installs++ === 0) {
        window.addEventListener("error", onError);
        window.addEventListener("unhandledrejection", onRejection);
    }
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        if (--installs > 0) return;
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
    };
}
