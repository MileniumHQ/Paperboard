import { terrariaService } from "./terraria/service";
import { terraria } from "./terraria";
import { minecraft } from "./minecraft";
import { currentServer } from "../service/scope";
import { defaultGame, gameFor } from "./index";
import { minecraftService } from "./minecraft/service";
import { palworld } from "./palworld";
import { palworldService } from "./palworld/service";
import { tf2 } from "./tf2";
import { tf2Service } from "./tf2/service";
import { gmod } from "./gmod";
import { gmodService } from "./gmod/service";
import { rust } from "./rust";
import { rustService } from "./rust/service";
import type { GameService } from "./serviceTypes";
const services: Readonly<Record<string, GameService>> = { [minecraft.id]: minecraftService, [terraria.id]: terrariaService, [palworld.id]: palworldService, [tf2.id]: tf2Service, [gmod.id]: gmodService, [rust.id]: rustService };
export function gameServiceFor(id: string): GameService {
    const game = gameFor(id);
    const service = services[game.id];
    if (!service) throw new Error(`Game service missing: ${game.id}`);
    return service;
}
// Unscoped adapters (legacy callers and unit tests) use the original module.
// A stored server always resolves its explicit game id, including unknown ids.
export const currentGame = () => gameFor(currentServer()?.server.game ?? defaultGame.id);
export const currentGameService = () => gameServiceFor(currentGame().id);
