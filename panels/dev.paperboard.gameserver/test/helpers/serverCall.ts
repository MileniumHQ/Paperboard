// One server's calls, the way its page makes them: through the panel's
// contract, with the server they are about in the client's scope.
import { serviceClient } from "@mileniumhq/paperapi";
import { gameServerContract } from "../../src/service/contract";
import type { ServerCalls } from "../../src/service/calls";
import type { Server } from "../../src/service/server";

export const serverCalls = (server: string) => serviceClient(gameServerContract, { server }).calls;
/** The calls about the saved servers, which the servers list makes with no server open. */
export const panelCalls = () => serviceClient(gameServerContract).calls;

/** One of a game's own calls by id, as the service runs it: the server it is about, then its input. */
export function pickCall(calls: ServerCalls, id: string): (ctx: Server, input: unknown) => Promise<unknown> {
    const found = (calls as Record<string, ((ctx: Server, input: unknown) => unknown) | undefined>)[id];
    if (!found) throw new Error(`No call ${id}`);
    return async (ctx, input) => found(ctx, input);
}
