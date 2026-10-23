// The Tools page's one line to the service. The service validates and owns
// everything; this keeps the latest view it sent (by call or by event) and
// passes the user's changes on. Secret values go to the service's vault
// action and are never kept here.

import { actionsApi } from "@mileniumhq/paperapi";
import { createSignal, onCleanup } from "solid-js";
import { PANEL_ID } from "../contract";
import { TOOLS_ACTION_IDS, TOOLS_EVENT, type ServerSpec, type ToolsView } from "../toolsContract";

export type ToolsLoad = "loading" | "ready" | "failed";

export function createTools() {
    const [view, setView] = createSignal<ToolsView | null>(null);
    const [load, setLoad] = createSignal<ToolsLoad>("loading");
    const [loadError, setLoadError] = createSignal<string | null>(null);

    const call = async (id: string, inputs: Record<string, unknown> = {}) => {
        const next = await actionsApi.call<ToolsView>(PANEL_ID, id, inputs);
        setView(next);
        return next;
    };

    // status changes (a server starting, failing, stopping) arrive as events
    const off = actionsApi.on(PANEL_ID, TOOLS_EVENT, (next: ToolsView) => setView(next));
    onCleanup(() => off());

    const refresh = async () => {
        setLoad("loading");
        setLoadError(null);
        try {
            await call(TOOLS_ACTION_IDS.get);
            setLoad("ready");
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : String(e));
            setLoad("failed");
        }
    };
    void refresh();

    return {
        view,
        load,
        loadError,
        refresh,
        save: (server: ServerSpec) => call(TOOLS_ACTION_IDS.save, { server }),
        remove: (name: string) => call(TOOLS_ACTION_IDS.remove, { name }),
        restart: (name: string) => call(TOOLS_ACTION_IDS.restart, { name }),
        setActions: (on: boolean) => call(TOOLS_ACTION_IDS.setActions, { on }),
        setSecret: (server: string, name: string, value: string) => call(TOOLS_ACTION_IDS.setSecret, { server, name, value }),
        deleteSecret: (server: string, name: string) => call(TOOLS_ACTION_IDS.deleteSecret, { server, name }),
    };
}

export type Tools = ReturnType<typeof createTools>;
