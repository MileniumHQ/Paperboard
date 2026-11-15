import type { Server } from "../../service/server";

import { PANEL_ID } from "../../service/types";
import { parseProperties, stringifyServerProperties } from "../../core/properties";
import { applyRuntimeProperties } from "../../service/runtimeProperties";
import { validateOptions } from "../options";
import { fromProperty, minecraftOptions, RAM_OPTION, toProperty } from "./options";
import { loadConfigAndProperties } from "./config";

// a missing file is empty; a failed read throws, so an unreadable file is never shown as defaults and saved over
async function readProperties(ctx: Server): Promise<Record<string, string>> {
    const content = await ctx.files.read("server.properties", PANEL_ID);
    return content ? parseProperties(content) : {};
}

/** Every option this version has, from server.properties and the server's settings; a key not in the file reads as its default. */
export async function readGameOptions(ctx: Server): Promise<Record<string, unknown>> {
    const properties = await readProperties(ctx);
    const saved = ctx.settings;
    const values: Record<string, unknown> = {};
    for (const field of minecraftOptions(ctx.state.serverVersion)) {
        if (field.kind === "secret") continue;
        if (field.id === RAM_OPTION) values[field.id] = saved.ramGB ?? field.default;
        else values[field.id] = properties[field.id] === undefined ? field.default : fromProperty(field, properties[field.id]!);
    }
    return values;
}

/**
 * Saves an options patch. server.properties keeps every key it already had;
 * difficulty and game mode reach a running server at once (offline, they wait
 * for its next start), the rest apply when it starts.
 */
export async function writeGameOptions(ctx: Server, patch: unknown): Promise<Record<string, unknown>> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
    const fields = minecraftOptions(ctx.state.serverVersion);
    const checked = validateOptions(fields, "Minecraft", patch as Record<string, unknown>);
    const { [RAM_OPTION]: ram, ...properties } = checked;
    if (ram !== undefined) await ctx.updateSettings({ ramGB: ram });
    if (Object.keys(properties).length > 0) {
        const current = await readProperties(ctx);
        const changed = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toProperty(value)]));
        await ctx.files.write("server.properties", stringifyServerProperties({ ...current, ...changed }), PANEL_ID);
        // a game mode change needs force-gamemode to decide whether online players change too
        if (changed.gamemode !== undefined) changed["force-gamemode"] = changed["force-gamemode"] ?? current["force-gamemode"] ?? "false";
        await applyRuntimeProperties(ctx, changed);
    }
    await loadConfigAndProperties(ctx);
    return readGameOptions(ctx);
}
