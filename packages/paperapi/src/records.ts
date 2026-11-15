/**
 * Whether a value is a plain object, such as one JSON.parse made: not null,
 * not an array, and not an instance of a class (a Date, a Map). Read its
 * fields as unknown and check each before using it.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
