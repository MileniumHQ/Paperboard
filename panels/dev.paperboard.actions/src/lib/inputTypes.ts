import type { ActionParamDefinition } from "@paperboard-dev/paperapi";

const PRIMITIVE_INPUT_TYPES = new Set([
    "string", "number", "boolean", "object", "any", "file", "void", "select", "url", "color",
]);

export function isArrayInputType(type?: string): boolean {
    return Boolean(type && (type === "array" || type.startsWith("list<") || type.startsWith("array<")));
}

export function innerTypeOf(type: string): string {
    const match = type.match(/^(?:list|array)<(.+)>$/);
    return match ? match[1] : type;
}

/** The editor accepts custom types through variable chips, not keyboard text. */
export function isTypedOnlyInput(def?: Pick<ActionParamDefinition, "type" | "options">): boolean {
    if (!def?.type || def.options?.length || def.type === "boolean") return false;
    const inner = isArrayInputType(def.type) ? innerTypeOf(def.type) : def.type;
    return inner !== "array" && !PRIMITIVE_INPUT_TYPES.has(inner);
}

export function expectedTypeOf(def?: Pick<ActionParamDefinition, "type">): string {
    if (!def?.type) return "any";
    const inner = isArrayInputType(def.type) ? innerTypeOf(def.type) : def.type;
    return inner === "array" ? "any" : inner;
}
