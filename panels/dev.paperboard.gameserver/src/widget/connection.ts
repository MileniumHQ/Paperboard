// One widget frame's view of the Game Server service. The client exists only
// while the widget can be seen: hidden, it is closed and nothing arrives;
// shown again, it re-reads the servers and the chosen server's state. Only
// the chosen server's changes reach it. "unavailable" is the service failing
// to answer, never an empty server.
import { createStateSignal, createLatest } from "@mileniumhq/paperui/headless";
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { serviceClient, type ServiceCalls, type ServiceClient, type WidgetContext } from "@mileniumhq/paperapi";
import { gameFor } from "../games";
import { joinPort } from "../core/portNames";
import { gameServerContract } from "../service/contract";
import type { ServersState, ServerSummary } from "../service";
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
    /** the server's name, which titles its status */
    name: string;
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

const NOT_CHOSEN = "No server is chosen, or it was removed. Choose a Server in the widget options.";

/** The option is explicit; only widgets from before several servers use the legacy server. */
function chosenServer(state: ServersState, option: string | undefined): ServerSummary {
    if (state.serversError) throw new Error(state.serversError);
    const id = option || state.legacyServer;
    const server = state.servers.find((s) => s.id === id);
    if (!server) throw new Error(NOT_CHOSEN);
    return server;
}

function serverView(server: ServerSummary, snapshot: GameServerState, widgetId: string | undefined): ServerView {
    const game = gameFor(server.game);
    const options = { software: snapshot.serverSoftware, version: snapshot.serverVersion, settings: snapshot.gameSettings };
    const features = game.describe(options);
    if (widgetId && !features.widgets.includes(widgetId)) throw new Error(`${game.name} does not support the ${widgetId} widget`);
    return {
        name: server.name,
        serverStatus: snapshot.serverStatus,
        serverSoftware: snapshot.serverSoftware,
        serverVersion: snapshot.serverVersion,
        onlinePlayers: snapshot.onlinePlayers,
        maxPlayers: snapshot.maxPlayers,
        serverMotd: snapshot.serverMotd,
        serverEntries: snapshot.serverEntries.slice(-TAIL_ENTRIES),
        localIp: snapshot.localIp,
        serverPort: joinPort(snapshot),
        activeIssue: snapshot.activeIssue,
        supportsPlayers: features.widgets.includes("players"),
        softwareLabel: game.softwareLabel(options),
        heads: features.calls.includes("getPlayerSkin"),
        nameBook: features.nameBook,
    };
}

export interface WidgetServer {
    connection: Accessor<Connection>;
    visible: Accessor<boolean>;
    retry(): void;
    /** runs one of the chosen server's calls; rejects when the widget is hidden */
    call<R>(run: (calls: ServiceCalls<typeof gameServerContract>) => Promise<R>): Promise<R>;
}

/** The widget's open client, and what it has heard of the chosen server. */
interface Session {
    client: ServiceClient<typeof gameServerContract, "unscoped">;
    /** the server whose state it follows */
    chosen: string | null;
    snapshot: GameServerState | undefined;
    /** whether a read has landed: pushes before it are not a whole view */
    loaded: boolean;
    offServer: (() => void) | null;
    offState: () => void;
}

/** Must run inside a Solid root: it cleans up with it. */
export function useWidgetServer(widget: WidgetContext): WidgetServer {
    const [visible, setVisible] = createSignal(widget.visible());
    // a push that leaves this widget's view as it was keeps the view, and the widget stays put
    const [connection, setConnection] = createStateSignal<Connection>({ phase: "loading" });
    // what a client reports counts only while it is the open one
    let open: Session | null = null;

    const close = () => {
        if (!open) return;
        open.offServer?.();
        open.offState();
        open.client.state.dispose();
        open = null;
    };

    const failed = (session: Session, err: unknown) => {
        if (open === session) setConnection({ phase: "unavailable", message: errorMessage(err) });
    };
    // follows one server's state: a change of the chosen server reads again
    const follow = (session: Session, id: string) => {
        if (session.chosen === id) return;
        session.offServer?.();
        session.chosen = id;
        session.snapshot = undefined;
        session.offServer = session.client.keyed.server.follow(id)((snapshot) => {
            session.snapshot = snapshot;
            if (session.loaded) show(session);
        });
    };
    const show = (session: Session) => {
        if (open !== session) return;
        try {
            const server = chosenServer(session.client.state.current(), widget.options.server);
            if (server.id !== session.chosen) {
                refresh();
                return;
            }
            if (!session.snapshot) throw new Error(NOT_CHOSEN);
            setConnection({ phase: "ready", server: serverView(server, session.snapshot, widget.widgetId) });
        } catch (err) {
            failed(session, err);
        }
    };
    // a retry replaces the read before it
    const latest = createLatest();
    const refresh = () => {
        const session = open;
        if (!session) return;
        const newest = latest();
        void (async () => {
            const servers = await session.client.state.refresh();
            follow(session, chosenServer(servers, widget.options.server).id);
            return session.client.keyed.server.read(session.chosen!);
        })().then(
            (snapshot) => {
                if (!newest() || open !== session) return;
                session.snapshot = snapshot;
                session.loaded = true;
                show(session);
            },
            (err) => newest() && failed(session, err),
        );
    };

    const start = () => {
        close();
        const client = serviceClient(gameServerContract);
        const session: Session = { client, chosen: null, snapshot: undefined, loaded: false, offServer: null, offState: () => {} };
        open = session;
        session.offState = client.state.subscribe(() => session.loaded && show(session));
        refresh();
    };

    const sync = (shown: boolean) => {
        setVisible(shown);
        if (shown) start();
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
            if (!open) return;
            setConnection({ phase: "loading" });
            refresh();
        },
        call: (run) =>
            open?.chosen ? run(serviceClient(gameServerContract, { server: open.chosen }).calls) : Promise.reject(new Error("Choose a server in the widget options")),
    };
}
