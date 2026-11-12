// Each server page is a document of its own. Reloading on selection also
// tears down pending renderer work, so an old dialog cannot edit a new server.
export * from "@mileniumhq/paperapi";
import {
    createPanelBridge as rawBridge,
    serviceApi,
    type BlockCallOptions,
    fileApi as rawFiles,
    config as rawConfig,
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
import { PANEL_ID, serverStateOf } from "../servers";
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
/** One of the selected server's calls: the service is told which server it is for. */
function callServer<T>(name: string, input?: Record<string, unknown>, options?: BlockCallOptions): Promise<T> {
    if (!selectedServerId) return Promise.reject(new Error("Choose a server first"));
    return serviceApi.call<T>(PANEL_ID, name, { ...input, server: selectedServerId }, options);
}
export const config: typeof rawConfig = {
    get: <T>() => serversBridge.call<T>("read-server-config", { server: selectedServerId }),
    set: (patch) => callServer("update-panel-config", { patch }),
};
// Existing tabs use the same bridge contract, projected onto this server.
export function createPanelBridge(_options: any) {
    return {
        call: callServer,
        refreshState: async () => {
            const state = await serversBridge.refreshState();
            return serverStateOf(state, selectedServer(state).id);
        },
        onStateChange: (handler: (patch: any, full?: any) => void) =>
            serversBridge.onStateChange((_patch, full) => {
                // App owns the missing/deleted-server error; let its listener run.
                if (
                    !selectedServerId ||
                    full.serversError ||
                    !full.servers.some((s) => s.id === selectedServerId)
                )
                    return;
                const state = serverStateOf(full, selectedServer(full).id);
                handler(state, state);
            }),
    };
}
