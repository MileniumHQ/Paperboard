import fs from "node:fs/promises";
import path from "node:path";
import { fileApi as rawFiles } from "@mileniumhq/paperapi";
import { packages as packageApi } from "../../service/api";
import { PANEL_ID } from "../../service/types";
import { runInstallerProcess, stopLeftoverInstaller, type InstallerRun } from "../../service/installerProcess";

// SteamCMD, shared by every server of the panel. Origami's `steamcmd` package
// is Valve's bootstrap; SteamCMD updates itself into its own folder, so it is
// copied into a workspace the panel owns and run from there, never from the
// package store. Its HOME is the workspace too, keeping it away from the
// user's own Steam. One run at a time: SteamCMD's state is not shareable.

export const STEAMCMD_PROC_ID = "steamcmd";
const PACKAGE = "steamcmd";
/** a first run downloads SteamCMD's own update before the item */
const TIMEOUT_MS = 30 * 60_000;
const ID = /^[1-9]\d{0,19}$/;

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    // the next run waits for this one to settle; its failure reaches its own caller through `run`
    queue = Promise.allSettled([run]);
    return run;
}

/** the panel's SteamCMD folder; a test hands its own */
const workspace = (own?: string) => (own ? Promise.resolve(own) : rawFiles.getPath(".steam", PANEL_ID));

function bootstrapName(platform = process.platform): string {
    if (platform === "win32") return "steamcmd.exe";
    if (platform === "linux" || platform === "darwin") return "steamcmd.sh";
    throw new Error(`SteamCMD does not run on ${platform}`);
}

/** Installs the package when missing and copies its bootstrap into the workspace once. */
async function prepare(own?: string): Promise<{ command: string; root: string; home: string }> {
    const root = await workspace(own);
    const bin = path.join(root, "steamcmd");
    const command = path.join(bin, bootstrapName());
    const present = await fs.stat(command).then(s => s.isFile(), (err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return false; throw err; });
    if (!present) {
        if (!(await packageApi.isInstalled(PACKAGE))) await packageApi.download(PACKAGE);
        const source = path.join(await packageApi.getPath(PACKAGE), "bin");
        await fs.rm(bin, { recursive: true, force: true });
        await fs.mkdir(root, { recursive: true });
        await fs.cp(source, bin, { recursive: true });
        if (process.platform !== "win32") await fs.chmod(command, 0o755);
    }
    const home = path.join(root, "home");
    await fs.mkdir(home, { recursive: true });
    return { command, root, home };
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** What SteamCMD said about each item; null when it said nothing about one. */
export function parseDownloads(lines: string[], ids: readonly string[]): Map<string, { ok: true; path: string } | { ok: false; reason: string }> {
    const results = new Map<string, { ok: true; path: string } | { ok: false; reason: string }>();
    for (const raw of lines) {
        const line = raw.replace(ANSI, "");
        const success = /Success\. Downloaded item (\d+) to "([^"]+)"/.exec(line);
        if (success && ids.includes(success[1]!)) results.set(success[1]!, { ok: true, path: success[2]! });
        const failure = /ERROR! Download item (\d+) failed \(([^)]*)\)/.exec(line);
        if (failure && ids.includes(failure[1]!)) results.set(failure[1]!, { ok: false, reason: failure[2]! });
    }
    return results;
}

export type Runner = (run: InstallerRun) => Promise<{ exitCode: number; tail: string[] }>;

/**
 * Downloads Workshop items anonymously and returns each item's folder.
 * Every item must be confirmed by SteamCMD's output and exist on disk;
 * anything else fails the whole download, naming the item.
 */
export function downloadWorkshopItems(appId: number, ids: readonly string[], options: { onLine?: (line: string) => void; runner?: Runner; workspace?: string } = {}): Promise<Map<string, string>> {
    if (ids.length === 0) throw new Error("Choose a Workshop item to download");
    for (const id of ids) if (!ID.test(id)) throw new Error(`Not a Workshop item id: ${id}`);
    return serialized(async () => {
        const { command, root, home } = await prepare(options.workspace);
        const target = path.join(root, "workshop");
        await fs.mkdir(target, { recursive: true });
        // a service restart can leave a run behind; it holds the workspace. A
        // runner handed in owns its own processes
        if (!options.runner) await stopLeftoverInstaller(undefined, undefined, undefined, STEAMCMD_PROC_ID);
        const lines: string[] = [];
        const run = options.runner ?? ((r: InstallerRun) => runInstallerProcess(r));
        const result = await run({
            id: STEAMCMD_PROC_ID,
            command,
            // force_install_dir must come before login
            args: ["+force_install_dir", target, "+login", "anonymous", ...ids.flatMap(id => ["+workshop_download_item", String(appId), id]), "+quit"],
            cwd: path.dirname(command),
            env: { HOME: home },
            timeoutMs: TIMEOUT_MS,
            onLine: line => { lines.push(line); options.onLine?.(line.replace(ANSI, "")); },
        });
        const outcome = parseDownloads(lines, ids);
        const folders = new Map<string, string>();
        const problems: string[] = [];
        for (const id of ids) {
            const item = outcome.get(id);
            const folder = path.join(target, "steamapps", "workshop", "content", String(appId), id);
            if (!item) problems.push(`${id}: SteamCMD did not report the download`);
            else if (!item.ok) problems.push(`${id}: ${item.reason || "download failed"}`);
            else if (!(await fs.stat(folder).then(s => s.isDirectory(), () => false))) problems.push(`${id}: SteamCMD reported success but left no files`);
            else folders.set(id, folder);
        }
        if (problems.length > 0 || result.exitCode !== 0) {
            const tail = result.tail.map(l => l.replace(ANSI, "")).slice(-8).join("\n");
            throw new Error(`Steam Workshop download failed${result.exitCode !== 0 ? ` (SteamCMD exited with ${result.exitCode})` : ""}. ${problems.join("; ")}${tail ? `\n${tail}` : ""}`);
        }
        return folders;
    });
}

/** Removes downloaded items from the workspace once their files are copied out. */
export async function discardWorkshopItems(appId: number, ids: readonly string[], own?: string): Promise<void> {
    const root = await workspace(own);
    for (const id of ids) {
        if (!ID.test(id)) throw new Error(`Not a Workshop item id: ${id}`);
        await fs.rm(path.join(root, "workshop", "steamapps", "workshop", "content", String(appId), id), { recursive: true, force: true });
    }
}
