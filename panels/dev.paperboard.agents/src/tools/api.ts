// The Tools page's one line to the service. The service validates and owns
// everything; this keeps the latest view it sent (by call or by event) and
// passes the user's changes on. Secret values go to the service's vault
// action and are never kept here.

import { actionsApi, errorMessage } from "@mileniumhq/paperapi";
import { createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { PANEL_ID } from "../contract";
import { TOOLS_ACTION_IDS, TOOLS_EVENT, type ServerSpec, type ToolsView } from "../toolsContract";

export type ToolsLoad = "loading" | "ready" | "failed";

// One client is shared by everything on screen that reads the tools (the
// Tools page and each sign-in card in the chat): one read, one event
// subscription. The last one to go away closes it.
function openTools() {
    // the view is a store reconciled by server name, so a new answer changes
    // what differs and every server row stays the row it was
    const [state, setState] = createStore<{ view: ToolsView | null }>({ view: null });
    const [load, setLoad] = createSignal<ToolsLoad>("loading");
    const [loadError, setLoadError] = createSignal<string | null>(null);
    const view = () => state.view;
    const setView = (next: ToolsView) => setState("view", reconcile(next, { key: "name" }));

    const call = async (id: string, inputs: Record<string, unknown> = {}) => {
        const next = await actionsApi.call<ToolsView>(PANEL_ID, id, inputs);
        setView(next);
        return next;
    };

    // status changes (a server starting, failing, stopping) arrive as events
    const off = actionsApi.on(PANEL_ID, TOOLS_EVENT, (next: ToolsView) => setView(next));

    const refresh = async () => {
        setLoad("loading");
        setLoadError(null);
        try {
            await call(TOOLS_ACTION_IDS.get);
            setLoad("ready");
        } catch (e) {
            setLoadError(errorMessage(e));
            setLoad("failed");
        }
    };
    // the first read, settled either way (a failure is in load and loadError)
    const first = refresh();

    return {
        close: off,
        first,
        view,
        load,
        loadError,
        refresh,
        save: (server: ServerSpec) => call(TOOLS_ACTION_IDS.save, { server }),
        remove: (name: string) => call(TOOLS_ACTION_IDS.remove, { name }),
        restart: (name: string) => call(TOOLS_ACTION_IDS.restart, { name }),
        setActions: (on: boolean) => call(TOOLS_ACTION_IDS.setActions, { on }),
        setSecret: (server: string, name: string, value: string) => call(TOOLS_ACTION_IDS.setSecret, { server, name, value }),
        signIn: (name: string) => call(TOOLS_ACTION_IDS.signIn, { name }),
        finishSignIn: (name: string, address: string) => call(TOOLS_ACTION_IDS.signInFinish, { name, address }),
        cancelSignIn: (name: string) => call(TOOLS_ACTION_IDS.signInCancel, { name }),
    };
}

let shared: ReturnType<typeof openTools> | null = null;
let users = 0;

export function createTools() {
    if (!shared) shared = openTools();
    // a read that failed for the one before is tried again for this one
    else if (shared.load() === "failed") void shared.refresh();
    const client = shared;
    users++;
    onCleanup(() => {
        if (--users > 0) return;
        client.close();
        shared = null;
    });
    return client;
}

export type Tools = ReturnType<typeof createTools>;
