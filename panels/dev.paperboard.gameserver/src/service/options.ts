import { system, type ServiceContext } from "./api";
import type { GameServerState } from "./types";
import { currentGameService } from "../games/service";

/** The game's options and the address players join on, for every game. The address is looked up each time: a computer's LAN address can change. */
export async function loadServerOptions(ctx: ServiceContext<GameServerState>): Promise<void> {
    await currentGameService().loadOptions(ctx);
    ctx.setState({ localIp: await system.getLocalIP() });
}
