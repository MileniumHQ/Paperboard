import { PANEL_ID } from "../service/types";
import {   fileApi } from "./api";
import { parseProperties, stringifyServerProperties } from "../core/properties";
import { supports, type CapabilityName } from "./capabilities";

export type { CapabilityName };

export interface PropertyField {
    key: string;
    title: string;
    description?: string;
    control: "toggle" | "number" | "slider" | "select" | "text";
    defaultValue: string;
    min?: number;
    max?: number;
    /** number inputs: "any" allows fractions (the browser's default step of 1 rejects them) */
    step?: "any";
    /** sliders: the value's unit, shown after the number ("10 chunks"); a slider needs min and max */
    unit?: string;
    /** text inputs: the longest value accepted */
    maxLength?: number;
    options?: () => { value: string; label: string }[];
    capability?: CapabilityName;
    /** show this field only when another field holds the given value */
    dependsOn?: { key: string; equals: string };
}
export const SERVER_PROPERTY_FIELDS: PropertyField[] = [
    {
        key: "server-port",
        title: "Port",
        control: "number",
        defaultValue: "25565",
        min: 1,
        max: 65535,
    },
    {
        key: "difficulty",
        title: "Difficulty",
        control: "select",
        defaultValue: "easy",
        // pre-1.14 server.properties stores 0-3; 1.14+ stores names
        options: () =>
            supports("namedGameSettings")
                ? [
                      { value: "peaceful", label: "Peaceful" },
                      { value: "easy", label: "Easy" },
                      { value: "normal", label: "Normal" },
                      { value: "hard", label: "Hard" },
                  ]
                : [
                      { value: "0", label: "Peaceful" },
                      { value: "1", label: "Easy" },
                      { value: "2", label: "Normal" },
                      { value: "3", label: "Hard" },
                  ],
    },
    {
        key: "gamemode",
        title: "Game Mode",
        control: "select",
        defaultValue: "survival",
        options: () =>
            supports("namedGameSettings")
                ? [
                      { value: "survival", label: "Survival" },
                      { value: "creative", label: "Creative" },
                      { value: "adventure", label: "Adventure" },
                      { value: "spectator", label: "Spectator" },
                  ]
                : [
                      { value: "0", label: "Survival" },
                      { value: "1", label: "Creative" },
                      { value: "2", label: "Adventure" },
                      { value: "3", label: "Spectator" },
                  ],
    },
    {
        key: "max-players",
        title: "Max Players",
        control: "number",
        defaultValue: "20",
        min: 1,
        max: 2147483647,
    },
    {
        key: "allow-nether",
        title: "Allow Nether",
        control: "toggle",
        defaultValue: "true",
        capability: "propertyAllowNether",
    },
    {
        key: "pvp",
        title: "PvP",
        control: "toggle",
        defaultValue: "true",
        capability: "propertyPvp",
    },
    {
        key: "force-gamemode",
        title: "Force Game Mode",
        control: "toggle",
        defaultValue: "false",
    },
    {
        key: "white-list",
        title: "Whitelist",
        control: "toggle",
        // the shown fallback is version-dependent: see whitelistDefault()
        defaultValue: "false",
    },
];

// a field whose capability this Minecraft version lacks is hidden, not
// shown with an apology: "Moved to Game Rules" text is noise the Game
// Rules tab already owns.
export function visiblePropertyFields(): PropertyField[] {
    return SERVER_PROPERTY_FIELDS.filter(
        (field) => !field.capability || supports(field.capability),
    );
}

// Field-table defaults are written in their modern form. The only fields
// whose *stored* representation is era-dependent get a version-aware
// resolution here, so a missing key on an old server is never seeded with
// a value that server cannot parse.
/** How far the server loads and ticks the world around each player (Advanced tab) */
export const DISTANCE_PROPERTY_FIELDS: PropertyField[] = [
    {
        key: "view-distance",
        title: "Render Distance",
        description: "Chunks sent to each player around them. Lower is lighter on the server.",
        control: "slider",
        defaultValue: "10",
        min: 2,
        max: 32,
        unit: "chunks",
    },
    {
        key: "simulation-distance",
        title: "Simulation Distance",
        description: "Chunks around each player where mobs, crops and redstone keep running.",
        control: "slider",
        defaultValue: "10",
        min: 2,
        max: 32,
        unit: "chunks",
        capability: "simulationDistance",
    },
];

/** white-list's default for the running version (26.3 turned it on) */
export function whitelistDefault(): string {
    return supports("whitelistOnByDefault") ? "true" : "false";
}

export function defaultValueFor(field: PropertyField): string {
    if (field.key === "difficulty" && !supports("namedGameSettings")) return "1";
    if (field.key === "gamemode" && !supports("namedGameSettings")) return "0";
    if (field.key === "white-list") return whitelistDefault();
    return field.defaultValue;
}

/**
 * Whether an edit may be stored for this field. A number or slider holds a
 * finite number inside its bounds (a slider an integer too); every other
 * control takes any text.
 */
export function isValidFieldValue(field: PropertyField, value: string): boolean {
    if (field.control !== "number" && field.control !== "slider") return true;
    if (value.trim() === "") return false;
    const num = Number(value);
    if (!Number.isFinite(num)) return false;
    if (field.control === "slider" && !Number.isInteger(num)) return false;
    if (field.min !== undefined && num < field.min) return false;
    if (field.max !== undefined && num > field.max) return false;
    return true;
}

// a missing file is empty; a failed read throws, so nothing treats an
// unreadable file as empty and writes over it
export async function readServerPropertiesStrict(): Promise<Record<string, string>> {
    const content = await fileApi.read("server.properties", PANEL_ID);
    return content ? parseProperties(content) : {};
}

export async function readServerProperties(): Promise<Record<string, string>> {
    try {
        return await readServerPropertiesStrict();
    } catch (err) {
        console.error("[Options] Failed to read server.properties:", err);
        return {};
    }
}

export async function writeServerProperties(values: Record<string, string>) {
    try {
        const current = await readServerPropertiesStrict();
        const content = stringifyServerProperties({ ...current, ...values });
        await fileApi.write("server.properties", content, PANEL_ID);
    } catch (err) {
        console.error("[Options] Failed to write server.properties:", err);
        throw err;
    }
}
