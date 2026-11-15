import { createSignal, untrack, type Accessor } from "solid-js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** an array whose items each carry an id, matched by it rather than by position */
function idOf(item: unknown): string | number | undefined {
    if (!isPlainObject(item)) return undefined;
    const id = item.id;
    return typeof id === "string" || typeof id === "number" ? id : undefined;
}

/**
 * `next`, sharing every part of `prev` it equals: `prev` itself when nothing
 * changed, and otherwise a value whose unchanged items, entries and fields
 * are the very objects `prev` held. A service pushes a fresh copy of its
 * whole state each time; this is what lets a list keep its rows, and a
 * signal stay quiet, when the copy says nothing new. Arrays of items with an
 * `id` match them by it, other arrays by position; Sets and Maps by key;
 * plain objects by field. Anything else is equal only when identical.
 */
export function keepUnchanged<T>(prev: T, next: T): T {
    if (Object.is(prev, next)) return prev;
    if (Array.isArray(prev) && Array.isArray(next)) {
        const byId = new Map<string | number, unknown>();
        for (const item of prev) {
            const id = idOf(item);
            if (id !== undefined) byId.set(id, item);
        }
        let same = prev.length === next.length;
        const kept = next.map((item, index) => {
            const id = idOf(item);
            const old = id !== undefined && byId.has(id) ? byId.get(id) : index < prev.length ? prev[index] : undefined;
            const value = old === undefined ? item : keepUnchanged(old, item);
            if (value !== prev[index]) same = false;
            return value;
        });
        return (same ? prev : kept) as T;
    }
    if (prev instanceof Set && next instanceof Set) {
        if (prev.size !== next.size) return next;
        for (const item of next) if (!prev.has(item)) return next;
        return prev;
    }
    if (prev instanceof Map && next instanceof Map) {
        let same = prev.size === next.size;
        const kept = new Map();
        for (const [key, value] of next) {
            const old = prev.get(key);
            const item = prev.has(key) ? keepUnchanged(old, value) : value;
            if (!prev.has(key) || item !== old) same = false;
            kept.set(key, item);
        }
        return (same ? prev : kept) as T;
    }
    if (isPlainObject(prev) && isPlainObject(next)) {
        const keys = Object.keys(next);
        let same = keys.length === Object.keys(prev).length;
        const kept: Record<string, unknown> = {};
        for (const key of keys) {
            const has = Object.prototype.hasOwnProperty.call(prev, key);
            const value = has ? keepUnchanged(prev[key], next[key]) : next[key];
            if (!has || value !== prev[key]) same = false;
            kept[key] = value;
        }
        return (same ? prev : kept) as T;
    }
    return next;
}

/** Whether two values hold the same data, by the rules of keepUnchanged. */
export function sameData(a: unknown, b: unknown): boolean {
    return keepUnchanged(a, b) === a;
}

/**
 * A signal for state a service pushes: a value equal to the one it holds
 * (see keepUnchanged) notifies no one, and a changed one keeps the parts
 * that did not change, so the rows of a list built from it keep their
 * identity.
 */
export function createStateSignal<T>(initial: T): [Accessor<T>, (next: T | ((prev: T) => T)) => void] {
    const [value, setValue] = createSignal<T>(initial);
    const set = (next: T | ((prev: T) => T)) => {
        // a set inside an effect doesn't make the effect follow this signal
        const prev = untrack(value);
        const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
        const kept = keepUnchanged(prev, resolved);
        if (kept !== prev) setValue(() => kept);
    };
    return [value, set];
}
