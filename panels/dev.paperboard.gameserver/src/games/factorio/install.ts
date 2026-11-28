import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Server } from "../../service/server";
import { PANEL_ID } from "../../service/contract";
import { unlessMissing } from "../../service/failures";
import { runInstallerProcess, type InstallerResult, type InstallerRun } from "../../service/installerProcess";
import { activateRelease } from "../releaseSwap";
import { ARCHIVE_ROOT, EXECUTABLE, releaseFor, type FactorioRelease } from "./catalog";

/** Runs a tool to its exit: the daemon's supervised process, or a test's stand-in. */
export type ToolRunner = (run: InstallerRun) => Promise<InstallerResult>;

/** The server's own tool process (unpacking, making a map, matching mods), apart from the server's. */
export const toolProcessId = (ctx: Server) => `factorio-tool-${ctx.id}`;
export const toolRunner = (ctx: Server): ToolRunner => (run) => runInstallerProcess(run, ctx.process);

/** What an install records beside the release it unpacked. */
export interface InstalledRelease {
    version: string;
    sha256: string;
    source: string;
}
const RECORD = "release.json";

/** The release in an install folder, or null before one is installed. */
export async function installedRelease(installDir: string): Promise<InstalledRelease | null> {
    const text = await unlessMissing(fs.readFile(path.join(installDir, RECORD), "utf8"), null);
    if (text === null) return null;
    const parsed = JSON.parse(text) as Partial<InstalledRelease>;
    if (typeof parsed.version !== "string" || typeof parsed.sha256 !== "string" || typeof parsed.source !== "string") throw new Error(`${RECORD} in Factorio's install is damaged; install Factorio again in Versions`);
    return { version: parsed.version, sha256: parsed.sha256, source: parsed.source };
}

/** The server binary in an install folder. */
export const executableIn = (installDir: string) => path.join(installDir, ARCHIVE_ROOT, ...EXECUTABLE.split("/"));
/** The game data the server reads, in an install folder. */
export const dataIn = (installDir: string) => path.join(installDir, ARCHIVE_ROOT, "data");

async function sha256Of(file: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
}

/** Every entry under `dir` is a plain file or folder: the release has no links. */
async function onlyFilesAndFolders(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await onlyFilesAndFolders(full);
        else if (!entry.isFile()) throw new Error(`Factorio's archive holds something that is not a file: ${entry.name}`);
    }
}

/**
 * Unpacks a downloaded release into `staging`: the archive's size and
 * SHA-256 are checked against the catalog first, then tar (with xz, which it
 * runs) unpacks it. GNU tar keeps every entry inside the folder; what it
 * unpacked must be one `factorio` folder of plain files with the server in it.
 */
export async function unpackRelease(archive: string, staging: string, release: FactorioRelease, run: ToolRunner, id: string): Promise<void> {
    const { size } = await fs.stat(archive);
    if (size !== release.size || (await sha256Of(archive)) !== release.sha256) throw new Error("Factorio's download doesn't match the size and SHA-256 its publisher lists; nothing was installed");
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    let result: InstallerResult;
    try {
        result = await run({ id, command: "tar", args: ["-xJf", archive, "-C", staging, "--no-same-owner"], cwd: staging, timeoutMs: 10 * 60_000 });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" || /ENOENT|not found/i.test(String((err as Error).message))) throw new Error("Unpacking Factorio needs tar, which this computer doesn't have");
        throw err;
    }
    if (result.exitCode !== 0) {
        const said = result.tail.join("\n");
        if (/xz: Cannot exec|xz: not found/i.test(said)) throw new Error("Unpacking Factorio needs xz, which this computer doesn't have; install it (the xz-utils package on Debian and Ubuntu)");
        throw new Error(`Factorio couldn't be unpacked (tar exited with ${result.exitCode}): ${said || "it said nothing"}`);
    }
    const top = await fs.readdir(staging);
    if (top.length !== 1 || top[0] !== ARCHIVE_ROOT) throw new Error(`Factorio's archive should unpack to one ${ARCHIVE_ROOT} folder, not ${top.join(", ") || "nothing"}`);
    await onlyFilesAndFolders(staging);
    const executable = executableIn(staging);
    if (!(await unlessMissing(fs.stat(executable), null))?.isFile()) throw new Error("Factorio's archive has no server in it");
    await fs.access(executable, fs.constants.X_OK);
}

/**
 * Downloads, checks and unpacks a release, then swaps it in for the one
 * installed. The saves, mods and lists live outside the install, so they
 * are never touched.
 */
export async function installRelease(ctx: Server, version: string, run: ToolRunner): Promise<void> {
    const release = releaseFor(version);
    const root = await ctx.root();
    const archive = ".factorio-download.tar.xz";
    const staging = path.join(root, ".factorio-install");
    const target = path.join(root, "install");
    ctx.setState({ installProgress: { stage: "downloading", percent: 0 } });
    let lastProgress = -1;
    let lastStage = "";
    try {
        await ctx.files.download({
            appId: PANEL_ID, targetPath: archive, url: release.url, sha256: release.sha256,
            onProgress: (p) => {
                const percent = Math.floor(p.percent);
                if (percent === lastProgress && p.stage === lastStage) return;
                lastProgress = percent;
                lastStage = p.stage;
                const bytes = p.bytesLoaded !== undefined && p.bytesTotal ? { bytes: { done: p.bytesLoaded, total: p.bytesTotal } } : {};
                ctx.setState({ installProgress: { stage: p.stage === "starting" ? "downloading" : p.stage, percent, ...bytes } });
            },
        });
        ctx.setState({ installProgress: { stage: "installing", percent: 0 } });
        await unpackRelease(path.join(root, archive), staging, release, run, toolProcessId(ctx));
        const record: InstalledRelease = { version: release.version, sha256: release.sha256, source: release.url };
        await fs.writeFile(path.join(staging, RECORD), JSON.stringify(record, null, 2));
        await activateRelease(staging, target, "Factorio");
        ctx.setState({ installProgress: { stage: "completed", percent: 100 } });
    } catch (err) {
        ctx.setState({ installProgress: { stage: "error", percent: 0 } });
        throw err;
    } finally {
        await fs.rm(path.join(root, archive), { force: true });
        await fs.rm(staging, { recursive: true, force: true });
    }
}
