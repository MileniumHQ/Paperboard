import { serverBridge, serverSoftware, serverVersion } from "./server";
import { ACTION_IDS } from "../service/contract";
import { levelTypeOptionsFor } from "./versionProfile";
import type { PropertyField } from "./properties";
import type { WorldInfo } from "../core/worlds";

// The New World creator's fields, in display order. These are the
// generation-time choices; runtime settings (allow-nether,
// spawn-protection, difficulty, …) live in Options/Advanced and always
// apply to whichever world is active. Seed is a field here, not a special
// input, so the creator is one consistent settings list.
export const WORLD_CREATE_FIELDS: PropertyField[] = [
    {
        key: "level-seed",
        title: "Seed",
        description: "Seed used for world generation. Empty = random.",
        control: "text",
        defaultValue: "",
    },
    {
        key: "level-type",
        title: "World Type",
        description: "Terrain generator for the new world.",
        control: "select",
        // preset ids differ by era (see versionProfile); serverVersion is
        // unknown at module load, so the options resolve per render
        defaultValue: "normal",
        options: () => levelTypeOptionsFor(serverSoftware(), serverVersion()),
    },
    {
        key: "generate-structures",
        title: "Generate Structures",
        description: "Villages, temples, strongholds and other generated structures.",
        control: "toggle",
        defaultValue: "true",
    },
    {
        key: "bonus-chest",
        title: "Bonus Chest",
        description: "Place a chest with a few starting items near spawn.",
        control: "toggle",
        defaultValue: "false",
    },
    {
        key: "hardcore",
        title: "Hardcore",
        description: "Hard difficulty, spectator on death. Overrides difficulty.",
        control: "toggle",
        defaultValue: "false",
    },
    {
        key: "max-world-size",
        title: "World Size",
        description: "World radius limit in blocks.",
        control: "number",
        defaultValue: "29999984",
        min: 1,
        max: 29999984,
    },
];

export { WORLD_NAME_PATTERN, isWorldNameTaken } from "../core/worlds";
export type { WorldInfo } from "../core/worlds";

// server.properties stores a preset id with an escaped colon
// (`minecraft\:flat`); older builds can double-escape it. Match against the
// bare id the select options use, so the label renders instead of the raw id.
export function normalizeLevelType(value: string): string {
    return value.replace(/\\+/g, "");
}

// world listing and deletion run in the service (service/worlds.ts owns
// the pty + trash discipline with an explicit PANEL_ID). The direct
// fileApi/terminalApi twins that lived here are gone: the UI triggers,
// the service executes, state syncs back.
export async function listWorldDirs(): Promise<string[]> {
    return serverBridge.call<string[]>(ACTION_IDS.listWorldDirs);
}

export async function listWorlds(): Promise<WorldInfo[]> {
    return serverBridge.call<WorldInfo[]>(ACTION_IDS.listWorlds);
}

export async function setActiveWorld(
    levelName: string,
    seed?: string,
    createOnly = false,
): Promise<{ activated: string; created: boolean }> {
    return serverBridge.call<{ activated: string; created: boolean }>(
        ACTION_IDS.setActiveWorld,
        { levelName, seed, createOnly },
    );
}

export async function deleteActiveWorldDirs(levelName: string): Promise<void> {
    await serverBridge.call(ACTION_IDS.deleteWorld, { levelName });
}
