export * from "@mileniumhq/paperapi";
import type { Accessor } from "solid-js";
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
import type { ServerSummary } from "../service";

/** The service as no one server reaches it: the saved servers, and the calls about none of them. */
const panel = serviceClient(gameServerContract);
/** The saved servers, as this window mirrors them. */
export const serversState = panel.state;
/** Making a server and the pictures a page shows: the calls about no one server. */
export const panelCalls = panel.calls;
/** Each server's own state, by its id: its key of the contract's keyed state, which only its changes push. */
export const serverStates = panel.keyed.server;
/** The calls about one server. */
export type ServerCalls = ServiceCalls<typeof gameServerContract>;
export const callsFor = (server: string): ServerCalls => serviceClient(gameServerContract, { server }).calls;

/** The server's files: every path is inside its folder. */
export const filesFor = (summary: Accessor<ServerSummary>): typeof rawFiles => scopedFiles(rawFiles, () => summary().directory);

/** The ports the panel claims, named for the server so two servers never share one. */
export function portsFor(summary: Accessor<ServerSummary>): typeof rawPorts {
    const portName = (name: string) => serverPortName(summary().id, name);
    return {
        claim: (panel, request, scope) =>
            rawPorts.claim(panel, { ...request, name: portName(request.name), label: serverPortLabel(summary().name, request.label) }, scope),
        prepare: (panel, name, scope) => rawPorts.prepare(panel, portName(name), scope),
        release: (panel, name, scope) => rawPorts.release(panel, portName(name), scope),
        list: async (panel, scope) => {
            const names = [portName(JAVA_PORT_NAME), portName(BEDROCK_PORT_NAME), portName(NETHERNET_PORT_NAME)];
            return (await rawPorts.list(panel, scope)).filter((claim) => names.includes(claim.name));
        },
    };
}
