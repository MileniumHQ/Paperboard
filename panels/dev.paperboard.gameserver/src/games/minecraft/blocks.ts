// Minecraft's own blocks, beside the ones every game shares (service/blocks.ts).
import type { BlockSet, ServiceContext } from "../../service/api";
import type { GameServerState } from "../../service/types";
import { sendServerCommand } from "../../service/lifecycle";
import { assertPlayerName, assertSingleLine } from "../../core/players";

export function minecraftBlocks(ctx: ServiceContext<GameServerState>): BlockSet {
    return {
        commands: [
            {
                id: "kick-player",
                name: "Kick Player",
                category: "Players",
                icon: "person_remove",
                description: "Disconnects a player from the server, with a reason they see",
                text: "Kick {player} because {reason}",
                inputs: {
                    player: { type: "player", name: "Player" },
                    reason: { type: "text", name: "Reason", optional: true },
                },
                run: async ({ player, reason }: { player: string; reason?: string }) => {
                    const name = assertPlayerName(player);
                    const why = reason ? assertSingleLine(reason.trim(), "kick reason") : "";
                    await sendServerCommand(ctx, why ? `kick ${name} ${why}` : `kick ${name}`);
                },
            },
        ],
    };
}
