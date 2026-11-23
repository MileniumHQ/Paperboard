// The server a page is open on. App makes one ServerPage for the server it
// shows and hands it down through ServerContext; switching servers makes
// another and drops this one with everything it owns, so nothing of one
// server's page can reach the next.
import { createStateSignal, showError } from "@mileniumhq/paperui/headless";
import { createContext, onCleanup, useContext, type Accessor } from "solid-js";
import { callsFor, filesFor, portsFor, serverStates, type ServerCalls, fileApi, portApi } from "./api";
import { errorMessage } from "./failure";
import type { ServerSummary } from "../service";
import type { GameServerState } from "../service/types";
import type { PlayerPosition, PlayerStatData } from "../core/players";
import { serverFields, type Fields } from "../core/state";
import type { ChatMessage as CoreChatMessage, ServerStatus as CoreServerStatus } from "../core/state";

export type ServerStatus = CoreServerStatus;
export interface ChatMessage extends CoreChatMessage {}
export { getStatusBadge } from "../core/statusBadge";

/** The server's state, a field each, and the players' as sets and maps by name. */
export interface ServerPage extends Omit<Fields, "playerStats" | "playerPositions"> {
    readonly id: string;
    /** what the servers list says of it; App's view of it ends before it is removed */
    readonly summary: Accessor<ServerSummary>;
    readonly calls: ServerCalls;
    /** the server's files: every path is inside its folder */
    readonly files: typeof fileApi;
    readonly ports: typeof portApi;
    /** true once its state has been read: nothing of the page shows before */
    readonly loaded: Accessor<boolean>;
    /** reads its state again; rejects with why it could not */
    refresh(): Promise<void>;
    /** a change the page knows of before the service pushes it */
    patch(change: Partial<GameServerState>): void;
    readonly onlinePlayerNames: Accessor<ReadonlySet<string>>;
    readonly seenPlayerNames: Accessor<ReadonlySet<string>>;
    readonly playerStats: Accessor<ReadonlyMap<string, PlayerStatData>>;
    readonly playerPositions: Accessor<ReadonlyMap<string, PlayerPosition>>;
    /** the service reloads the server's config, once the server is set up; a failure is a toast */
    loadServerConfig(): Promise<void>;
    updatePanelConfig(patch: Record<string, unknown>): Promise<void>;
    startServer(): void;
    stopServer(): void;
    restartServer(): void;
}

/**
 * The server `summary` names, for its page: its calls and files, and its
 * state as the service pushes it. Made inside the view that shows it, which
 * owns it. Every push is a fresh copy of the whole state; the state keeps
 * what did not change (createStateSignal), and each field is a memo of it,
 * so a push that says nothing new notifies no one, and one that changes a
 * field notifies only that field's readers.
 */
export function createServerPage(summary: Accessor<ServerSummary>): ServerPage {
    const id = summary().id;
    const calls = callsFor(id);
    const [state, setState] = createStateSignal<GameServerState | null>(null);
    const read = async () => {
        const next = await serverStates.read(id);
        if (!next) throw new Error("Choose a server that has not been removed");
        setState(next);
    };
    // a push before the read is in: the read answers with it (the keyed state's read hears it)
    onCleanup(
        serverStates.follow(id)((next) => {
            if (next) setState(next);
        }),
    );
    // a start, stop or restart that was refused says why
    const lifecycle = (title: string, run: () => Promise<unknown>) => () => {
        run().catch((err) => showError(title, errorMessage(err)));
    };
    const fields = serverFields(state);
    // what blocks the whole server stands where it is started (RecoveryNotice), with the way out
    return {
        ...fields,
        id,
        summary,
        calls,
        files: filesFor(summary),
        ports: portsFor(summary),
        loaded: () => state() !== null,
        refresh: read,
        patch: (change) => setState((prev) => (prev ? { ...prev, ...change } : prev)),
        loadServerConfig: async () => {
            // a server that isn't set up has no config to load: RecoveryNotice says why
            if (fields.initFailure() !== null) return;
            try {
                await calls.loadConfig();
                await read();
            } catch (err) {
                showError("Couldn't load the server's settings", errorMessage(err));
            }
        },
        updatePanelConfig: async (patch) => {
            await calls.updatePanelConfig({ patch });
            await read();
        },
        startServer: lifecycle("Couldn't start the server", () => calls.startServer()),
        stopServer: lifecycle("Couldn't stop the server", () => calls.stopServer()),
        restartServer: lifecycle("Couldn't restart the server", () => calls.restartServer()),
    };
}

export const ServerContext = createContext<ServerPage>();

/** The server the page is open on; only a server's own view has one. */
export function useServer(): ServerPage {
    const server = useContext(ServerContext);
    if (!server) throw new Error("This part of the page belongs to a server's page, and none is open");
    return server;
}
