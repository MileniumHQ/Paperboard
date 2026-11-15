import { minecraftSoftware } from "../games/minecraft/index";
import type { ServerPage } from "./server";
import { levelTypeOptionsFor } from "./versionProfile";
import type { PropertyField } from "./properties";

// The New World creator's fields, in display order. These are the
// generation-time choices; runtime settings (allow-nether,
// spawn-protection, difficulty, …) live in Options/Advanced and always
// apply to whichever world is active. Seed is a field here, not a special
// input, so the creator is one consistent settings list.
export const worldCreateFields = (server: ServerPage): PropertyField[] => [
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
        // preset ids differ by era (see versionProfile), so the options resolve per render
        defaultValue: "normal",
        options: () => levelTypeOptionsFor(minecraftSoftware(server.serverSoftware()), server.serverVersion()),
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
