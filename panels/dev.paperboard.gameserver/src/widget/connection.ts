// One widget frame's view of the Game Server service. The bridge exists only
// while the widget can be seen: hidden, it is disposed and nothing arrives;
// shown again, it re-reads the state. "unavailable" is the service failing to
// answer, never an empty server.
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { createPanelBridge, type WidgetContext } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../service/contract";
import type { GameServerState } from "../service/types";

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
> & {
    /** null while unknown: offline, not yet answered, or an older service */
    maxPlayers: number | null;
};

export type Connection =
    | { phase: "loading" }
    | { phase: "ready"; server: ServerView }
    | { phase: "unavailable"; message: string };

export function viewOf(state: Partial<GameServerState>): ServerView {
    return {
        serverStatus: state.serverStatus ?? "offline",
        serverSoftware: state.serverSoftware ?? "paper",
        serverVersion: state.serverVersion ?? "",
        onlinePlayers: Array.isArray(state.onlinePlayers) ? state.onlinePlayers : [],
        maxPlayers: typeof state.maxPlayers === "number" ? state.maxPlayers : null,
        serverMotd: state.serverMotd ?? "",
        serverEntries: Array.isArray(state.serverEntries) ? state.serverEntries.slice(-TAIL_ENTRIES) : [],
        localIp: state.localIp ?? "",
        serverPort: state.serverPort ?? "",
        activeIssue: state.activeIssue ?? null,
    };
}

export interface WidgetServer {
    connection: Accessor<Connection>;
    visible: Accessor<boolean>;
    retry(): void;
    /** calls a Game Server action; rejects when the widget is hidden */
    call<R = unknown>(action: string, ...args: unknown[]): Promise<R>;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Must run inside a Solid root: it cleans up with it. */
export function useWidgetServer(widget: WidgetContext): WidgetServer {
    const [visible, setVisible] = createSignal(widget.visible());
    const [connection, setConnection] = createSignal<Connection>({ phase: "loading" });
    let bridge: ReturnType<typeof createPanelBridge<GameServerState>> | null = null;
    let generation = 0;

    const close = () => {
        generation++;
        bridge?.dispose();
        bridge = null;
    };

    const refresh = () => {
        const mine = generation;
        const current = bridge;
        if (!current) return;
        current
            .refreshState()
            .then((state) => {
                if (mine === generation) setConnection({ phase: "ready", server: viewOf(state) });
            })
            .catch((err) => {
                if (mine === generation) setConnection({ phase: "unavailable", message: messageOf(err) });
            });
    };

    const open = () => {
        close();
        const mine = generation;
        const next = createPanelBridge<GameServerState>({ panelId: PANEL_ID });
        bridge = next;
        // pushes before the first full read are partial; wait for it
        next.onStateChange((_patch, full) => {
            if (mine === generation && next.getStatus().ready) {
                setConnection({ phase: "ready", server: viewOf(full) });
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
        call: <R,>(action: string, ...args: unknown[]) =>
            bridge ? bridge.call<R>(action, ...args) : Promise.reject(new Error("The widget is hidden")),
    };
}
