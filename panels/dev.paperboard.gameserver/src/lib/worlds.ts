import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import type { PropertyField } from "./properties";

export const WORLD_PROPERTY_FIELDS: PropertyField[] = [
    {
        key: "level-name",
        title: "World Name",
        description: "Name of the world directory on disk.",
        control: "text",
        defaultValue: "world",
    },
    {
        key: "level-seed",
        title: "Level Seed",
        description: "Seed used for world generation. Empty = random.",
        control: "text",
        defaultValue: "",
    },
    {
        key: "level-type",
        title: "World Type",
        control: "select",
        defaultValue: "minecraft\\:normal",
        options: () => [
            { value: "minecraft\\:normal", label: "Normal" },
            { value: "minecraft\\:flat", label: "Superflat" },
            { value: "minecraft\\:large_biomes", label: "Large Biomes" },
            { value: "minecraft\\:amplified", label: "Amplified" },
            { value: "minecraft\\:single_biome_surface", label: "Single Biome" },
        ],
    },
    {
        key: "generate-structures",
        title: "Generate Structures",
        control: "toggle",
        defaultValue: "true",
    },
    {
        key: "max-world-size",
        title: "Max World Size",
        description: "World radius limit in blocks.",
        control: "number",
        defaultValue: "29999984",
        min: 1,
        max: 29999984,
    },
    {
        key: "hardcore",
        title: "Hardcore",
        description: "Hard difficulty, spectator on death. Overrides difficulty.",
        control: "toggle",
        defaultValue: "false",
    },
    {
        key: "allow-nether",
        title: "Allow Nether",
        control: "toggle",
        defaultValue: "true",
    },
    {
        key: "spawn-protection",
        title: "Spawn Protection Radius",
        description: "Blocks around spawn only ops may build in. 0 disables.",
        control: "number",
        defaultValue: "16",
        min: 0,
        max: 2147483647,
    },
];

export { WORLD_NAME_PATTERN } from "../core/worlds";

// world listing and deletion run in the service (service/worlds.ts owns
// the pty + trash discipline with an explicit PANEL_ID). The direct
// fileApi/terminalApi twins that lived here are gone: the UI triggers,
// the service executes, state syncs back.
export async function listWorldDirs(): Promise<string[]> {
    return serverBridge.call<string[]>(ACTION_IDS.listWorldDirs);
}

export async function deleteActiveWorldDirs(levelName: string): Promise<void> {
    await serverBridge.call(ACTION_IDS.deleteWorld, { levelName });
}
