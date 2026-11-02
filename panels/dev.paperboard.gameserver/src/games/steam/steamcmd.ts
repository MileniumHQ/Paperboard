import fs from "node:fs/promises";
import path from "node:path";
import { fileApi as rawFiles } from "@mileniumhq/paperapi";
import { packages as packageApi } from "../../service/api";
import { PANEL_ID } from "../../service/types";
import { runInstallerProcess, stopLeftoverInstaller, type InstallerRun } from "../../service/installerProcess";

// SteamCMD, shared by every server of the panel: Workshop items and whole
// dedicated servers (`installApp`). Origami's `steamcmd` package
// is Valve's bootstrap; SteamCMD updates itself into its own folder, so it is
// copied into a workspace the panel owns and run from there, never from the
// package store. Its HOME is the workspace too, keeping it away from the
// user's own Steam. One run at a time: SteamCMD's state is not shareable.

export const STEAMCMD_PROC_ID = "steamcmd";
const PACKAGE = "steamcmd";
/** a first run downloads SteamCMD's own update before the item */
const TIMEOUT_MS = 30 * 60_000;
/** a dedicated server is gigabytes; a slow connection takes hours */
const APP_TIMEOUT_MS = 6 * 60 * 60_000;
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

/** SteamCMD on Windows after updating itself: "Update complete, launching..." */
const SELF_UPDATED = 7;

/**
 * SteamCMD on Windows updates itself in place, then exits with 7 and hands
 * the rest of its commands to a relaunched copy nobody watches: a download
 * would finish unseen and be reported failed. A run that only quits takes
 * the update first, so the real run is the one watched. Linux's steamcmd.sh
 * restarts itself and needs none of this.
 */
export async function takeSelfUpdate(run: Runner, command: string, home: string, platform = process.platform): Promise<void> {
    if (platform !== "win32") return;
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await run({ id: STEAMCMD_PROC_ID, command, args: ["+quit"], cwd: path.dirname(command), env: { HOME: home }, timeoutMs: TIMEOUT_MS });
        if (result.exitCode === 0) return;
        if (result.exitCode !== SELF_UPDATED) {
            const tail = result.tail.map(l => l.replace(ANSI, "")).slice(-8).join("\n");
            throw new Error(`SteamCMD could not start (exited with ${result.exitCode})${tail ? `\n${tail}` : ""}`);
        }
    }
    throw new Error("SteamCMD updated itself three times in a row without settling; try again");
}

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
        await takeSelfUpdate(run, command, home);
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
            else if (!(await fs.stat(folder).then(s => s.isDirectory(), (err: NodeJS.ErrnoException) => { if (err.code === "ENOENT") return false; throw err; }))) problems.push(`${id}: SteamCMD reported success but left no files`);
            else folders.set(id, folder);
        }
        if (problems.length > 0 || result.exitCode !== 0) {
            const tail = result.tail.map(l => l.replace(ANSI, "")).slice(-8).join("\n");
            throw new Error(`Steam Workshop download failed${result.exitCode !== 0 ? ` (SteamCMD exited with ${result.exitCode})` : ""}. ${problems.join("; ")}${tail ? `\n${tail}` : ""}`);
        }
        return folders;
    });
}

/** SteamCMD's progress through an app download: "Update state (0x61) downloading, progress: 12.34 (…)". */
export function parseAppProgress(line: string): { stage: "downloading" | "verifying" | "preallocating"; percent: number } | null {
    const match = /Update state \(0x[0-9a-f]+\) (downloading|verifying install|verifying update|preallocating|reconfiguring|committing)[^,]*, progress: ([\d.]+)/i.exec(line.replace(ANSI, ""));
    if (!match) return null;
    const state = match[1]!.toLowerCase();
    const stage = state.startsWith("verifying") ? "verifying" : state === "preallocating" ? "preallocating" : "downloading";
    return { stage, percent: Math.max(0, Math.min(100, Number(match[2]))) };
}

