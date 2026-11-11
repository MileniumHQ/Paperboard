// Minecraft's own blocks, beside the ones every game shares (service/blocks.ts).
// Each runs what the matching Action (v1) runs, from actions.ts.
import type { BlockCommandDefinition, BlockSet, BlockTypeDefinition, BlockValueDefinition, ServiceContext } from "../../service/api";
import type { GameServerState } from "../../service/types";
import { ACTION_IDS } from "../../service/contract";
import { needsAction, playerEvents } from "../../service/blocks";
import { listRoster } from "../../service/playerLists";
import { listPlayerStats } from "../../service/playerStats";
import { listWorlds, resolveLevelName } from "../../service/worlds";
import { listInstalledPlugins, uninstallAllPlugins } from "../../service/plugins";
import { deletePlayerData } from "../../service/players";
import { setGamerule } from "../../service/gamerules";
import type { PlayerStatSummary } from "../../core/playerStats";
import { gamerulesFor } from "../../core/gamerules";
import { SOFTWARE_IDS } from "../../software/catalog";
import { SOFTWARE_NAMES } from "../../lib/software";
import {
    activateWorld,
    flagPlayer,
    installVersion,
    playerCommand,
    playerForUuid,
    punishPlayer,
    removePlugin,
    removeWorld,
    resetWorld,
} from "./actions";

type Context = ServiceContext<GameServerState>;

/** Minecraft's types, beside the shared ones; the panel registers them. */
export const minecraftBlockTypes: BlockTypeDefinition[] = [
    {
        id: "world",
        name: "World",
        icon: "public",
        base: "object",
        fields: {
            name: { type: "text", name: "Name" },
            active: { type: "boolean", name: "Active", description: "The world the server starts with" },
            generated: { type: "boolean", name: "Generated", description: "False until the server first starts with it" },
            nether: { type: "boolean", name: "Has the Nether" },
            end: { type: "boolean", name: "Has the End" },
        },
    },
    {
        id: "plugin",
        name: "Plugin",
        icon: "extension",
        base: "object",
        fields: {
            file: { type: "text", name: "File" },
            name: { type: "text", name: "Name" },
            version: { type: "text", name: "Version", description: "Empty for a plugin Paperboard did not install" },
        },
    },
    {
        id: "player-statistics",
        name: "Player Statistics",
        icon: "leaderboard",
        base: "object",
        fields: {
            player: { type: "player", name: "Player" },
            "play-time": { type: "duration", name: "Play Time" },
            deaths: { type: "number", name: "Deaths" },
            "mob-kills": { type: "number", name: "Mob Kills" },
            "player-kills": { type: "number", name: "Player Kills" },
            jumps: { type: "number", name: "Jumps" },
            "blocks-mined": { type: "number", name: "Blocks Mined" },
            distance: { type: "number", name: "Distance", description: "In blocks" },
        },
    },
];

// a tick is 50 ms; the stats count distance in centimetres, a block is a metre
const statisticsValue = (stats: PlayerStatSummary) => ({
    player: stats.name,
    "play-time": stats.playTimeTicks * 50,
    deaths: stats.deaths,
    "mob-kills": stats.mobKills,
    "player-kills": stats.playerKills,
    jumps: stats.jumps,
    "blocks-mined": stats.blocksMined,
    distance: stats.distanceCm / 100,
});

const player = { type: "player", name: "Player" } as const;

