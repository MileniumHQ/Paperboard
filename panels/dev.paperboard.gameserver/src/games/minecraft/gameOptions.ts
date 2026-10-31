import { config, files as fileApi, type ServiceContext } from "../../service/api";
import { PANEL_ID, type GameServerState } from "../../service/types";
import { parseProperties, stringifyServerProperties } from "../../core/properties";
import { applyRuntimeProperties } from "../../service/runtimeProperties";
import { validateOptions } from "../options";
import { fromProperty, minecraftOptions, RAM_OPTION, toProperty } from "./options";
import { loadConfigAndProperties } from "./config";

type Context = ServiceContext<GameServerState>;

// a missing file is empty; a failed read throws, so an unreadable file is never shown as defaults and saved over
async function readProperties(): Promise<Record<string, string>> {
    const content = await fileApi.read("server.properties", PANEL_ID);
    return content ? parseProperties(content) : {};
}

async function settings(): Promise<Record<string, unknown>> {
    const saved = await config.get<Record<string, unknown>>(PANEL_ID);
    return saved && typeof saved === "object" ? saved : {};
}

/** Every option this version has, from server.properties and the server's settings; a key not in the file reads as its default. */
export async function readGameOptions(ctx: Context): Promise<Record<string, unknown>> {
    const properties = await readProperties();
    const saved = await settings();
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
export async function writeGameOptions(ctx: Context, patch: unknown): Promise<Record<string, unknown>> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Options patch is required");
    const fields = minecraftOptions(ctx.state.serverVersion);
    const checked = validateOptions(fields, "Minecraft", patch as Record<string, unknown>);
    const { [RAM_OPTION]: ram, ...properties } = checked;
    if (ram !== undefined) await config.set({ ...await settings(), ramGB: ram }, PANEL_ID);
    if (Object.keys(properties).length > 0) {
        const current = await readProperties();
        const changed = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, toProperty(value)]));
        await fileApi.write("server.properties", stringifyServerProperties({ ...current, ...changed }), PANEL_ID);
        // a game mode change needs force-gamemode to decide whether online players change too
        if (changed.gamemode !== undefined) changed["force-gamemode"] = changed["force-gamemode"] ?? current["force-gamemode"] ?? "false";
        await applyRuntimeProperties(ctx, changed);
    }
    await loadConfigAndProperties(ctx);
    return readGameOptions(ctx);
}
