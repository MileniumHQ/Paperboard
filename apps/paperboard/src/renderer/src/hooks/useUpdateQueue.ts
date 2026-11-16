import { createSignal, onMount } from "solid-js";
import { showError, showToast } from "@mileniumhq/paperui";
import { initialUpdateQueueState, type UpdateItem, type UpdateQueueState } from "../../../shared/updateQueue";
import { isBrowserShell, shellIpc, subscribeRevisioned } from "../lib/shell";

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
    let lastHoldsError: string | null = null;

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
            showError("Couldn't check for updates", next.checkError);
        }
        lastCheckError = next.checkError;
        if (next.holdsError && next.holdsError !== lastHoldsError) {
            showError("Couldn't read the updates waiting to install", next.holdsError);
        }
        lastHoldsError = next.holdsError;
    };

    onMount(() => {
        // browser mode runs no updates: they happen when Paperboard next runs as a window
        if (isBrowserShell()) return;
        const ipc = shellIpc();
        subscribeRevisioned(
            () => ipc.invoke("update-queue"),
            (listener) => ipc.on("update-queue", listener),
            state,
            (next) => {
                tellFailures(next);
                setState(next);
            },
            (err) => showError("Couldn't read the update list", err),
        );
    });

    /** Stop and update, for held updates on one computer: rejects with why it could not run */
    const release = (keys: string[]) => shellIpc().invoke("update-release", { keys });

    return { state, release };
}
