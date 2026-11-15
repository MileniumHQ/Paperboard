import { createSignal, onMount } from "solid-js";
import { showToast } from "@mileniumhq/paperui";
import { initialUpdateQueueState, type UpdateItem, type UpdateQueueState } from "../../../shared/updateQueue";
import { isBrowserShell, shellIpc, subscribeRevisioned } from "../lib/shell";
import { errorMessage } from "@mileniumhq/paperapi";

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
            showToast({ variant: "danger", title: "Couldn't check for updates", message: next.checkError });
        }
        lastCheckError = next.checkError;
        if (next.holdsError && next.holdsError !== lastHoldsError) {
            showToast({ variant: "danger", title: "Couldn't read the updates waiting to install", message: next.holdsError });
        }
        lastHoldsError = next.holdsError;
    };

    onMount(() => {
        // browser mode runs no updates: they happen when Paperboard next runs as a window
        if (isBrowserShell()) return;
        subscribeRevisioned<UpdateQueueState>(
            "update-queue",
            state,
            (next) => {
                tellFailures(next);
                setState(next);
            },
            (err) => showToast({ variant: "danger", title: "Couldn't read the update list", message: errorMessage(err) }),
        );
    });

    /** Stop and update, for held updates on one computer: rejects with why it could not run */
    const release = (keys: string[]) => shellIpc().invoke<void>("update-release", { keys });

    return { state, release };
}
