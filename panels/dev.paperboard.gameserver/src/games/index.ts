import { terraria } from "./terraria";
import { cs2 } from "./cs2";
import { gmod } from "./gmod";
import { minecraft } from "./minecraft";
import { palworld } from "./palworld";
import { rust } from "./rust";
import { tf2 } from "./tf2";
import type { GameDefinition } from "./types";
export type * from "./types";

export const games: readonly GameDefinition[] = [minecraft, terraria, palworld, tf2, cs2, gmod, rust];
export const defaultGame = minecraft;
/** Never interpret an unknown stored id as another game's files or commands. */
export function gameFor(id: string): GameDefinition {
    const game = games.find((game) => game.id === id);
    if (!game) throw new Error(`Unsupported game: ${id}`);
    return game;
}
export function assertGameCall(game: GameDefinition, options: import("./types").GameOptions, id: string): void {
    if (!game.describe(options).calls.includes(id))
        throw new Error(`${game.name} does not support "${id}" with this server's software and version`);
}
/** A server card's "game · software" line; a game that is its own software (Palworld, Source games) is named once. */
export function serverSubtitle(game: GameDefinition, options: import("./types").GameOptions): string {
    const software = game.softwareLabel(options);
    return software.startsWith(game.name) ? software : `${game.name} · ${software}`;
}
