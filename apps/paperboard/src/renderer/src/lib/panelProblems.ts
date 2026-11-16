import { createEffect, on, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { showError } from "@mileniumhq/paperui";
import { problemsApi, type PanelProblem } from "@mileniumhq/paperapi";
import { logToMain } from "./shell";

/**
 * Every panel's problems on a computer, followed while `listed` holds (its
 * panels are listed, so it is reachable). Each panel's list keeps its rows
 * by key, so a repeat that replaces one updates its row in place.
 */
export function followPanelProblems(computerId: string, computerName: () => string, listed: () => boolean): (panelId: string) => PanelProblem[] {
    const [problems, setProblems] = createStore<Record<string, PanelProblem[]>>({});
    createEffect(on(listed, (reachable) => {
        if (!reachable) return;
        const off = problemsApi.watchEvery(
            (byPanel) => setProblems(reconcile(byPanel, { key: "key", merge: true })),
            (err) => {
                logToMain("error", `Couldn't read the panels' problems on ${computerId}:`, err);
                showError(`Couldn't read what went wrong with ${computerName()}'s panels`, err);
            },
            computerId,
        );
        onCleanup(off);
    }));
    return (panelId) => problems[panelId] ?? [];
}
