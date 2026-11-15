import type { BlockTypeDefinition } from "@mileniumhq/paperapi";
import type { Server } from "../service/server";
import { gameFor } from "./index";
import { minecraft } from "./minecraft";
import { minecraftService } from "./minecraft/service";
import { terraria } from "./terraria";
import { terrariaService } from "./terraria/service";
import { palworld } from "./palworld";
import { palworldService } from "./palworld/service";
import { tf2 } from "./tf2";
import { tf2Service } from "./tf2/service";
import { gmod } from "./gmod";
import { gmodService } from "./gmod/service";
import { cs2 } from "./cs2";
import { cs2Service } from "./cs2/service";
import { rust } from "./rust";
import { rustService } from "./rust/service";
import type { GameService } from "./serviceTypes";

/** A game as the service knows it: what makes its part of each server, and the Blocks types its blocks use. */
export interface GameModule {
    /** the game's part of one server, made when the server is and for it alone */
    create(server: Server): GameService;
    /** the Blocks types the game's own blocks use; the panel registers them once */
    blockTypes?(): Promise<BlockTypeDefinition[]>;
}
const modules: Readonly<Record<string, GameModule>> = {
    [minecraft.id]: { create: minecraftService, blockTypes: async () => (await import("./minecraft/blocks")).minecraftBlockTypes },
    [terraria.id]: { create: terrariaService },
    [palworld.id]: { create: palworldService },
    [tf2.id]: { create: tf2Service },
    [gmod.id]: { create: gmodService },
    [rust.id]: { create: rustService },
    [cs2.id]: { create: cs2Service },
};
/** A stored server's game; an id no game has throws. */
export function gameModuleFor(id: string): GameModule {
    const game = gameFor(id);
    const found = modules[game.id];
    if (!found) throw new Error(`Game service missing: ${game.id}`);
    return found;
}
