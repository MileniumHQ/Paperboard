// Game Server's blocks for the Blocks panel (Actions API v2). Each server is
// a Blocks project of its own; what every game shares is here, and a game
// adds its own commands through its service's blocks().
import type { BlockSet, BlockTypeDefinition, BlocksProjectHandle, ServiceContext } from "@mileniumhq/paperapi";
import type { GameServerState } from "./types";
import type { ServerScope } from "./scope";
import { inServer } from "./scope";

/** A player, by the name the server knows them by. The panel's own type. */
export const PLAYER_TYPE: BlockTypeDefinition<string> = {
    id: "player",
    name: "Player",
    icon: "person",
    base: "text",
};

/** Every game keeps the players online in its state, so every server has these. */
export function sharedBlocks(ctx: ServiceContext<GameServerState>): BlockSet {
    return {
        values: [
            {
                id: "player-count",
                name: "Player Count",
                category: "Players",
                icon: "tag",
                type: "number",
                changes: true,
                read: () => ctx.state.onlinePlayers.length,
            },
            {
                id: "online-players",
                name: "Online Players",
                category: "Players",
                icon: "group",
                type: "list<player>",
                changes: true,
                read: () => [...ctx.state.onlinePlayers],
            },
        ],
    };
}

/** Both sets as one: a game's commands and values beside the shared ones. */
export function mergeBlocks(...sets: (BlockSet | undefined)[]): BlockSet {
    return {
        commands: sets.flatMap((s) => s?.commands ?? []),
        values: sets.flatMap((s) => s?.values ?? []),
        events: sets.flatMap((s) => s?.events ?? []),
    };
}

/**
 * The set as it runs for one server: in that server's scope, refused once
 * it is being removed, and a command counts as the server's operation while
 * it runs (removal waits for it).
 */
export function bindBlocks(scope: ServerScope, set: BlockSet): BlockSet {
    const live = () => {
        if (scope.removing) throw new Error("This server was removed or is being removed");
    };
    return {
        ...set,
        commands: set.commands?.map((command) => ({
            ...command,
            run: async (inputs, ctx) => {
                live();
                scope.activeOperations++;
                try {
                    return await inServer(scope, () => command.run(inputs, ctx));
                } finally {
                    scope.activeOperations--;
                }
            },
        })),
        values: set.values?.map((value) => ({
            ...value,
            read: (inputs, ctx) => {
                live();
                return inServer(scope, () => value.read(inputs, ctx));
            },
        })),
    };
}

/** Tells the Blocks panel the player values changed, when the online players did. */
export function announcePlayerChanges(blocks: BlocksProjectHandle | undefined, before: GameServerState, after: GameServerState, serverName: string): void {
    if (!blocks || before.onlinePlayers === after.onlinePlayers) return;
    const same = before.onlinePlayers.length === after.onlinePlayers.length && before.onlinePlayers.every((p, i) => p === after.onlinePlayers[i]);
    if (same) return;
    for (const value of ["online-players", ...(before.onlinePlayers.length === after.onlinePlayers.length ? [] : ["player-count"])]) {
        blocks.changed(value).catch((err) => console.error(`[gameserver] ${serverName}: the change to ${value} did not reach Blocks:`, err));
    }
}
