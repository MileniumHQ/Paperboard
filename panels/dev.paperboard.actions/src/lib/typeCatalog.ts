// What the flow builder knows about value types. Primitive types are this
// panel's own vocabulary; every other type belongs to the panel that defined
// it and arrives with that panel's registered action schemas (the SDK stamps
// `schema.types`). Nothing here names a particular panel's types.
import { createSignal } from "solid-js";
import type { ActionTypeInfo } from "@mileniumhq/paperapi";

const PRIMITIVE_NAMES: Record<string, string> = {
    string: "Text",
    number: "Number",
    boolean: "True/False",
    object: "Data",
    any: "Any",
    url: "URL",
    color: "Color",
    file: "File",
    array: "List",
};

const PRIMITIVE_ICONS: Record<string, string> = {
    string: "text_fields",
    number: "numbers",
    boolean: "toggle_on",
    object: "data_object",
    any: "bolt",
    url: "link",
    color: "palette",
    array: "list",
};

// Replaced wholesale from each registry listing, so it holds exactly the
// types of the actions registered now: bounded by the daemon's action cap.
const [catalog, setCatalog] = createSignal<ReadonlyMap<string, ActionTypeInfo>>(new Map());

/**
 * Builds the catalog from registered schemas. Two panels may name the same
 * type id; the first registration keeps it so the display is stable.
 */
export function collectTypeCatalog(
    schemas: readonly { types?: Record<string, ActionTypeInfo> }[],
): Map<string, ActionTypeInfo> {
    const found = new Map<string, ActionTypeInfo>();
    for (const schema of schemas) {
        for (const [id, info] of Object.entries(schema.types ?? {})) {
            if (!found.has(id) && info && typeof info.name === "string") found.set(id, info);
        }
    }
    return found;
}

export function updateTypeCatalog(
    schemas: readonly { types?: Record<string, ActionTypeInfo> }[],
): void {
    setCatalog(collectTypeCatalog(schemas));
}

export function typeInfo(type?: string): ActionTypeInfo | undefined {
    return type ? catalog().get(type) : undefined;
}

function listInner(type: string): string | null {
    const match = type.match(/^(?:list|array)<(.+)>$/);
    return match ? match[1] : null;
}

/** "Channel", "Text", "Channel[]"; an unknown id is shown capitalized. */
export function typeDisplayName(type?: string): string {
    if (!type) return "Any";
    const inner = listInner(type);
    if (inner) return `${typeDisplayName(inner)}[]`;
    const name = typeInfo(type)?.name || PRIMITIVE_NAMES[type];
    return name || type.charAt(0).toUpperCase() + type.slice(1);
}

/** The material icon for values of a type, or undefined when none is known. */
export function typeIcon(type?: string): string | undefined {
    if (!type) return undefined;
    const inner = listInner(type);
    if (inner) return typeIcon(inner);
    return typeInfo(type)?.icon || PRIMITIVE_ICONS[type];
}

/** The primitive a type is built on: a custom type's base, or itself. */
export function typeBase(type: string): string {
    return typeInfo(type)?.base || type;
}