/** Commands that do one thing to one player. */
function playerCommands(ctx: Context): BlockCommandDefinition[] {
    const simple = (id: string, name: string, icon: string, text: string, run: (player: string) => Promise<void>): BlockCommandDefinition => ({
        id, name, category: "Players", icon, text, inputs: { player }, run: ({ player }: { player: string }) => run(player),
    });
    const withReason = (verb: "kick" | "ban", name: string, icon: string, description: string): BlockCommandDefinition => ({
        id: `${verb}-player`,
        name,
        category: "Players",
        icon,
        description,
        text: `${verb === "kick" ? "Kick" : "Ban"} {player} because {reason}`,
        inputs: { player, reason: { type: "text", name: "Reason", optional: true } },
        run: ({ player, reason }: { player: string; reason?: string }) => punishPlayer(ctx, verb, player, reason),
    });
    return [
        withReason("kick", "Kick Player", "person_remove", "Disconnects a player from the server, with a reason they see"),
        withReason("ban", "Ban Player", "gavel", "Bans a player from the server, with a reason they see"),
        simple("pardon-player", "Pardon Player", "undo", "Pardon {player}", (p) => playerCommand(ctx, "pardon", p)),
        simple("kill-player", "Kill Player", "heart_broken", "Kill {player}", (p) => playerCommand(ctx, "kill", p)),
        simple("op-player", "Make Operator", "shield", "Make {player} an operator", (p) => flagPlayer(ctx, "op", p, true)),
        simple("deop-player", "Remove Operator", "shield_person", "Remove {player} as an operator", (p) => flagPlayer(ctx, "op", p, false)),
        simple("whitelist-player", "Add to Whitelist", "verified_user", "Add {player} to the whitelist", (p) => flagPlayer(ctx, "whitelist", p, true)),
        simple("unwhitelist-player", "Remove from Whitelist", "person_off", "Remove {player} from the whitelist", (p) => flagPlayer(ctx, "whitelist", p, false)),
        {
            ...simple("delete-player-data", "Delete Player Data", "delete", "Delete the data of {player}", (p) => deletePlayerData(ctx, p)),
            description: "Moves a player's inventory, position, advancements and statistics to the trash; they start over on their next join",
        },
    ];
}

/** The game rule blocks; the dropdown asks for the rules of the version the server has when it opens. */
function gameruleBlocks(ctx: Context): { command: BlockCommandDefinition; value: BlockValueDefinition } {
    const rule = {
        type: "text",
        name: "Game Rule",
        choices: () => gamerulesFor(ctx.state.serverVersion).map((rule) => ({ label: rule.name, value: rule.name })),
    };
    return {
        command: {
            id: "set-game-rule",
            name: "Set Game Rule",
            category: "Game Rules",
            icon: "list_alt_check",
            description: "Sets a game rule now, or for the next start when the server is offline",
            text: "Set game rule {rule} to {value}",
            inputs: { rule, value: { type: "text", name: "Value" } },
            run: ({ rule, value }: { rule: string; value: string }) => {
                setGamerule(ctx, rule, value);
            },
        },
        value: {
            id: "game-rule",
            name: "Game Rule",
            category: "Game Rules",
            icon: "list_alt_check",
            description: "A game rule's value, as the running server last reported it",
            text: "Game rule {rule}",
            inputs: { rule },
            type: "text",
            read: ({ rule }: { rule: string }) => {
                const value = ctx.state.gamerules[rule];
                if (value === undefined) throw new Error(`The server has not reported ${rule} yet; start it first`);
                return value;
            },
        },
    };
}

