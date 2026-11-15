// Each server page is a document of its own. Reloading on selection also
// tears down pending renderer work, so an old dialog cannot edit a new server.
export * from "@mileniumhq/paperapi";
import { sameData } from "@mileniumhq/paperui/headless";
import {
    serviceClient,
    type ServiceCalls,
    fileApi as rawFiles,
    portApi as rawPorts,
} from "@mileniumhq/paperapi";
import {
    serverPortLabel,
    serverPortName,
    JAVA_PORT_NAME,
    BEDROCK_PORT_NAME,
    NETHERNET_PORT_NAME,
} from "../core/portNames";
import { scopedFiles } from "../scopedFiles";
import { gameServerContract } from "../service/contract";
import type { ServersState, ServerSummary } from "../service";
import type { GameServerState } from "../service/types";
export const selectedServerId =
    typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("server");
/** The service as no one server's page reaches it: the saved servers, and the calls about none of them. */
const panel = serviceClient(gameServerContract);
/** The saved servers, as this window mirrors them. */
export const serversState = panel.state;
/** Making a server and the pictures a page shows: the calls about no one server. */
export const panelCalls = panel.calls;
let directory: string | null = null;
let serverName = "";
export function selectedServer(state: ServersState): ServerSummary {
    if (state.serversError) throw new Error(state.serversError);
    const server = state.servers.find((s) => s.id === selectedServerId);
    if (!server) throw new Error("Choose a server that has not been removed");
    directory = server.directory;
    serverName = server.name;
    return server;
}
export function openServer(id: string | null): void {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("server", id);
    else url.searchParams.delete("server");
    window.location.assign(url.href);
}
export const fileApi = scopedFiles(rawFiles, () => {
    if (directory === null) throw new Error("The server has not loaded yet");
    return directory;
});
export const files = fileApi;
function portName(name: string): string {
    if (directory === null || !selectedServerId) throw new Error("The server has not loaded yet");
    return serverPortName(selectedServerId, directory === "", name);
}
export const portApi: typeof rawPorts = {
    claim: (panel, request, scope) =>
        rawPorts.claim(
            panel,
            {
                ...request,
                name: portName(request.name),
                label: serverPortLabel(serverName, request.label),
            },
            scope,
        ),
    prepare: (panel, name, scope) => rawPorts.prepare(panel, portName(name), scope),
    release: (panel, name, scope) => rawPorts.release(panel, portName(name), scope),
    list: async (panel, scope) => {
        const names = [portName(JAVA_PORT_NAME), portName(BEDROCK_PORT_NAME), portName(NETHERNET_PORT_NAME)];
        return (await rawPorts.list(panel, scope)).filter((claim) => names.includes(claim.name));
    },
};
/**
 * The service's calls, each about the server this page is open on. The
 * servers list, which is open on none, reaches the service through
 * panelCalls; a server's call made there is refused, saying so.
 */
export const serverCalls = (selectedServerId ? serviceClient(gameServerContract, { server: selectedServerId }).calls : panel.calls) as ServiceCalls<typeof gameServerContract>;
/** The calls about another server than the page's, for the servers list. */
export const callsFor = (server: string): ServiceCalls<typeof gameServerContract> => serviceClient(gameServerContract, { server }).calls;
/**
 * The selected server's own state: its key of the contract's keyed state,
 * which only this server's changes push.
 */
export const serverState = {
    refresh: async (): Promise<GameServerState> => {
        const state = await panel.keyed.server.read(selectedServerOrThrow());
        if (!state) throw new Error("Choose a server that has not been removed");
        return state;
    },
    // The handler hears what changed on this server: a push carries the
    // server's whole state, so it is narrowed to the fields whose values
    // differ from the last push. A server removed meanwhile is App's to
    // say, from the servers list.
    onChange: (handler: (patch: Partial<GameServerState>) => void): (() => void) => {
        if (!selectedServerId) return () => {};
        let last: GameServerState | null = null;
        return panel.keyed.server.follow(selectedServerId)((state) => {
            if (!state) return;
            const changed: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(state)) {
                if (!last || !sameData(last[key as keyof GameServerState], value)) changed[key] = value;
            }
            last = state;
            if (Object.keys(changed).length > 0) handler(changed as Partial<GameServerState>);
        });
    },
};
function selectedServerOrThrow(): string {
    if (!selectedServerId) throw new Error("Choose a server first");
    return selectedServerId;
}
