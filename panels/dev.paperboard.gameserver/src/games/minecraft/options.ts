import semver from "semver";
import type { GameOption } from "../types";
import { versionSupports, type CapabilityName } from "../../lib/versionProfile";

/** The Java heap the server is given, stored in the server's settings rather than server.properties. */
export const RAM_OPTION = "ramGB";
export const MIN_RAM_GB = 0.5;
export const MAX_RAM_GB = 16;
export const RAM_STEP_GB = 0.1;

type Field = GameOption & { capability?: CapabilityName };

/**
 * Minecraft's options for one version: server.properties keys (by their own
 * names) and the memory allocation. A key this version doesn't read is left
 * out, not shown with an apology. Difficulty and game mode apply to a
 * running server at once; everything else is read when it starts.
 */
export function minecraftOptions(version: string): GameOption[] {
    // before setup there is no version: every option is offered
    const has = (capability: CapabilityName) => !semver.coerce(version) || versionSupports(version, capability);
    // pre-1.14 server.properties stores 0-3; 1.14+ stores names
    const named = has("namedGameSettings");
    const choices = (names: string[]) => names.map((label, i) => ({ value: named ? label.toLowerCase() : String(i), label }));
    const advanced = { tab: "advanced" };
    const fields: Field[] = [
        { id: "server-port", label: "Port", kind: "number", min: 1, max: 65535, default: 25565, restartRequired: true },
        { id: "difficulty", label: "Difficulty", kind: "select", choices: choices(["Peaceful", "Easy", "Normal", "Hard"]), default: named ? "easy" : "1", restartRequired: false },
        { id: "gamemode", label: "Game Mode", kind: "select", choices: choices(["Survival", "Creative", "Adventure", "Spectator"]), default: named ? "survival" : "0", restartRequired: false },
        { id: "max-players", label: "Max Players", kind: "number", min: 1, max: 2147483647, default: 20, restartRequired: true },
        { id: "allow-nether", label: "Allow Nether", kind: "boolean", default: true, restartRequired: true, capability: "propertyAllowNether" },
        { id: "pvp", label: "PvP", kind: "boolean", default: true, restartRequired: true, capability: "propertyPvp" },
        { id: "force-gamemode", label: "Force Game Mode", description: "Players take the server's game mode each time they join.", kind: "boolean", default: false, restartRequired: true },
        // 26.3 turned the whitelist on for new servers
        { id: "white-list", label: "Whitelist", description: "Only players on the whitelist and operators can join.", kind: "boolean", default: has("whitelistOnByDefault") && Boolean(semver.coerce(version)), restartRequired: true },

        { ...advanced, id: RAM_OPTION, label: "Memory Allocation", description: `Memory the server keeps for itself while it runs, from ${MIN_RAM_GB} GB to ${MAX_RAM_GB} GB in steps of ${RAM_STEP_GB} GB.`, kind: "slider", min: MIN_RAM_GB, max: MAX_RAM_GB, step: RAM_STEP_GB, unit: "GB", marks: ramMarks(), default: 4, restartRequired: true },
        { ...advanced, id: "view-distance", label: "Render Distance", description: "Chunks sent to each player around them. Lower is lighter on the server.", kind: "slider", min: 2, max: 32, unit: "chunks", default: 10, restartRequired: true },
        { ...advanced, id: "simulation-distance", label: "Simulation Distance", description: "Chunks around each player where mobs, crops and redstone keep running.", kind: "slider", min: 2, max: 32, unit: "chunks", default: 10, restartRequired: true, capability: "simulationDistance" },
        { ...advanced, id: "online-mode", label: "Online Mode", description: "Verify players against Mojang accounts. Disabling allows cracked clients.", kind: "boolean", default: true, restartRequired: true },
        { ...advanced, id: "enable-command-block", label: "Command Blocks", kind: "boolean", default: false, restartRequired: true, capability: "propertyEnableCommandBlock" },
        { ...advanced, id: "function-permission-level", label: "Function Permission Level", description: "Permission level functions and command blocks run at.", kind: "number", min: 1, max: 4, default: 2, restartRequired: true, capability: "functionPermissionLevel" },
        { ...advanced, id: "enforce-secure-profile", label: "Enforce Secure Profile", description: "Require players to have signed chat profiles.", kind: "boolean", default: true, restartRequired: true, capability: "enforceSecureProfile" },
        { ...advanced, id: "allow-flight", label: "Allow Flight", description: "Survival players may fly. Disabling only kicks flying players.", kind: "boolean", default: false, restartRequired: true },
        { ...advanced, id: "op-permission-level", label: "OP Permission Level", description: "Permission level granted to operators (4 = full control).", kind: "number", min: 0, max: 4, default: 4, restartRequired: true },
        { ...advanced, id: "sync-chunk-writes", label: "Sync Chunk Writes", description: "Write chunk data to disk immediately. Disable for better performance at some data-loss risk.", kind: "boolean", default: true, restartRequired: true, capability: "syncChunkWrites" },
        { ...advanced, id: "entity-broadcast-range-percentage", label: "Entity Broadcast Range", description: "Percentage of view distance used for entity tracking. Lower saves bandwidth.", kind: "number", min: 10, max: 500, default: 100, restartRequired: true, capability: "entityBroadcastRange" },
        { ...advanced, id: "network-compression-threshold", label: "Network Compression Threshold", description: "Compress packets larger than this many bytes. -1 disables compression.", kind: "number", min: -1, max: 1024, default: 256, restartRequired: true },
        { ...advanced, id: "rate-limit", label: "Rate Limit", description: "Packets a player may send per second before being kicked. 0 disables.", kind: "number", min: 0, max: 2147483647, default: 0, restartRequired: true, capability: "rateLimit" },
        { ...advanced, id: "enable-status", label: "Server List Ping", description: "Respond to queries from the multiplayer server list.", kind: "boolean", default: true, restartRequired: true, capability: "enableStatus" },
        { ...advanced, id: "hide-online-players", label: "Hide Online Players", description: "Don't report the player count in the server list.", kind: "boolean", default: false, restartRequired: true, capability: "hideOnlinePlayers" },
        { ...advanced, id: "accepts-transfers", label: "Accept Transfers", description: "Allow the server to transfer players to other servers.", kind: "boolean", default: false, restartRequired: true, capability: "acceptsTransfers" },
        { ...advanced, id: "log-ips", label: "Log Player IPs", description: "Include player IP addresses in the server log.", kind: "boolean", default: true, restartRequired: true, capability: "logIps" },
    ];
    return fields.filter((f) => !f.capability || has(f.capability)).map(({ capability: _, ...field }) => field as GameOption);
}

// a tick at the smallest size and at every fourth gigabyte
function ramMarks(): number[] {
    return [MIN_RAM_GB, ...Array.from({ length: Math.floor(MAX_RAM_GB / 4) }, (_, i) => (i + 1) * 4)];
}

/** A server.properties string as the option's value; an unparseable one throws rather than showing a default over it. */
export function fromProperty(field: GameOption, raw: string): unknown {
    switch (field.kind) {
        case "boolean":
            if (raw !== "true" && raw !== "false") throw new Error(`server.properties has ${field.id}=${raw}, not true or false`);
            return raw === "true";
        case "number":
        case "slider": {
            const value = Number(raw);
            if (raw.trim() === "" || !Number.isInteger(value)) throw new Error(`server.properties has ${field.id}=${raw}, not a whole number`);
            return value;
        }
        default:
            return raw;
    }
}

export const toProperty = (value: unknown): string => String(value);
