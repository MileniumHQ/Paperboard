import { createSignal, onMount } from "solid-js";
import { initialAppUpdateState, type AppUpdateState } from "../../../shared/appUpdate";
import { isBrowserShell, shellIpc, subscribeRevisioned } from "../lib/shell";
import { errorMessage } from "@mileniumhq/paperapi";

/** looks for updates to everything now, and resolves with what that came to; the top bar lists each update as it runs */
export const checkForUpdates = () => shellIpc().invoke("update-check");

export function useAppUpdate() {
    const [state, setState] = createSignal<AppUpdateState>({ ...initialAppUpdateState });
    const [open, setOpen] = createSignal(false);
    onMount(() => {
        if (isBrowserShell()) return;
        const accept = (next: AppUpdateState) => {
            if ((next.status === "failed" || next.status === "manual") && state().status !== next.status) setOpen(true);
            setState(next);
        };
        const ipc = shellIpc();
        subscribeRevisioned(() => ipc.invoke("app-update-state"), (listener) => ipc.on("app-update-state", listener), state, accept, (err) =>
            accept({ ...state(), status: "failed", error: `Could not read update status: ${errorMessage(err)}` }),
        );
    });
    return { state, open, setOpen };
}
