import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "../serviceKit";
import { mapName } from "./config";

// How srcds picks the maps it cycles through, as the Team Fortress 2 server
// (build 11191711) does it: the `mapcyclefile` console variable names a text
// file (mapcycle.txt unless set), looked for in cfg/ and then as written, in
// the game folder or a custom/ folder; without one the server reads
// cfg/mapcycle_default.txt. The file is one map per line, with no .bsp. A line
// starting with // is a comment; one that ends in a comment is a map named
// "cp_dustbowl//comment" and fails. A byte order mark ruins the first line.
// A map that isn't installed is skipped, and the file is read again whenever
// it changes, with no restart; `mapcyclefile` itself can be set on a running
// server.

/** The file Paperboard writes into the game's cfg folder when the rotation is set here. */
export const PAPERBOARD_MAPCYCLE = "paperboard_mapcycle.txt";
/** The console variable's default, which the engine reads when nothing sets it. */
export const DEFAULT_MAPCYCLE = "mapcycle.txt";
/** What the engine reads when the variable's file is not found. */
export const FALLBACK_MAPCYCLE = "cfg/mapcycle_default.txt";

/** Maps the game ships for the menu or tests, which are no place to play. */
const HIDDEN_MAPS = new Set(["background01", "itemtest"]);

/** What a map cycle file lists, as the server reads it. */
export function parseMapCycle(text: string): string[] {
    const maps: string[] = [];
    for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
        const line = raw.trim();
        if (line && !line.startsWith("//")) maps.push(line);
    }
    return maps;
}

/** The file for a rotation: one map per line, nothing the server would read as part of a name. */
export function mapCycleFile(maps: readonly string[]): string {
    return `${["// Written by Paperboard from the Maps tab. Edit the rotation there; this file is rewritten at each start.", ...maps].join("\n")}\n`;
}

/** The maps a request names, in order: each a valid name, installed, and listed once. */
export function checkRotation(value: unknown, installed: readonly string[]): string[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error("Choose at least one map for the rotation");
    const available = new Set(installed);
    const seen = new Set<string>();
    return value.map((entry) => {
        const map = mapName(entry);
        if (!available.has(map)) throw new Error(`${map} is not installed`);
        if (seen.has(map)) throw new Error(`${map} is in the rotation twice`);
        seen.add(map);
        return map;
    });
}

/**
 * The map file name a server.cfg sets, if any. Paperboard's start-up config
 * is followed by the user's, so theirs wins, and the rotation page says so.
 */
export function cfgMapCycleFile(cfg: string): string | null {
    let file: string | null = null;
    for (const line of cfg.split(/\r?\n/)) {
        const set = /^\s*mapcyclefile\s+(?:"([^"]*)"|([^\s;"]+))/i.exec(line);
        if (set) file = set[1] ?? set[2]!;
    }
    return file;
}

/** The folders srcds loads a game's files from, in the order it searches them: custom/ ones, then the game's own. */
async function searchFolders(gameDir: string): Promise<string[]> {
    let custom: string[] = [];
    try {
        custom = (await fs.readdir(path.join(gameDir, "custom"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => path.join(gameDir, "custom", e.name)).sort();
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return [...custom, gameDir];
}

/** The maps a server can start on: .bsp files in the game's maps folder and in custom/ folders' maps. */
export async function installedMaps(gameDir: string): Promise<string[]> {
    const names = new Set<string>();
    let found = false;
    for (const folder of await searchFolders(gameDir)) {
        let entries: string[];
        try {
            entries = await fs.readdir(path.join(folder, "maps"));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw err;
        }
        found = true;
        for (const entry of entries) {
            if (!entry.endsWith(".bsp")) continue;
            const name = entry.slice(0, -4);
            if (!HIDDEN_MAPS.has(name)) names.add(name);
        }
    }
    if (!found) throw new Error("No maps folder; install the game in Updates first");
    return [...names].sort();
}

/** A map's file, if the server can load it. */
export async function findMap(gameDir: string, map: string): Promise<string | null> {
    for (const folder of await searchFolders(gameDir)) {
        const file = path.join(folder, "maps", `${map}.bsp`);
        if (await exists(file)) return file;
    }
    return null;
}

/**
 * The file the server reads for `mapcyclefile`, relative to the game folder,
 * and what it lists; null when the variable's file and the engine's fallback
 * are both missing.
 */
export async function readServerCycle(gameDir: string, variable: string): Promise<{ file: string; maps: string[] } | null> {
    const folders = await searchFolders(gameDir);
    for (const name of [`cfg/${variable}`, variable, FALLBACK_MAPCYCLE]) {
        for (const folder of folders) {
            const file = path.join(folder, name);
            if (await exists(file)) return { file: path.relative(gameDir, file), maps: parseMapCycle(await fs.readFile(file, "utf8")) };
        }
    }
    return null;
}
