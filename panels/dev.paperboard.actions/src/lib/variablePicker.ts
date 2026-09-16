// Which variables a picker request may offer. A primitive expectation
// (text, url, color, ...) interpolates into the field, so it takes any
// variable; a typed expectation (discord-user, list<number>) filters to
// variables the field can actually use.

const PRIMITIVE_EXPECTED_TYPES = new Set([
    "string",
    "object",
    "any",
    "select",
    "url",
    "color",
]);

export function unwrapListType(t: string): string {
    const m = t.match(/^(?:list|array)<(.+)>$/);
    return m ? m[1] : t;
}

export function isVarCompatibleWith(varType: string, expected?: string): boolean {
    if (!expected || expected === "any") return true;
    if (varType === expected) return true;
    if (varType === "any") return true;
    const expectedInner = unwrapListType(expected);
    if (expectedInner !== expected) {
        if (varType === expectedInner) return true;
        if (expectedInner === "string" && varType.startsWith("discord-")) return true;
        return false;
    }
    if (expected === "string" && varType.startsWith("discord-")) return true;
    return false;
}

/** The items a picker opened for this expectation should show. */
export function filterPickerItems<T extends { type?: string }>(
    items: T[],
    expectedType?: string,
): T[] {
    if (!expectedType || PRIMITIVE_EXPECTED_TYPES.has(expectedType)) return items;
    return items.filter((v) => isVarCompatibleWith(v.type || "any", expectedType));
}
