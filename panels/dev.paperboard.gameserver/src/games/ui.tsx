import { minecraft } from "./minecraft";
import { gameFor } from "./index";
import { minecraftUI } from "./minecraft/ui";
import type { GameUI } from "./uiTypes";
const interfaces: Readonly<Record<string, GameUI>> = { [minecraft.id]: minecraftUI };
export function gameUIFor(id: string): GameUI {
    const game = gameFor(id);
    const ui = interfaces[game.id];
    if (!ui) throw new Error(`Game interface missing: ${id}`);
    return ui;
}
