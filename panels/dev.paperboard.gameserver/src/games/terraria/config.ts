import path from "node:path";
import { options } from "./index";
export function singleLine(value: unknown, label: string): string {
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error(`${label} must be a single line`);
    return value;
}
export function validateOptions(input: Record<string, unknown>, previous: Record<string, unknown> = {}): Record<string, unknown> {
    const next = { ...previous };
    for (const [id, value] of Object.entries(input)) {
        const field = options.find(f => f.id === id);
        if (!field) throw new Error(`Unknown Terraria option: ${id}`);
        if (field.kind === "number") {
            if (!Number.isInteger(value) || Number(value) < field.min || Number(value) > field.max) throw new Error(`${field.label} must be ${field.min}–${field.max}`);
        } else if (field.kind === "boolean") {
            if (typeof value !== "boolean") throw new Error(`${field.label} must be a boolean`);
        } else {
            singleLine(value, field.label);
            if (field.kind === "select" && !field.choices.some(c => c.value === value)) throw new Error(`Invalid ${field.label}`);
        }
        if (field.kind !== "secret") next[id] = value;
    }
    return next;
}
export function worldName(value: unknown): string {
    if (typeof value !== "string" || !/^[\p{L}\p{N} _-]{1,80}$/u.test(value)) throw new Error("World name must be 1–80 letters, numbers, spaces, underscores or hyphens");
    return value;
}
export function configText(root: string, settings: Record<string, unknown>, password: string, existing = ""): string {
    const values: Record<string, unknown> = {};
    for (const field of options) if (field.kind !== "secret") values[field.id] = settings[field.id] ?? field.default;
    validateOptions(values);
    const world = worldName(settings.world ?? "World");
    const port = settings.port ?? 7777;
    if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid Terraria port");
    Object.assign(values, { world: path.join(root, "worlds", `${world}.wld`), worldpath: path.join(root, "worlds"), worldname: world, port, password: singleLine(password, "Password"), upnp: 0, banlist: path.join(root, "banlist.txt") });
    // Preserve unknown publisher settings and comments; replace all owned keys.
    const kept = existing.split(/\r?\n/).filter(line => !(line.includes("=") && Object.hasOwn(values, line.slice(0, line.indexOf("=")).trim().toLowerCase())));
    return [...kept.filter(Boolean), ...Object.entries(values).map(([k, v]) => `${k}=${typeof v === "boolean" ? Number(v) : singleLine(String(v), k)}`), ""].join("\n");
}
