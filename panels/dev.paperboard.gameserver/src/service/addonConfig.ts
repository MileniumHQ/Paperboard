import * as nodePath from "node:path";
import { parse as parseYaml } from "yaml";
import { isValidEntryName } from "../core/dirs";
import { pluginDirName } from "../core/plugins";
import { SOFTWARE, type ServerSoftwareType } from "../software/catalog";
import { readJarEntries } from "./jarEntries";
import { listServerFiles, ServerFileMissingError, type ServerFilesDeps } from "./serverFiles";

// Where an installed plugin or mod keeps its settings, for the Configure
// button. A jar's filename is not its name ("EssentialsX-2.21.jar" writes
// plugins/Essentials), so the name is read from inside the jar, then
// matched against the folders the server has actually created.

export interface AddonConfigLocation {
    /** the name the add-on gives itself, when its jar says */
    name: string | null;
    /** what to open in the Files tab; null when there is nothing yet */
    reveal: { path: string; kind: "file" | "folder" } | null;
    /** why `reveal` is null */
    message?: string;
}

const PLUGIN_DESCRIPTORS = ["paper-plugin.yml", "plugin.yml"] as const;
const MOD_DESCRIPTORS = ["fabric.mod.json", "quilt.mod.json", "META-INF/neoforge.mods.toml", "META-INF/mods.toml"] as const;

function stringField(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** the plugin's `name` from paper-plugin.yml or plugin.yml */
export function pluginNameFrom(entries: Map<string, string>): string | null {
    for (const file of PLUGIN_DESCRIPTORS) {
        const text = entries.get(file);
        if (text === undefined) continue;
        const doc = parseYaml(text) as { name?: unknown } | null;
        const name = stringField(doc?.name);
        if (name) return name;
    }
    return null;
}

/** the mod id from fabric.mod.json, quilt.mod.json or a (neo)forge mods.toml */
export function modIdFrom(entries: Map<string, string>): string | null {
    const fabric = entries.get("fabric.mod.json");
    if (fabric !== undefined) {
        const id = stringField((JSON.parse(fabric) as { id?: unknown })?.id);
        if (id) return id;
    }
    const quilt = entries.get("quilt.mod.json");
    if (quilt !== undefined) {
        const id = stringField((JSON.parse(quilt) as { quilt_loader?: { id?: unknown } })?.quilt_loader?.id);
        if (id) return id;
    }
    for (const file of ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"]) {
        const text = entries.get(file);
        const match = text?.match(/^\s*modId\s*=\s*["']([^"']+)["']/m);
        if (match) return match[1]!;
    }
    return null;
}

// a plugin may name its folder "<name>Data" (GriefPreventionData); any other
// suffix is more likely a different plugin (EssentialsChat is not Essentials)
const DATA_SUFFIX = /^[-_ ]?(data|config)$/i;

/** the plugin's data folder: exact name, then any case, then "<name>Data" */
export function matchPluginFolder(name: string, folders: string[]): string | null {
    const exact = folders.find((folder) => folder === name);
    if (exact) return exact;
    const lower = name.toLowerCase();
    const anyCase = folders.find((folder) => folder.toLowerCase() === lower);
    if (anyCase) return anyCase;
    return folders.find((folder) => folder.toLowerCase().startsWith(lower) && DATA_SUFFIX.test(folder.slice(name.length))) ?? null;
}

/** a mod's entry in config/: its own folder, or its best-named file */
export function matchModConfig(id: string, entries: { name: string; kind: "file" | "folder" }[]) {
    const lower = id.toLowerCase();
    const folder = entries.find((entry) => entry.kind === "folder" && entry.name.toLowerCase() === lower);
    if (folder) return folder;
    const files = entries.filter((entry) => {
        if (entry.kind !== "file") return false;
        const name = entry.name.toLowerCase();
        return name.startsWith(lower) && [".", "-", "_"].includes(name.charAt(lower.length));
    });
    const rank = (name: string) => {
        const rest = name.toLowerCase().slice(lower.length);
        if (rest.startsWith("-server.")) return 0;
        if (rest.startsWith(".")) return 1;
        if (rest.startsWith("-common.")) return 2;
        return 3;
    };
    return files.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))[0] ?? null;
}

async function listOrEmpty(dir: string, deps: ServerFilesDeps) {
    try {
        return (await listServerFiles(dir, deps)).entries;
    } catch (err) {
        // only a folder the server has not created yet counts as empty
        if (err instanceof ServerFileMissingError) return [];
        throw err;
    }
}

export async function locateAddonConfig(
    filename: unknown,
    software: ServerSoftwareType,
    deps: ServerFilesDeps,
): Promise<AddonConfigLocation> {
    const addons = SOFTWARE[software].addons;
    if (!addons) throw new Error("This server software has no plugins or mods.");
    if (typeof filename !== "string" || !isValidEntryName(filename) || !filename.toLowerCase().endsWith(".jar")) {
        throw new Error(`Not an installed jar: ${JSON.stringify(filename)}`);
    }
    const jarDir = pluginDirName(software);
    // the jar's own path goes through the same symlink and file checks as the Files tab
    const jarEntries = await listOrEmpty(jarDir, deps);
    if (!jarEntries.some((entry) => entry.kind === "file" && entry.name === filename)) {
        throw new Error(`${filename} is not in ${jarDir}/ any more.`);
    }
    const root = await deps.serverDir();
    const jarPath = nodePath.join(root, jarDir, filename);

    if (addons.kind === "plugin") {
        const name = pluginNameFrom(await readJarEntries(jarPath, PLUGIN_DESCRIPTORS));
        if (!name) {
            return { name, reveal: null, message: `${filename} does not name itself, so Paperboard cannot tell which folder is its own.` };
        }
        const folders = (await listOrEmpty("plugins", deps)).filter((entry) => entry.kind === "folder").map((entry) => entry.name);
        const folder = matchPluginFolder(name, folders);
        if (!folder) {
            return { name, reveal: null, message: `${name} has no settings folder yet. Start the server once so it creates one.` };
        }
        const inside = await listServerFiles(`plugins/${folder}`, deps);
        const config =
            inside.entries.find((entry) => entry.kind === "file" && entry.name === "config.yml") ??
            inside.entries.find((entry) => entry.kind === "file" && entry.name.startsWith("config."));
        return config
            ? { name, reveal: { path: config.path, kind: "file" } }
            : { name, reveal: { path: `plugins/${folder}`, kind: "folder" } };
    }

    const id = modIdFrom(await readJarEntries(jarPath, MOD_DESCRIPTORS));
    if (!id) {
        return { name: id, reveal: null, message: `${filename} does not name itself, so Paperboard cannot tell which config is its own.` };
    }
    const match = matchModConfig(id, await listOrEmpty("config", deps));
    if (!match) {
        return {
            name: id,
            reveal: null,
            message: `${id} has no file in config/ yet. Start the server once so it creates one; some mods keep their settings in the world's serverconfig folder, and some have none.`,
        };
    }
    return { name: id, reveal: { path: `config/${match.name}`, kind: match.kind } };
}
