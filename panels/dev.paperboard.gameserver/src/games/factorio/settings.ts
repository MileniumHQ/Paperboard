import { options, type FactorioOption } from "./index";

// What Paperboard writes for the server at each start: server-settings.json
// from the options (the keys of data/server-settings.example.json in the
// release), and for a new map, mod-list.json with the expansion on or off.

export const optionValue = (option: FactorioOption, saved: Record<string, unknown>) =>
    Object.hasOwn(saved, option.id) ? saved[option.id] : "default" in option ? option.default : undefined;
export const setting = (id: string, saved: Record<string, unknown>) => optionValue(options.find((o) => o.id === id)!, saved);

/** Why the public list can't take the server, or null when it can: it signs in to factorio.com with the person's own account. */
export function publicProblem(saved: Record<string, unknown>, token: string): string | null {
    if (setting("public", saved) !== true) return null;
    if (!String(setting("username", saved)).trim() || !token) return "Listing the server publicly needs a factorio.com username and token. Add them in Options, or turn List publicly off";
    return null;
}

/**
 * server-settings.json for a start. The join password and the factorio.com
 * token are written into it, so the file lives only while the server runs.
 */
export function serverSettings(saved: Record<string, unknown>, secrets: { password: string; token: string }): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const option of options) {
        if (!option.setting) continue;
        const value = optionValue(option, saved);
        // the game reads allow_commands as true, false or "admins-only"
        out[option.setting] = option.id === "allowCommands" ? (value === "true" ? true : value === "false" ? false : "admins-only") : value;
    }
    const isPublic = setting("public", saved) === true;
    return {
        ...out,
        tags: [],
        visibility: { public: isPublic, lan: setting("lan", saved) === true },
        username: isPublic ? String(setting("username", saved)).trim() : "",
        token: isPublic ? secrets.token : "",
        password: "",
        game_password: secrets.password,
        // autosaves stay on the server, not on every player's computer
        autosave_only_on_server: true,
        non_blocking_saving: false,
    };
}

/** A map's seed: empty for a random one, or a whole number the game takes (0 to 4294967295). */
export function seedValue(value: unknown): number | null {
    const text = String(value ?? "").trim();
    if (text === "") return null;
    if (!/^\d{1,10}$/.test(text) || Number(text) > 0xffffffff) throw new Error("Seed must be a whole number from 0 to 4294967295, or empty for a random map");
    return Number(text);
}

/**
 * A save's name: its file in the saves folder, less ".zip". A name the game
 * starts with "_" is one of its autosaves, which take turns in their files.
 */
export const SAVE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
export function saveName(value: unknown): string {
    if (typeof value !== "string" || !SAVE_NAME.test(value) || value.trim() !== value || value.toLowerCase().endsWith(".zip")) throw new Error("A world's name is 1 to 60 letters, digits, spaces, _, . and -, starting with a letter or digit");
    return value;
}

/** The expansion's mods in the release; Space Age needs the other three. */
export const EXPANSION_MODS = ["elevated-rails", "quality", "recycler", "space-age"] as const;

interface ModEntry { name: string; enabled: boolean; [key: string]: unknown }

function modEntries(text: string | null): ModEntry[] {
    if (text === null) return [];
    const parsed = JSON.parse(text) as { mods?: unknown };
    if (!parsed || !Array.isArray(parsed.mods) || !parsed.mods.every((m) => m && typeof m.name === "string")) throw new Error("mod-list.json in the mods folder is damaged");
    return parsed.mods as ModEntry[];
}

/**
 * mod-list.json for making a map: the base game, and the expansion's mods on
 * or off. Every other mod keeps whether it is on, so a mod added in Files
 * and turned on there is in the new map too.
 */
export function modListFor(text: string | null, spaceAge: boolean): string {
    const mods = modEntries(text).filter((m) => m.name !== "base" && !(EXPANSION_MODS as readonly string[]).includes(m.name));
    const list = [{ name: "base", enabled: true }, ...EXPANSION_MODS.map((name) => ({ name, enabled: spaceAge })), ...mods.map((m) => ({ name: m.name, enabled: m.enabled === true }))];
    return `${JSON.stringify({ mods: list }, null, 2)}\n`;
}

/** Whether the mod list has the expansion on: after a start matches it to the map, whether the map is a Space Age one. */
export function spaceAgeOn(text: string | null): boolean {
    return modEntries(text).some((m) => m.name === "space-age" && m.enabled === true);
}

/**
 * player-data.json as the server leaves it, without the secrets it copies
 * there from its settings (measured on 2.1.25): the factorio.com token as
 * `service-token`, and the join password, in the clear, as
 * `last-played.host-settings.password-hash`. Each start gives them again, so
 * nothing needs them kept. Null when there is nothing to take out.
 */
export function playerDataWithoutSecrets(text: string): string | null {
    const data = JSON.parse(text) as Record<string, unknown>;
    let changed = false;
    if (typeof data["service-token"] === "string" && data["service-token"] !== "") {
        data["service-token"] = "";
        changed = true;
    }
    const lastPlayed = data["last-played"];
    const host = lastPlayed && typeof lastPlayed === "object" ? (lastPlayed as Record<string, unknown>)["host-settings"] : undefined;
    if (host && typeof host === "object" && typeof (host as Record<string, unknown>)["password-hash"] === "string" && (host as Record<string, unknown>)["password-hash"] !== "") {
        (host as Record<string, unknown>)["password-hash"] = "";
        changed = true;
    }
    return changed ? JSON.stringify(data, null, 2) : null;
}
