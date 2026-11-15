// One widget frame's view of the Game Server service. The bridge exists only
// while the widget can be seen: hidden, it is disposed and nothing arrives;
// shown again, it re-reads the state. "unavailable" is the service failing to
// answer, never an empty server.
import { createStateSignal, createLatest } from "@mileniumhq/paperui";
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createPanelBridge, serviceApi, type WidgetContext } from "@mileniumhq/paperapi";
import { gameFor } from "../games";
import { serverStateOf } from "../servers";
import { CALLS, PANEL_ID } from "../service/contract";
import type { ServersState } from "../service";
import type { GameServerState } from "../service/types";
import { errorMessage } from "../lib/failure";

/** the last log lines a widget keeps; the console tail shows two */
export const TAIL_ENTRIES = 4;

export type ServerView = Pick<
    GameServerState,
    | "serverStatus"
    | "serverSoftware"
    | "serverVersion"
    | "onlinePlayers"
    | "serverMotd"
    | "serverEntries"
    | "localIp"
    | "serverPort"
    | "activeIssue"
    | "maxPlayers"
> & {
    supportsPlayers: boolean;
    softwareLabel: string;
    /** the game draws its players' heads (get-player-skin), else a plain figure */
    heads: boolean;
    /** the game's file of names as typed, when it lists players in lower case */
    nameBook?: string;
};

export type Connection =
    | { phase: "loading" }
    | { phase: "ready"; server: ServerView }
    | { phase: "unavailable"; message: string };

/** The option is explicit; only widgets from before several servers use the legacy server. */
export function selectedWidgetServer(state: ServersState, option: string | undefined, widgetId?: string): { id: string; view: ServerView } {
    if (state.serversError) throw new Error(state.serversError);
    const id = option || state.legacyServer;
    const server = state.servers.find((s) => s.id === id);
    if (!server) throw new Error("No server is chosen, or it was removed. Choose a Server in the widget options.");
    const game = gameFor(server.game);
    const snapshot = serverStateOf(state, server.id);
    const options = { software: snapshot.serverSoftware, version: snapshot.serverVersion, settings: snapshot.gameSettings };
    const features = game.describe(options);
    if (widgetId && !features.widgets.includes(widgetId)) throw new Error(`${game.name} does not support the ${widgetId} widget`);
    return {
        id: server.id,
        view: {
            serverStatus: snapshot.serverStatus,
            serverSoftware: snapshot.serverSoftware,
            serverVersion: snapshot.serverVersion,
            onlinePlayers: snapshot.onlinePlayers,
            maxPlayers: snapshot.maxPlayers,
            serverMotd: snapshot.serverMotd,
            serverEntries: snapshot.serverEntries.slice(-TAIL_ENTRIES),
            localIp: snapshot.localIp,
            serverPort: snapshot.serverPort,
            activeIssue: snapshot.activeIssue,
            supportsPlayers: features.widgets.includes("players"),
            softwareLabel: game.softwareLabel(options),
            heads: features.calls.includes(CALLS.getPlayerSkin),
            nameBook: features.nameBook,
        },
    };
}

export interface WidgetServer {
    connection: Accessor<Connection>;
    visible: Accessor<boolean>;
    retry(): void;
    /** calls one of the chosen server's calls; rejects when the widget is hidden */
    call<R = unknown>(name: string, input?: Record<string, unknown>): Promise<R>;
}

/** Must run inside a Solid root: it cleans up with it. */
export function useWidgetServer(widget: WidgetContext): WidgetServer {
    const [visible, setVisible] = createSignal(widget.visible());
    // every server's activity is pushed to every widget: a push that leaves
    // this widget's view as it was keeps the view, and the widget stays put
    const [connection, setConnection] = createStateSignal<Connection>({ phase: "loading" });
    // what a bridge reports counts only while it is the open one
    let bridge: ReturnType<typeof createPanelBridge<ServersState>> | null = null;

    const close = () => {
        bridge?.dispose();
        bridge = null;
    };

    let chosen: string | null = null;
    const project = (state: ServersState): ServerView => {
        const selected = selectedWidgetServer(state, widget.options.server, widget.widgetId);
        chosen = selected.id;
        return selected.view;
    };
    // a retry replaces the read before it
    const latest = createLatest();
    const refresh = () => {
        const current = bridge;
        if (!current) return;
        const newest = latest();
        current
            .refreshState()
            .then((answer) => {
                if (newest() && bridge === current) setConnection({ phase: "ready", server: project(answer) });
            })
            .catch((err) => {
                if (newest() && bridge === current) setConnection({ phase: "unavailable", message: errorMessage(err) });
            });
    };

    const open = () => {
        close();
        const next = createPanelBridge<ServersState>({ panelId: PANEL_ID });
        bridge = next;
        // pushes before the first full read are partial; wait for it
        next.onStateChange((_patch, full) => {
            if (bridge === next && next.getStatus().ready) {
                try { setConnection({ phase: "ready", server: project(full) }); }
                catch (err) { setConnection({ phase: "unavailable", message: errorMessage(err) }); }
            }
        });
        refresh();
    };

    const sync = (shown: boolean) => {
        setVisible(shown);
        if (shown) open();
        else close();
    };
    const off = widget.onVisibilityChange(sync);
    sync(widget.visible());
    onCleanup(() => {
        off();
        close();
    });

    return {
        connection,
        visible,
        retry: () => {
            if (!bridge) return;
            setConnection({ phase: "loading" });
            refresh();
        },
        call: <R,>(name: string, input?: Record<string, unknown>) =>
            bridge && chosen ? serviceApi.call<R>(PANEL_ID, name, { ...input, server: chosen }) : Promise.reject(new Error("Choose a server in the widget options")),
    };
}
