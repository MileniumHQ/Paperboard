// The Tools page's one line to the service. The service validates and owns
// everything; this keeps the latest view it sent (by call or by event) and
// passes the user's changes on. Secret values go to the service's vault
// call and are never kept here.

import { errorMessage, serviceClient } from "@mileniumhq/paperapi";
import { createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { agentsContract } from "../contract";
import type { ServerSpec, ToolsView } from "../toolsContract";

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

    const { calls, events } = serviceClient(agentsContract);
    // every call answers with the whole view
    const viewOf = async (answer: Promise<ToolsView>) => {
        const next = await answer;
        setView(next);
        return next;
    };

    // status changes (a server starting, failing, stopping) arrive as events
    const off = events.tools(setView);

    const refresh = async () => {
        setLoad("loading");
        setLoadError(null);
        try {
            await viewOf(calls.tools());
            setLoad("ready");
        } catch (e) {
            setLoadError(errorMessage(e));
            setLoad("failed");
        }
    };
    // the first read, settled either way (a failure is in load and loadError, said where the tools are shown)
    const first = refresh();

    return {
        close: off,
        first,
        view,
        load,
        loadError,
        refresh,
        /** tools.json read again by the service; a file that still can't be read is in the view's configError */
        readFile: () => viewOf(calls.readToolsFile()),
        save: (server: ServerSpec) => viewOf(calls.saveServer({ server })),
        remove: (name: string) => viewOf(calls.removeServer({ name })),
        restart: (name: string) => viewOf(calls.restartServer({ name })),
        setBlocks: (on: boolean) => viewOf(calls.setBlocks({ on })),
        setSecret: (server: string, name: string, value: string) => viewOf(calls.setSecret({ server, name, value })),
        signIn: (name: string) => viewOf(calls.signInServer({ name })),
        finishSignIn: (name: string, address: string) => viewOf(calls.finishServerSignIn({ name, address })),
        cancelSignIn: (name: string) => viewOf(calls.cancelServerSignIn({ name })),
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
