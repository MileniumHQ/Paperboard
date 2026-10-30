import { terraria } from "./terraria";
import { minecraft } from "./minecraft";
import type { GameDefinition } from "./types";
export type * from "./types";

export const games: readonly GameDefinition[] = [minecraft, terraria];
export const defaultGame = minecraft;
/** Never interpret an unknown stored id as another game's files or commands. */
export function gameFor(id: string): GameDefinition {
    const game = games.find((game) => game.id === id);
    if (!game) throw new Error(`Unsupported game: ${id}`);
    return game;
}
export function assertGameAction(game: GameDefinition, options: import("./types").GameOptions, id: string): void {
    if (!game.describe(options).actions.includes(id))
        throw new Error(`${game.name} does not support action "${id}" with this server's software and version`);
}