/** Did SteamCMD confirm the app installed? Its exit code alone does not say. */
export function parseAppResult(lines: readonly string[], appId: number): { ok: true } | { ok: false; reason: string } | null {
    for (const raw of [...lines].reverse()) {
        const line = raw.replace(ANSI, "");
        if (new RegExp(`Success! App '${appId}' (fully installed|already up to date)`).test(line)) return { ok: true };
        const error = new RegExp(`ERROR! Failed to install app '${appId}' \\(([^)]*)\\)|Error! App '${appId}' state is (0x[0-9a-f]+)[^\\n]*`, "i").exec(line);
        if (error) return { ok: false, reason: error[1] ?? `state ${error[2]}` };
    }
    return null;
}

/**
 * SteamCMD's 64-bit Steam client library. Dedicated servers that log in to
 * Steam load it from ~/.steam/sdk64; they do not ship it themselves.
 */
export async function steamClientLibrary(own?: string): Promise<string> {
    if (process.platform !== "linux") throw new Error(`Steam's client library is copied for Linux servers, not ${process.platform}`);
    const { command } = await prepare(own);
    const library = path.join(path.dirname(command), "linux64", "steamclient.so");
    await fs.access(library).catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") throw new Error("SteamCMD has not unpacked its Steam client library yet; install the server again in Updates");
        throw err;
    });
    return library;
}

/** The build SteamCMD installed, from the app manifest it leaves in the folder; null before any install. */
export async function installedBuild(appId: number, dir: string): Promise<string | null> {
    let text: string;
    try { text = await fs.readFile(path.join(dir, "steamapps", `appmanifest_${appId}.acf`), "utf8"); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return null; throw err; }
    const build = /"buildid"\s+"(\d+)"/.exec(text)?.[1];
    if (!build) throw new Error(`Steam's app manifest for ${appId} names no build`);
    return build;
}

type VdfNode = string | Map<string, VdfNode>;
type VdfToken = { brace: "{" | "}" } | { text: string };

/** Valve's text format (KeyValues): quoted keys with a quoted value or a braced block of more. */
function parseVdfBlock(text: string): Map<string, VdfNode> {
    const pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|([{}]))/y;
    const next = (): VdfToken => {
        const match = pattern.exec(text);
        if (!match) throw new Error("Steam's app information is cut short");
        return match[2] ? { brace: match[2] as "{" | "}" } : { text: match[1]!.replace(/\\(.)/g, "$1") };
    };
    const block = (): Map<string, VdfNode> => {
        const entries = new Map<string, VdfNode>();
        for (;;) {
            const key = next();
            if ("brace" in key) {
                if (key.brace === "}") return entries;
                throw new Error("Steam's app information has a stray brace");
            }
            const value = next();
            if ("text" in value) entries.set(key.text, value.text);
            else if (value.brace === "{") entries.set(key.text, block());
            else throw new Error(`Steam's app information has no value for "${key.text}"`);
        }
    };
    const open = next();
    if (!("brace" in open) || open.brace !== "{") throw new Error("Steam's app information does not open a block");
    return block();
}

/**
 * The newest public build of an app, from what `+app_info_print` printed: the
 * block named for the app (SteamCMD's own log lines surround it), and in it
 * depots, branches, public, buildid. Throws when the output holds none.
 */
export function parseLatestBuild(lines: readonly string[], appId: number): string {
    const clean = lines.map(l => l.replace(ANSI, ""));
    const start = clean.findIndex((l, i) => l.trim() === `"${appId}"` && clean[i + 1]?.trim() === "{");
    if (start < 0) throw new Error(`SteamCMD printed no information for app ${appId}`);
    const info = parseVdfBlock(clean.slice(start + 1).join("\n"));
    const child = (node: VdfNode | undefined, key: string) => (node instanceof Map ? node.get(key) : undefined);
    const id = child(child(child(info.get("depots"), "branches"), "public"), "buildid");
    if (typeof id !== "string" || !/^\d+$/.test(id)) throw new Error(`Steam lists no public build for app ${appId}`);
    return id;
}

/**
 * The newest public build of a Steam app, asked of Steam anonymously. It
 * waits for any install in progress: SteamCMD's state is not shareable.
 */
