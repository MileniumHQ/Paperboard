// One server's calls, the way its page makes them: through the panel's
// contract, with the server they are about in the client's scope.
import { serviceClient } from "@mileniumhq/paperapi";
import { gameServerContract } from "../../src/service/contract";

export const serverCalls = (server: string) => serviceClient(gameServerContract, { server }).calls;
/** The calls about the saved servers, which the servers list makes with no server open. */
export const panelCalls = () => serviceClient(gameServerContract, {}).calls;
