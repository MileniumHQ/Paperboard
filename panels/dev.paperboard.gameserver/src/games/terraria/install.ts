import { PANEL_ID } from "../../service/contract";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { files, type ServiceContext } from "../../service/api";
import type { GameServerState } from "../../service/types";
import { releaseFor, entrypoint } from "./catalog";

export async function unpackArchive(archive: Uint8Array, target: string, version: string, os: string): Promise<void> {
    const release = releaseFor(version);
    if (archive.length !== release.size || createHash("sha256").update(archive).digest("hex") !== release.sha256) throw new Error("Terraria archive size/SHA-256 mismatch; nothing was installed");
    const folder = entrypoint(os).split("/")[0]!;
    const prefix = `${release.directory}/${folder}/`;
    const entries = unzipSync(archive, { filter: file => file.name.startsWith(prefix) });
    for (const [name, bytes] of Object.entries(entries)) {
        const relative = name.slice(prefix.length);
        if (!relative) continue;
        if (relative.split("/").some(p => p === ".." || p === ".") || relative.includes("\\") || path.isAbsolute(relative)) throw new Error(`Unsafe archive entry: ${name}`);
        const to = path.join(target, folder, relative);
        if (name.endsWith("/")) await fs.mkdir(to, { recursive: true });
        else { await fs.mkdir(path.dirname(to), { recursive: true }); await fs.writeFile(to, bytes); }
    }
    const executable = path.join(target, entrypoint(os));
    if (!(await fs.stat(executable)).isFile()) throw new Error("Terraria archive has no server executable");
    if (os !== "win32") await fs.chmod(executable, 0o755);
}
async function exists(file: string): Promise<boolean> {
    try { await fs.access(file); return true; }
    catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return false; throw err; }
}
/** Both names contain only managed release files, never worlds or settings. */
export async function recoverRelease(target: string): Promise<void> {
    const previous = `${target}.previous`;
    if (!(await exists(previous))) return;
    if (await exists(target)) await fs.rm(previous, { recursive: true });
    else await fs.rename(previous, target);
}
export async function activateRelease(staging: string, target: string): Promise<void> {
    const previous = `${target}.previous`;
    if (await exists(previous)) throw new Error("A Terraria release swap needs recovery; restart the panel service before installing");
    const replacing = await exists(target);
    if (replacing) await fs.rename(target, previous);
    try { await fs.rename(staging, target); }
    catch (err) { if (replacing) await fs.rename(previous, target); throw err; }
    if (replacing) await fs.rm(previous, { recursive: true });
}
export async function install(ctx: ServiceContext<GameServerState>, version: string): Promise<void> {
    const release = releaseFor(version);
    const root = await files.getPath("", PANEL_ID);
    const archive = ".terraria-download.zip";
    const staging = path.join(root, ".terraria-install");
    const target = path.join(root, "install", release.directory);
    ctx.setState({ installProgress: { stage: "downloading", percent: 0 } });
    let lastProgress = -1;
    let lastStage = "";
    try {
        await files.download({ appId: PANEL_ID, targetPath: archive, url: release.url, sha256: release.sha256, onProgress: p => { const percent = Math.floor(p.percent); if (percent === lastProgress && p.stage === lastStage) return; lastProgress = percent; lastStage = p.stage; ctx.setState({ installProgress: { stage: p.stage === "starting" ? "downloading" : p.stage, percent } }); } });
        await fs.rm(staging, { recursive: true, force: true });
        await unpackArchive(await fs.readFile(path.join(root, archive)), staging, version, process.platform);
        await fs.writeFile(path.join(staging, "manifest.json"), JSON.stringify({ version, source: release.url, sha256: release.sha256, os: process.platform, arch: process.arch }));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await activateRelease(staging, target);
        ctx.setState({ installProgress: { stage: "completed", percent: 100 } });
    } catch (err) {
        ctx.setState({ installProgress: { stage: "error", percent: 0 } });
        throw err;
    } finally {
        await fs.rm(path.join(root, archive), { force: true });
        await fs.rm(staging, { recursive: true, force: true });
    }
}
