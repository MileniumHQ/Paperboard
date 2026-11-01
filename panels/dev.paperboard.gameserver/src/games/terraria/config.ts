import path from "node:path";
import { options } from "./index";
import { singleLine, validateOptions as validateShared } from "../options";
export function validateOptions(input: Record<string, unknown>, previous: Record<string, unknown> = {}): Record<string, unknown> {
    return validateShared(options, "Terraria", input, previous);
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
    // language: the readiness and save checks read the console's English output
    Object.assign(values, { world: path.join(root, "worlds", `${world}.wld`), worldpath: path.join(root, "worlds"), worldname: world, password: singleLine(password, "Password"), upnp: 0, language: "en-US", banlist: path.join(root, "banlist.txt") });
    // Preserve unknown publisher settings and comments; replace all owned keys.
    const kept = existing.split(/\r?\n/).filter(line => !(line.includes("=") && Object.hasOwn(values, line.slice(0, line.indexOf("=")).trim().toLowerCase())));
    return [...kept.filter(Boolean), ...Object.entries(values).map(([k, v]) => `${k}=${typeof v === "boolean" ? Number(v) : singleLine(String(v), k)}`), ""].join("\n");
}
