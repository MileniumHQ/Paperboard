// What a Minecraft server keeps while the service runs, beside what every
// server keeps: its game service holds one, made with the server.
import { SerialQueue } from "@mileniumhq/paperapi";
import type { Server } from "../../service/server";
import type { CachedTile } from "../../service/map";
import type { PendingPositionQuery, PendingStatQuery } from "../../service/players";
import type { QueryKind } from "./observe";
import type { Waiter } from "./saving";

export function minecraftState() {
    return {
        /** an install, a modpack change or an upload owns the server folder (softwareInstall) */
        installing: false,
        /** a pause of the server's saving, and the console lines waited for (saving) */
        saving: { waiters: new Set<Waiter>(), pausing: false },
        /** the panel's own queries a console command asked the answer of (observe) */
        asked: [] as { kind: QueryKind; at: number }[],
        /** stat and position replies waited for (players) */
        players: {
            pendingStats: [] as PendingStatQuery[],
            pendingPositionQueries: [] as PendingPositionQuery[],
        },
        /** names looked up from Mojang, and one player list edit at a time (playerLists) */
        lists: { names: new Map<string, { name: string; at: number }>(), editing: new SerialQueue().run },
        /** the map's rendered tiles (map) */
        tileCache: new Map<string, CachedTile>(),
        /** a world upload or download is running (worldTransfer) */
        transferring: false,
        /** the settling of interrupted work under way (recovery) */
        settling: null as Promise<boolean> | null,
        /** one write of the upload and datapack records at a time */
        records: new SerialQueue().run,
    };
}
export type MinecraftState = ReturnType<typeof minecraftState>;

/** The Minecraft state of a server; a server of another game has none. */
export function minecraftOf(server: Server): MinecraftState {
    const state = (server.game as { minecraft?: MinecraftState }).minecraft;
    if (!state) throw new Error(`${server.name} is not a Minecraft server`);
    return state;
}
