import type { SourceOption } from "./index";

// Source config files and RCON commands are console lines: a quote ends a
// value and a semicolon or newline starts another command, and neither can be
// escaped. Values holding them are refused rather than mangled.

/** A console value: numbers and on/off as they are, text quoted. */
export function cvarValue(value: unknown, label: string): string {
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") throw new Error(`${label} has no console value`);
    if (/["\r\n;\0]/.test(value)) throw new Error(`${label} can't hold quotes or semicolons`);
    return `"${value}"`;
}

/** The value an option has: its saved one, else its default. */
export function optionValue(option: SourceOption, saved: Record<string, unknown>): unknown {
    if (Object.hasOwn(saved, option.id)) return saved[option.id];
    return "default" in option ? option.default : undefined;
}

/**
 * The server.cfg Paperboard generates into the install. Source runs it on
 * every map load, after the map's own settings. A server.cfg the user keeps in
 * the server folder follows as paperboard_user.cfg, so it has the last word.
 */
export function serverCfg(options: readonly SourceOption[], saved: Record<string, unknown>, user: boolean): string {
    const lines = ["// Written by Paperboard at each start. Edit Options, or server.cfg in the server folder.", "log on", "sv_logecho 1", "sv_logfile 1", "sv_rcon_log 0", "sv_rcon_whitelist_address 127.0.0.1"];
    for (const option of options) {
        if (!option.cvar) continue;
        const value = optionValue(option, saved);
        if (value !== undefined) lines.push(`${option.cvar} ${cvarValue(value, option.label)}`);
    }
    lines.push("exec banned_user.cfg");
    if (user) lines.push("exec paperboard_user.cfg");
    return `${lines.join("\n")}\n`;
}

/**
 * The passwords a start needs, run once from the command line before the map
 * loads and deleted once the server is up; the server keeps them in memory.
 */
export function secretsCfg(secrets: { rcon: string; join: string; token: string }): string {
    const lines = [`rcon_password ${cvarValue(secrets.rcon, "RCON password")}`, `sv_password ${cvarValue(secrets.join, "Join password")}`];
    if (secrets.token) lines.push(`sv_setsteamaccount ${cvarValue(secrets.token, "Game server login token")}`);
    return `${lines.join("\n")}\n`;
}

/** Map names as Source takes them: a .bsp's name in the maps folder. */
export function mapName(value: unknown): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9_\-]{1,64}$/.test(value)) throw new Error("Choose a map by its name, such as ctf_2fort");
    return value;
}
