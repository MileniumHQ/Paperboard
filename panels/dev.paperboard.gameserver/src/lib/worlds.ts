import { files as fileApi, terminal as terminalApi, system } from "@paperboard-dev/paperapi";
import { listDirectory, sanitizeFileName } from "./filesystem";
import { collectWorldDirs, deleteWorldDirs } from "../core/worlds";
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

export async function listWorldDirs(): Promise<string[]> {
    const entries = await listDirectory("");
    return collectWorldDirs({
        entries,
        sanitize: sanitizeFileName,
        exists: (path) => fileApi.exists(path),
        onError: (safe, err) => console.error(`[Worlds] Failed to check "${safe}/level.dat":`, err),
    });
}

export async function deleteActiveWorldDirs(levelName: string): Promise<void> {
    await deleteWorldDirs(levelName, {
        getServerDir: () => fileApi.getPath(""),
        getTargetOs: async () => (await system.getInfo()).os,
        createPty: (id, opts) => terminalApi.create(id, opts),
        writePty: (id, data) => terminalApi.write(id, data),
        scheduleDestroy: (id) => {
            setTimeout(() => {
                try {
                    terminalApi.destroy(id);
                } catch (err) {
                    console.error("[Worlds] Failed to clean up delete-world pty:", err);
                }
            }, 1000);
        },
    });
}
