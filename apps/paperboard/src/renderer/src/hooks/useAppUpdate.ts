import { createSignal, onMount, onCleanup } from "solid-js";
import { initialAppUpdateState, type AppUpdateState } from "../../../shared/appUpdate";
import { isBrowserShell, shellIpc } from "../lib/shell";

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
            accept({ ...state(), status: "failed", error: `Could not read update status: ${String(err)}` });
        });
    });
    return { state, open, setOpen };
}
