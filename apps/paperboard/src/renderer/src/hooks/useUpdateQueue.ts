import { createSignal, onMount, onCleanup } from "solid-js";
import { showToast } from "@mileniumhq/paperui";
import { initialUpdateQueueState, type UpdateItem, type UpdateQueueState } from "../../../shared/updateQueue";
import { isBrowserShell, shellIpc } from "../lib/shell";

/** where an update ran, for messages: "" on this computer */
export function updateWhere(item: { computerName: string | null }): string {
    return item.computerName ? ` on ${item.computerName}` : "";
}

/**
 * The update queue main runs: what is updating, what is held back, and
 * Stop and update. A failure is said in a toast as it happens.
 */
export function useUpdateQueue() {
    const [state, setState] = createSignal<UpdateQueueState>({ ...initialUpdateQueueState });
    // what each item was when last seen, so a failure is told once
    const seen = new Map<string, UpdateItem["status"]>();
    let lastCheckError: string | null = null;

    const tellFailures = (next: UpdateQueueState) => {
        for (const item of next.items) {
            if (item.status === "failed" && seen.get(item.key) !== "failed") {
                showToast({
                    variant: "danger",
                    title: `${item.name} couldn't update${updateWhere(item)}`,
                    message: item.error ?? undefined,
                });
            }
            seen.set(item.key, item.status);
        }
        if (next.checkError && next.checkError !== lastCheckError) {
            showToast({ variant: "danger", title: "Couldn't check for updates", message: next.checkError });
        }
        lastCheckError = next.checkError;
    };

    onMount(() => {
        // browser mode runs no updates: they happen when Paperboard next runs as a window
        if (isBrowserShell()) return;
        const ipc = shellIpc();
        let disposed = false;
        const accept = (next: UpdateQueueState) => {
            if (disposed || next.revision < state().revision) return;
            tellFailures(next);
            setState(next);
        };
        const handler = (_: unknown, next: UpdateQueueState) => accept(next);
        ipc.on("update-queue", handler);
        onCleanup(() => {
            disposed = true;
            ipc.removeListener("update-queue", handler);
        });
        void ipc.invoke<UpdateQueueState>("update-queue").then(accept).catch((err) => {
            if (disposed) return;
            showToast({ variant: "danger", title: "Couldn't read the update list", message: String(err) });
        });
    });

    /** Stop and update, for held updates on one computer: rejects with why it could not run */
    const release = (keys: string[]) => shellIpc().invoke<void>("update-release", { keys });

    return { state, release };
}
