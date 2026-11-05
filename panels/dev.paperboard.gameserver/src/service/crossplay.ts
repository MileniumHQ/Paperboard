import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { BedrockNaming } from "../core/bedrock";
import { parseProperties } from "../core/properties";
import { pluginDirName } from "../core/plugins";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import {
    AUTH_TYPE_SETTING,
    BEDROCK_PORT_SETTING_ID,
    CROSSPLAY,
    crossplaySetting,
    type CrossplayPlatform,
} from "../software/crossplay";
import { MOD_DESCRIPTORS, modIdFrom, PLUGIN_DESCRIPTORS, pluginNameFrom } from "./addonConfig";
import { readJarEntries } from "./jarEntries";
import { readSchemaSettings, writeSchemaSetting, type LoaderDeps, type LoaderGroupView } from "./loaderSettings";
import { serializedFileTask, writeFileAtomic } from "./fileWrites";
import { listServerFiles, ServerFileMissingError } from "./serverFiles";

// The Crossplay tab's owner: which of Geyser and Floodgate are installed
// (by the name inside each jar, so a renamed jar still counts) and their
// settings, read and written through the same schema code as the Loader tab.

export interface CrossplayView {
    software: ServerSoftwareType;
    /** the installed jars' filenames, null when absent */
    geyser: string | null;
    floodgate: string | null;
    groups: LoaderGroupView[];
}

function platformOf(software: ServerSoftwareType): CrossplayPlatform {
    const platform = CROSSPLAY[software];
    if (!platform) throw new Error(`Crossplay needs Paper, Fabric or NeoForge. Geyser has no build for ${SOFTWARE[software].name}.`);
    return platform;
}

/** the name a jar gives itself, or null when it does not say */
async function jarName(software: ServerSoftwareType, jarPath: string): Promise<string | null> {
    if (SOFTWARE[software].addons?.kind === "plugin") return pluginNameFrom(await readJarEntries(jarPath, PLUGIN_DESCRIPTORS));
    return modIdFrom(await readJarEntries(jarPath, MOD_DESCRIPTORS));
}

export async function findCrossplayJars(
    software: ServerSoftwareType,
    deps: LoaderDeps,
): Promise<{ geyser: string | null; floodgate: string | null }> {
    const platform = platformOf(software);
    const dir = pluginDirName(software);
    let entries;
    try {
        entries = (await listServerFiles(dir, deps)).entries;
    } catch (err) {
        if (err instanceof ServerFileMissingError) return { geyser: null, floodgate: null };
        throw err;
    }
    const root = await deps.serverDir();
    const found = { geyser: null as string | null, floodgate: null as string | null };
    for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.toLowerCase().endsWith(".jar")) continue;
        let name: string | null;
        try {
            name = await jarName(software, nodePath.join(root, dir, entry.name));
        } catch (err) {
            // one unreadable jar is the Plugins tab's problem, not a reason
            // to hide crossplay; it is logged so it can still be found
            console.error("[Service:Crossplay] could not read", entry.name, String(err));
            continue;
        }
        if (name === platform.geyserName) found.geyser = entry.name;
        else if (name === platform.floodgateName) found.floodgate = entry.name;
    }
    return found;
}

export async function readCrossplay(software: ServerSoftwareType, deps: LoaderDeps): Promise<CrossplayView> {
    const platform = platformOf(software);
    const jars = await findCrossplayJars(software, deps);
    const { groups } = await readSchemaSettings(platform.schema, deps);
    return { software, ...jars, groups };
}

/**
 * How Floodgate names Bedrock players on this server, read from its own
 * config.yml, or null when Floodgate is not installed (no Bedrock players).
 */
export async function readBedrockNaming(software: ServerSoftwareType, deps: LoaderDeps): Promise<BedrockNaming | null> {
    const platform = CROSSPLAY[software];
    if (!platform) return null;
    const { floodgate } = await findCrossplayJars(software, deps);
    if (!floodgate) return null;
    const { groups } = await readSchemaSettings(platform.schema, deps);
    const group = groups.find((g) => g.settings.some((s) => s.id === "floodgate.username-prefix"));
    if (!group) throw new Error("Floodgate's settings are missing from the crossplay schema");
    if (group.error) throw new Error(`Floodgate's ${group.path} could not be read: ${group.error}`);
    const value = (id: string) => {
        const setting = group.settings.find((s) => s.id === id);
        if (!setting) throw new Error(`Floodgate's ${id} setting is missing from the crossplay schema`);
        return setting.value;
    };
    return {
        prefix: value("floodgate.username-prefix"),
        replaceSpaces: value("floodgate.replace-spaces") !== "false",
    };
}

async function javaPort(deps: LoaderDeps): Promise<number> {
    const fs = deps.fs ?? (nodeFs as unknown as NonNullable<LoaderDeps["fs"]>);
    let text: string;
    try {
        text = await fs.readFile(nodePath.join(await deps.serverDir(), "server.properties"), "utf8");
    } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return 25565;
        throw err;
    }
    return Number(parseProperties(text)["server-port"]?.trim() || 25565);
}

export async function writeCrossplaySetting(
    software: ServerSoftwareType,
    id: unknown,
    raw: unknown,
    deps: LoaderDeps,
): Promise<{ id: string; value: string; path: string }> {
    const platform = platformOf(software);
    const setting = crossplaySetting(id);
    if (!setting) throw new Error(`Unknown crossplay setting: ${JSON.stringify(id)}`);
    if (setting.id === BEDROCK_PORT_SETTING_ID) {
        // Geyser's signaling listens on TCP at this port, as the Java server does
        const java = await javaPort(deps);
        if (Number(String(raw).trim()) === java) {
            throw new Error(`Port ${java} is the Java server's port. Bedrock players need a port of their own.`);
        }
    }
    return writeSchemaSetting(platform.schema, setting, raw, deps);
}

/**
 * Bedrock players have no Mojang profile key to sign chat with, so a server
 * that enforces secure profiles drops every line they type. The rest of
 * server.properties is kept as it is, comments and all.
 */
export async function allowUnsignedChat(deps: LoaderDeps): Promise<void> {
    const fs = deps.fs ?? (nodeFs as unknown as NonNullable<LoaderDeps["fs"]>);
    const file = nodePath.join(await deps.serverDir(), "server.properties");
    await serializedFileTask(file, async () => {
        let text = "";
        try {
            text = await fs.readFile(file, "utf8");
        } catch (err) {
            // the server writes its defaults around this line on first start
            if ((err as { code?: string }).code !== "ENOENT") throw err;
        }
        if (parseProperties(text)["enforce-secure-profile"]?.trim() === "false") return;
        const line = /^([ \t]*enforce-secure-profile[ \t]*[=:]).*$/m;
        const next = line.test(text)
            ? text.replace(line, "$1false")
            : `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}enforce-secure-profile=false\n`;
        await writeFileAtomic(fs, file, next);
    });
}

/** After the jars are in: Bedrock players log in through Floodgate, and can chat. */
export async function prepareCrossplay(software: ServerSoftwareType, deps: LoaderDeps): Promise<CrossplayView> {
    const platform = platformOf(software);
    await writeSchemaSetting(platform.schema, AUTH_TYPE_SETTING, "floodgate", deps);
    await allowUnsignedChat(deps);
    return readCrossplay(software, deps);
}