export function minecraftBlocks(ctx: Context): BlockSet {
    const world = { type: "text", name: "World" } as const;
    const roster = (id: string, name: string, icon: string, flag: "whitelisted" | "op" | "banned"): BlockValueDefinition => ({
        id, name, category: "Players", icon, type: "list<player>",
        read: async () => (await listRoster()).filter((entry) => entry[flag]).map((entry) => entry.name),
    });
    const rules = gameruleBlocks(ctx);
    return {
        commands: [
            ...playerCommands(ctx),
            rules.command,
            {
                id: "switch-world",
                name: "Switch World",
                category: "Worlds",
                icon: "public",
                description: "Makes a world on this server the one it starts with; the server must be stopped",
                text: "Switch to world {world}",
                inputs: { world },
                run: async ({ world }: { world: string }) => {
                    if (!(await listWorlds()).some((w) => w.name.toLowerCase() === world.toLowerCase())) {
                        throw new Error(`This server has no world named "${world}"; Create World makes one`);
                    }
                    await activateWorld(ctx, world);
                },
            },
            {
                id: "create-world",
                name: "Create World",
                category: "Worlds",
                icon: "add_location_alt",
                description: "Makes a new world the one the server starts with; it generates on the next start",
                text: "Create world {world} from seed {seed}",
                inputs: { world, seed: { type: "text", name: "Seed", optional: true } },
                run: async ({ world, seed }: { world: string; seed?: string }) => {
                    await activateWorld(ctx, world, seed, true);
                },
            },
            {
                id: "delete-world",
                name: "Delete World",
                category: "Worlds",
                icon: "delete",
                description: "Moves a world, with its Nether and End, to the trash; the server must be stopped",
                text: "Delete world {world}",
                inputs: { world },
                run: ({ world }: { world: string }) => removeWorld(ctx, world),
            },
            {
                id: "reset-world",
                name: "Reset the World",
                category: "Worlds",
                icon: "restart_alt",
                description: "Moves the active world to the trash, so the next start generates it fresh",
                run: async () => {
                    if (!(await resetWorld(ctx))) throw new Error("The world's folders could not be moved to the trash; the service log says why");
                },
            },
            {
                id: "install-software",
                name: "Install Server Software",
                category: "Server",
                icon: "deployed_code",
                description: "Installs a server software for a Minecraft version over this one; the server must be stopped",
                text: "Install {software} {version}",
                inputs: {
                    software: { type: "text", name: "Software", choices: SOFTWARE_IDS.map((value) => ({ label: SOFTWARE_NAMES[value], value })) },
                    version: { type: "text", name: "Version", maxLength: 64 },
                },
                run: async ({ software, version }: { software: string; version: string }) => {
                    await installVersion(ctx, software, version);
                },
            },
            needsAction(ctx, ACTION_IDS.deletePlugin, {
                id: "delete-plugin",
                name: "Delete Plugin",
                category: "Plugins",
                icon: "delete",
                description: "Moves a plugin's file to the trash",
                text: "Delete plugin {file}",
                inputs: { file: { type: "text", name: "File" } },
                run: ({ file }: { file: string }) => removePlugin(ctx, file),
            }),
            needsAction(ctx, ACTION_IDS.uninstallAllPlugins, {
                id: "uninstall-plugins",
                name: "Uninstall Every Plugin",
                category: "Plugins",
                icon: "delete_sweep",
                description: "Moves every plugin and mod to the trash, and gives how many went",
                output: "number",
                run: () => uninstallAllPlugins(ctx),
            }),
        ],
        values: [
            rules.value,
            roster("whitelisted-players", "Whitelisted Players", "verified_user", "whitelisted"),
            roster("operators", "Operators", "shield", "op"),
            roster("banned-players", "Banned Players", "gavel", "banned"),
            {
                id: "player-by-uuid",
                name: "Player by UUID",
                category: "Players",
                icon: "badge",
                description: "The player a UUID belongs to, from the server's player files",
                text: "Player with UUID {uuid}",
                inputs: { uuid: { type: "text", name: "UUID" } },
                type: "player",
                read: ({ uuid }: { uuid: string }) => playerForUuid(uuid),
            },
            needsAction(ctx, ACTION_IDS.listPlayerStats, {
                id: "player-statistics",
                name: "Player Statistics",
                category: "Players",
                icon: "leaderboard",
                description: "Every player's statistics in the active world, as of its last save",
                type: "list<player-statistics>",
                read: async () => (await listPlayerStats(ctx)).map(statisticsValue),
            }),
            needsAction(ctx, ACTION_IDS.listPlayerStats, {
                id: "statistics-of",
                name: "Statistics of Player",
                category: "Players",
                icon: "leaderboard",
                description: "A player's statistics in the active world, as of its last save",
                text: "Statistics of {player}",
                inputs: { player },
                type: "player-statistics",
                read: async ({ player }: { player: string }) => {
                    const stats = (await listPlayerStats(ctx)).find((s) => s.name.toLowerCase() === player.toLowerCase());
                    if (!stats) throw new Error(`The active world has no statistics for ${player}`);
                    return statisticsValue(stats);
                },
            }),
            {
                id: "worlds",
                name: "Worlds",
                category: "Worlds",
                icon: "public",
                type: "list<world>",
                read: async () => (await listWorlds()).map((w) => ({ name: w.name, active: w.active, generated: w.generated, nether: w.hasNether, end: w.hasEnd })),
            },
            {
                id: "active-world",
                name: "Active World",
                category: "Worlds",
                icon: "public",
                description: "The name of the world the server starts with",
                type: "text",
                read: () => resolveLevelName(),
            },
            {
                id: "plugins",
                name: "Plugins",
                category: "Plugins",
                icon: "extension",
                type: "list<plugin>",
                read: async () => {
                    const { plugins, warning } = await listInstalledPlugins(ctx);
                    if (warning) throw new Error(warning);
                    return plugins.map((p) => ({ file: p.filename, name: p.record?.title ?? p.record?.slug ?? p.filename, version: p.record?.version ?? "" }));
                },
            },
        ],
        events: playerEvents(),
    };
}
