import { createSignal, onMount } from "solid-js";
import { showToast } from "@mileniumhq/paperui";
import { initialAppUpdateState, type AppUpdateState } from "../../../shared/appUpdate";
import { isBrowserShell, shellIpc, subscribeRevisioned } from "../lib/shell";
import { errorMessage } from "@mileniumhq/paperapi";

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
        const accept = (next: AppUpdateState) => {
            if ((next.status === "failed" || next.status === "manual") && state().status !== next.status) setOpen(true);
            setState(next);
        };
        subscribeRevisioned("app-update-state", state, accept, (err) =>
            accept({ ...state(), status: "failed", error: `Could not read update status: ${errorMessage(err)}` }),
        );
    });
    return { state, open, setOpen };
}
