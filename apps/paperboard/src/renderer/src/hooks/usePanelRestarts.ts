import { createEffect, createMemo, createSignal, on, type Setter } from "solid-js";
import { panelsApi } from "@mileniumhq/paperapi";
import { logToMain } from "../lib/shell";
import type { RestartState } from "../components/panels/PanelView";
import type { useUpdateQueue } from "./useUpdateQueue";

export interface PanelRestartsOptions {
    updateQueue: ReturnType<typeof useUpdateQueue>;
    setReloadTokens: Setter<Record<string, number>>;
    /** shows the panel's tab, as a restart does */
    setComputerTab: (computerId: string, panelId: string) => void;
    /** a panel holding unsaved work has its say first; false when it chose to stay */
    mayClosePanels: (keys: string[]) => Promise<boolean>;
    refreshPanelsForComputer: (computerId: string) => Promise<void>;
}

// What takes an open panel's page away and brings it back, by
// `computerId::panelId`: a restart of its service, and an update of the
// panel installing. Each is shown in the panel's own frame while it runs;
// once it is done the page loads again.
export function usePanelRestarts(options: PanelRestartsOptions) {
    // bumping a panel's token is how its page loads again: PanelView's frame
    // reloads its document whenever its own token changes
    const bumpReloadToken = (key: string) => {
        options.setReloadTokens((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
    };

    const [restartStates, setRestartStates] = createSignal<Record<string, RestartState>>({});
    const setRestartState = (key: string, state: RestartState | null) =>
        setRestartStates((prev) => {
            const next = { ...prev };
            if (state) next[key] = state;
            else delete next[key];
            return next;
        });

    const restartPanel = async (compId: string, panelId: string, name: string) => {
        const key = `${compId}::${panelId}`;
        if (restartStates()[key]?.kind === "restarting") return;
        if (!(await options.mayClosePanels([key]))) return;
        options.setComputerTab(compId, panelId);
        setRestartState(key, { kind: "restarting" });
        try {
            // false = no service declared; reloading the view is the restart
            await panelsApi.restartService(panelId, compId);
            setRestartState(key, null);
            bumpReloadToken(key);
        } catch (err) {
            logToMain("error", "Failed to restart panel:", err);
            setRestartState(key, {
                kind: "failed",
                message: `Couldn't restart ${name}${err instanceof Error && err.message ? `: ${err.message}` : ""}`,
            });
        }
    };

    // a panel whose new release is installing can't be opened; once it is
    // in place (or the previous one is back) its view loads again
    const updatingPanels = createMemo(
        () =>
            new Set(
                options.updateQueue
                    .state()
                    .items.filter((item) => item.kind === "panel" && item.status === "running" && item.panelId)
                    .map((item) => `${item.computerId}::${item.panelId}`),
            ),
    );
    const panelUpdateSeen = new Map<string, string>();
    createEffect(
        on(options.updateQueue.state, (state) => {
            for (const item of state.items) {
                if (item.kind !== "panel" || !item.panelId) continue;
                const key = `${item.computerId}::${item.panelId}`;
                const before = panelUpdateSeen.get(item.key);
                panelUpdateSeen.set(item.key, item.status);
                if (before === item.status) continue;
                if (item.status === "running") {
                    setRestartState(key, { kind: "updating" });
                } else if (before === "running") {
                    setRestartState(key, null);
                    // held: nothing was replaced, the running release stays as it is
                    if (item.status === "held") continue;
                    bumpReloadToken(key);
                    void options.refreshPanelsForComputer(item.computerId);
                }
            }
        }),
    );

    return { restartStates, setRestartState, restartPanel, bumpReloadToken, updatingPanels };
}
