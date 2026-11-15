import type { Server } from "./server";
import { system } from "./api";

/** The game's options and the address players join on, for every game. The address is looked up each time: a computer's LAN address can change. */
export async function loadServerOptions(ctx: Server): Promise<void> {
    await ctx.game.loadOptions();
    ctx.setState({ localIp: await system.getLocalIP() });
}
