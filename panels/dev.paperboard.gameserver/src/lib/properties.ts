import { PANEL_ID } from "../service/types";
import {   fileApi } from "@mileniumhq/paperapi";
import properties from "dot-properties";
import { parseProperties } from "../core/properties";
import { supports, type CapabilityName } from "./capabilities";

export type { CapabilityName };

export interface PropertyField {
    key: string;
    title: string;
    description?: string;
    control: "toggle" | "number" | "select" | "text";
    defaultValue: string;
    min?: number;
    max?: number;
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
export function defaultValueFor(field: PropertyField): string {
    if (field.key === "difficulty" && !supports("namedGameSettings")) return "1";
    if (field.key === "gamemode" && !supports("namedGameSettings")) return "0";
    return field.defaultValue;
}

export async function readServerProperties(): Promise<Record<string, string>> {
    try {
        const content = await fileApi.read("server.properties", PANEL_ID);
        if (!content) return {};
        return parseProperties(content);
    } catch (err) {
        console.error("[Options] Failed to read server.properties:", err);
        return {};
    }
}

export async function writeServerProperties(values: Record<string, string>) {
    const current = await readServerProperties();
    const merged = { ...current, ...values };

    try {
        const content = properties.stringify(merged, {
            keySep: "=",
            lineWidth: null,
            latin1: false,
        });
        await fileApi.write("server.properties", content, PANEL_ID);
    } catch (err) {
        console.error("[Options] Failed to write server.properties:", err);
        throw err;
    }
}
