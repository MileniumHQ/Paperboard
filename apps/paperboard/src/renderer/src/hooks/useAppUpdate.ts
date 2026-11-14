import { createSignal, onMount, onCleanup } from "solid-js";
import { showToast } from "@mileniumhq/paperui";
import { initialAppUpdateState, type AppUpdateState } from "../../../shared/appUpdate";
import { errorMessage } from "../lib/errorMessage";
import { isBrowserShell, shellIpc } from "../lib/shell";

/** looks for updates to everything now; the top bar lists what it finds and says each failure, a toast says a check that didn't start */
export const checkForUpdates = () =>
    shellIpc()
        .invoke<void>("update-check")
        .catch((err) => showToast({ variant: "danger", title: "Couldn't check for updates", message: errorMessage(err) }));

export function useAppUpdate() {
    const [state, setState] = createSignal<AppUpdateState>({ ...initialAppUpdateState });
    const [open, setOpen] = createSignal(false);
    onMount(() => {
        if (isBrowserShell()) return;
        const ipc = shellIpc();
        let disposed = false;
        const accept = (next: AppUpdateState) => {
            if (disposed || next.revision < state().revision) return;
            if ((next.status === "failed" || next.status === "manual") && state().status !== next.status) setOpen(true);
            setState(next);
        };
        const handler = (_: unknown, next: AppUpdateState) => accept(next);
        ipc.on("app-update-state", handler);
        onCleanup(() => {
            disposed = true;
            ipc.removeListener("app-update-state", handler);
        });
        void ipc.invoke<AppUpdateState>("app-update-state").then(accept).catch((err) => {
            if (disposed) return;
            accept({ ...state(), status: "failed", error: `Could not read update status: ${errorMessage(err)}` });
        });
    });
    return { state, open, setOpen };
}
