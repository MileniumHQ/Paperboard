import { files as fileApi, terminal as terminalApi, system } from "@paperboard-dev/paperapi";
import { listDirectory, sanitizeFileName } from "./filesystem";
import type { PropertyField } from "./properties";

// World fields edited with the same controls as the Options tab
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

// A directory is a world if it contains level.dat
export async function listWorldDirs(): Promise<string[]> {
    const entries = await listDirectory("");
    const worlds: string[] = [];
    for (const entry of entries) {
        const safe = sanitizeFileName(entry);
        if (!safe) continue;
        try {
            if (await fileApi.exists(`${safe}/level.dat`)) {
                worlds.push(safe);
            }
        } catch (err) {
            console.error(`[Worlds] Failed to check "${safe}/level.dat":`, err);
        }
    }
    return worlds.sort((a, b) => a.localeCompare(b));
}

// World names reach shell commands, so stricter than the entry-name pattern
const WORLD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// Deletes <level>, <level>_nether and <level>_the_end via a short-lived pty
export async function deleteActiveWorldDirs(levelName: string): Promise<void> {
    const safe = levelName.trim();
    if (!WORLD_NAME_PATTERN.test(safe)) {
        throw new Error(`Refusing to delete unsafe world name: "${levelName}"`);
    }

    const dirs = [safe, `${safe}_nether`, `${safe}_the_end`];
    const serverDir = await fileApi.getPath("");
    // OS of the computer this panel targets — not the shell's active one.
    const targetOs = (await system.getInfo()).os;
    const isWin =
        targetOs === "windows" ||
        serverDir.includes("\\") ||
        serverDir.includes(":");
    const deleteCmd = isWin
        ? `rmdir /s /q ${dirs.join(" ")} 2>nul || exit 0`
        : `rm -rf ${dirs.join(" ")}`;

    await terminalApi.create("delete-world-pty", { cwd: serverDir, cols: 80, rows: 24 });
    terminalApi.write("delete-world-pty", `${deleteCmd}\nexit\n`);
    setTimeout(() => {
        try {
            terminalApi.destroy("delete-world-pty");
        } catch (err) {
            console.error("[Worlds] Failed to clean up delete-world pty:", err);
        }
    }, 1000);
}
