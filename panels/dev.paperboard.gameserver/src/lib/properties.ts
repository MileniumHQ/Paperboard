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
/** white-list's default for the running version (26.3 turned it on) */
export function whitelistDefault(): string {
    return supports("whitelistOnByDefault") ? "true" : "false";
}

// a missing file is empty; a failed read throws, so nothing treats an
// unreadable file as empty and writes over it
export async function readServerPropertiesStrict(): Promise<Record<string, string>> {
    const content = await fileApi.read("server.properties", PANEL_ID);
    return content ? parseProperties(content) : {};
}

export async function writeServerProperties(values: Record<string, string>) {
    try {
        const current = await readServerPropertiesStrict();
        const content = stringifyServerProperties({ ...current, ...values });
        await fileApi.write("server.properties", content, PANEL_ID);
    } catch (err) {
        console.error("[server.properties] write failed:", err);
        throw err;
    }
}