export function latestBuild(appId: number, options: { runner?: Runner; workspace?: string } = {}): Promise<string> {
    if (!Number.isInteger(appId) || appId <= 0) throw new Error(`Not a Steam app id: ${appId}`);
    return serialized(async () => {
        const { command, home } = await prepare(options.workspace);
        if (!options.runner) await stopLeftoverInstaller(undefined, undefined, undefined, STEAMCMD_PROC_ID);
        const run = options.runner ?? ((r: InstallerRun) => runInstallerProcess(r));
        await takeSelfUpdate(run, command, home);
        const lines: string[] = [];
        const result = await run({
            id: STEAMCMD_PROC_ID,
            command,
            args: ["+login", "anonymous", "+app_info_update", "1", "+app_info_print", String(appId), "+quit"],
            cwd: path.dirname(command),
            env: { HOME: home },
            timeoutMs: TIMEOUT_MS,
            onLine: line => { lines.push(line); },
        });
        try {
            if (result.exitCode !== 0) throw new Error(`SteamCMD exited with ${result.exitCode}`);
            return parseLatestBuild(lines, appId);
        } catch (err) {
            const tail = result.tail.map(l => l.replace(ANSI, "")).slice(-8).join("\n");
            throw new Error(`Could not read the newest build of app ${appId}: ${(err as Error).message}${tail ? `\n${tail}` : ""}`);
        }
    });
}

/**
 * Installs or updates a Steam dedicated server anonymously into `dir` and
 * returns the build installed. Only SteamCMD's own success line counts; a
 * download it does not confirm fails, quoting its last lines.
 */
export function installApp(appId: number, dir: string, options: { onProgress?: (progress: { stage: string; percent: number }) => void; onLine?: (line: string) => void; runner?: Runner; workspace?: string } = {}): Promise<string> {
    if (!Number.isInteger(appId) || appId <= 0) throw new Error(`Not a Steam app id: ${appId}`);
    if (!path.isAbsolute(dir)) throw new Error("A Steam app installs into an absolute folder");
    return serialized(async () => {
        const { command, home } = await prepare(options.workspace);
        await fs.mkdir(dir, { recursive: true });
        if (!options.runner) await stopLeftoverInstaller(undefined, undefined, undefined, STEAMCMD_PROC_ID);
        const run = options.runner ?? ((r: InstallerRun) => runInstallerProcess(r));
        await takeSelfUpdate(run, command, home);
        const attempt = async () => {
            const lines: string[] = [];
            const result = await run({
                id: STEAMCMD_PROC_ID,
                command,
                args: ["+force_install_dir", dir, "+login", "anonymous", "+app_update", String(appId), "validate", "+quit"],
                cwd: path.dirname(command),
                env: { HOME: home },
                timeoutMs: APP_TIMEOUT_MS,
                onLine: line => {
                    lines.push(line);
                    const progress = parseAppProgress(line);
                    if (progress) options.onProgress?.(progress);
                    options.onLine?.(line.replace(ANSI, ""));
                },
            });
            return { result, outcome: parseAppResult(lines, appId) };
        };
        let { result, outcome } = await attempt();
        // a SteamCMD that has never fetched the app's configuration answers
        // its first app_update with "Missing configuration"; the second run has it
        if (outcome && !outcome.ok && outcome.reason === "Missing configuration") ({ result, outcome } = await attempt());
        if (!outcome?.ok || result.exitCode !== 0) {
            const reason = outcome && !outcome.ok ? outcome.reason : "SteamCMD did not confirm the install";
            const tail = result.tail.map(l => l.replace(ANSI, "")).slice(-8).join("\n");
            throw new Error(`Steam download of app ${appId} failed: ${reason}${result.exitCode !== 0 ? ` (SteamCMD exited with ${result.exitCode})` : ""}${tail ? `\n${tail}` : ""}`);
        }
        const build = await installedBuild(appId, dir);
        if (!build) throw new Error(`SteamCMD reported app ${appId} installed but left no app manifest`);
        return build;
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
