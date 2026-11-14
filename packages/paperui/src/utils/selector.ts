/** `value` made safe to put inside a quoted attribute selector, such as `[data-path="…"]` */
export function escapeAttributeValue(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    // jsdom has no CSS.escape; inside quotes only a quote or a backslash needs escaping
    return value.replace(/["\\]/g, "\\$&");
}
