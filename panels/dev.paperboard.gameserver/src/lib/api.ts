// Each server page is a document of its own. Reloading on selection also
// tears down pending renderer work, so an old dialog cannot edit a new server.
export * from "@mileniumhq/paperapi";
import { sameData } from "@mileniumhq/paperui/headless";
import {
    createPanelBridge as rawBridge,
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
import { PANEL_ID, serverStateKey, serverStateOf } from "../servers";
import { gameServerContract } from "../service/contract";
import type { ServersState, ServerSummary } from "../service";
export const selectedServerId =
    typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("server");
export const serversBridge = rawBridge<ServersState>({ panelId: PANEL_ID });
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
 * The service's calls, each about the server this page is open on; on the
 * servers list, which is open on none, only those about the saved servers
 * answer.
 */
export const serverCalls: ServiceCalls<typeof gameServerContract> = serviceClient(gameServerContract, selectedServerId ? { server: selectedServerId } : {}).calls;
/** The calls about another server than the page's, for the servers list. */
export const callsFor = (server: string): ServiceCalls<typeof gameServerContract> => serviceClient(gameServerContract, { server }).calls;
/**
 * The selected server's state, projected out of the panel's: the contract
 * can't carry it yet, as each server's state sits under its own id.
 */
export const serverState = {
    refresh: async (): Promise<Record<string, unknown>> => {
        const state = await serversBridge.refreshState();
        return { ...serverStateOf(state, selectedServer(state).id) };
    },
    // The handler hears what changed on this server: another server's
    // activity, or the list of servers, is not a change here, and a push
    // carries this server's whole state, so it is narrowed to the keys
    // whose values differ from the last push.
    onChange: (handler: (patch: Record<string, unknown>) => void): (() => void) => {
        let last: Record<string, unknown> | null = null;
        return serversBridge.onStateChange((patch, full) => {
            // App owns the missing/deleted-server error; let its listener run.
            if (
                !selectedServerId ||
                full.serversError ||
                !full.servers.some((s) => s.id === selectedServerId) ||
                !(serverStateKey(selectedServerId) in patch)
            )
                return;
            const state: Record<string, unknown> = { ...serverStateOf(full, selectedServer(full).id) };
            const changed: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(state)) {
                if (!last || !sameData(last[key], value)) changed[key] = value;
            }
            last = state;
            if (Object.keys(changed).length > 0) handler(changed);
        });
    },
};
