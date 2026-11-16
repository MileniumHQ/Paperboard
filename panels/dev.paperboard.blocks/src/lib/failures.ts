// What a person started that didn't happen, said as a toast, and closed
// again once the same thing goes through: a save that works after one that
// didn't leaves no word that it failed.
import { dismissToast, showError } from "@mileniumhq/paperui";

export function createFailures() {
    // the toast showing for each title
    const shown = new Map<string, string>();
    return {
        /** says why `title` didn't happen; a repeat lands in the same toast */
        fail: (title: string) => (err: unknown) => void shown.set(title, showError(title, err)),
        /** what these titles named has worked since: their toasts close */
        worked: (...titles: string[]) => {
            for (const title of titles) {
                const id = shown.get(title);
                if (id) dismissToast(id);
                shown.delete(title);
            }
        },
    };
}
