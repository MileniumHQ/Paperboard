import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { ServerSoftwareType } from "../software/catalog";
import {
    LOADER_SETTINGS,
    loaderSetting,
    normalizeLoaderValue,
    type LoaderFile,
    type LoaderSetting,
} from "../software/loaderSettings";
import {
    readCfgValue,
    readTomlValue,
    readYamlValue,
    setCfgValue,
    setTomlValue,
    setYamlValue,
} from "../core/configEdit";
import { parseProperties } from "../core/properties";
import { isListableDirArg } from "../core/dirs";
import { serializedFileTask, writeFileAtomic } from "./fileWrites";

// The Loader tab's owner: finds the config file each setting lives in,
// reads current values, and writes one validated value at a time. Every
// file and key comes from the schema; the caller names a setting id and a
// value, never a path.

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export interface LoaderFs {
    readFile(path: string, encoding: "utf8"): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    stat(path: string): Promise<{ size: number }>;
    rm(path: string, opts: { force: true }): Promise<void>;
}

export interface LoaderDeps {
    serverDir(): Promise<string>;
    fs?: LoaderFs;
}

export interface LoaderSettingView {
    id: string;
    title: string;
    description: string;
    control: LoaderSetting["control"];
    options?: LoaderSetting["options"];
    min?: number;
    max?: number;
    decimal?: boolean;
    warning?: string;
    value: string;
}

export interface LoaderGroupView {
    label: string;
    /** where the file in effect lives, relative to the server folder */
    path: string;
    settings: LoaderSettingView[];
    /** the file exists but could not be read */
    error?: string;
}

export interface LoaderSettingsView {
    software: ServerSoftwareType;
    /** set when this software has nothing to configure */
    emptyMessage: string | null;
    groups: LoaderGroupView[];
    /** schema files that do not exist yet (the server has not created them) */
    missing: string[];
}

function errorCode(err: unknown): string | undefined {
    return (err as { code?: string } | null)?.code;
}

function fsOf(deps: LoaderDeps): LoaderFs {
    return deps.fs ?? (nodeFs as unknown as LoaderFs);
}

async function readCapped(fs: LoaderFs, absolute: string): Promise<string> {
    const { size } = await fs.stat(absolute);
    if (size > MAX_CONFIG_BYTES) throw new Error("The file is larger than a config file should be");
    return fs.readFile(absolute, "utf8");
}

// server.properties' level-name: the world whose per-world configs apply
async function activeWorld(fs: LoaderFs, root: string): Promise<string> {
    let text: string;
    try {
        text = await readCapped(fs, nodePath.join(root, "server.properties"));
    } catch (err) {
        if (errorCode(err) === "ENOENT") return "world";
        throw err;
    }
    const name = parseProperties(text)["level-name"]?.trim() || "world";
    if (!isListableDirArg(name)) throw new Error(`level-name ${JSON.stringify(name)} is not a folder Paperboard can use`);
    return name;
}

/** the first location of a file that exists, or null */
async function locate(fs: LoaderFs, root: string, file: LoaderFile, world: string): Promise<string | null> {
    for (const relative of file.locations(world)) {
        try {
            await fs.stat(nodePath.join(root, ...relative.split("/")));
            return relative;
        } catch (err) {
            if (errorCode(err) !== "ENOENT") throw err;
        }
    }
    return null;
}

function readValue(file: LoaderFile, text: string, setting: LoaderSetting): string | null {
    switch (file.format) {
        case "yaml":
            return readYamlValue(text, setting.path);
        case "toml":
            return readTomlValue(text, setting.path[0]!, setting.path[1]!);
        case "forge-cfg":
            return readCfgValue(text, setting.path[0]!, setting.path[1]!);
    }
}

function writeValue(file: LoaderFile, text: string, setting: LoaderSetting, value: string): string {
    switch (file.format) {
        case "yaml":
            return setYamlValue(text, setting.path, value);
        case "toml":
            return setTomlValue(text, setting.path[0]!, setting.path[1]!, value);
        case "forge-cfg":
            return setCfgValue(text, setting.path[0]!, setting.path[1]!, value);
    }
}

function view(setting: LoaderSetting, value: string): LoaderSettingView {
    const { id, title, description, control, options, min, max, decimal, warning } = setting;
    return { id, title, description, control, options, min, max, decimal, warning, value };
}

export async function readLoaderSettings(
    software: ServerSoftwareType,
    deps: LoaderDeps,
): Promise<LoaderSettingsView> {
    const info = LOADER_SETTINGS[software];
    if (!info.schema) return { software, emptyMessage: info.emptyMessage, groups: [], missing: [] };
    const fs = fsOf(deps);
    const root = await deps.serverDir();
    const world = await activeWorld(fs, root);

    const groups: LoaderGroupView[] = [];
    const missing: string[] = [];
    for (const file of info.schema.files) {
        const relative = await locate(fs, root, file, world);
        const settings = info.schema.settings.filter((setting) => setting.file === file.id);
        if (!relative) {
            missing.push(file.label);
            continue;
        }
        try {
            const text = await readCapped(fs, nodePath.join(root, ...relative.split("/")));
            const shown: LoaderSettingView[] = [];
            for (const setting of settings) {
                const value = readValue(file, text, setting);
                // a key this version's file does not have is not this version's setting
                if (value !== null) shown.push(view(setting, value));
            }
            if (shown.length > 0) groups.push({ label: file.label, path: relative, settings: shown });
        } catch (err) {
            groups.push({
                label: file.label,
                path: relative,
                settings: [],
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { software, emptyMessage: null, groups, missing };
}

export async function writeLoaderSetting(
    software: ServerSoftwareType,
    id: unknown,
    raw: unknown,
    deps: LoaderDeps,
): Promise<{ id: string; value: string; path: string }> {
    const setting = loaderSetting(software, id);
    if (!setting) throw new Error(`Unknown loader setting for this software: ${JSON.stringify(id)}`);
    const value = normalizeLoaderValue(setting, raw);
    const file = LOADER_SETTINGS[software].schema!.files.find((f) => f.id === setting.file)!;
    const fs = fsOf(deps);
    const root = await deps.serverDir();
    const world = await activeWorld(fs, root);
    const relative = await locate(fs, root, file, world);
    if (!relative) throw new Error(`${file.label} does not exist yet. Start the server once so it creates it.`);
    const absolute = nodePath.join(root, ...relative.split("/"));

    return serializedFileTask(absolute, async () => {
        const text = await readCapped(fs, absolute);
        // written whole or not at all: the server reads this file at start
        await writeFileAtomic(fs, absolute, writeValue(file, text, setting, value));
        return { id: setting.id, value, path: relative };
    });
}
