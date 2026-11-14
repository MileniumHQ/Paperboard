import type { JSX } from "solid-js";

/**
 * A component's own inline style with the caller's `style` prop over it, so
 * the caller's declarations win. A `style` given as text keeps every
 * declaration: the component's are written out ahead of it.
 */
export function mergeStyle(
    base: JSX.CSSProperties,
    style: JSX.CSSProperties | string | undefined,
): JSX.CSSProperties | string {
    if (style === undefined) return base;
    if (typeof style === "object") return { ...base, ...style };
    const own = Object.entries(base)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([name, value]) => `${name}: ${value}`);
    return [...own, style].join("; ");
}
