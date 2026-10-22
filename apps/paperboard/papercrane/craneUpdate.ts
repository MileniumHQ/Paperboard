// Self-update resource owner. The publisher signs the archive digest, not
// the extracted executable (scripts/publish.ts stageReleaseAssets).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { extractArchive, packageArchiveSuffix } from "./engineArchives";
import { streamToFileWithProgress, writeJsonAtomicSync } from "./storage";
import { RELEASE_PUBLIC_KEY, releaseMessage, verifyRelease } from "./releaseSignature";

export interface CraneRelease {
    downloadUrl: string;
    version: string;
    sha256: string;
    signature: unknown;
    execPath: string;
    releaseKey?: string;
}

interface PendingCraneUpdate {
    version: string;
    binarySha256: string;
}

async function digestFile(file: string): Promise<string> {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
}

function readPending(execPath: string): PendingCraneUpdate | null {
    const directory = `${execPath}.update`;
    if (!fs.existsSync(directory)) return null;
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid daemon update directory");
    const stateFile = path.join(directory, "state.json");
    // The downloader creates this directory before it can write a record.
    // No executable mutation happens until the record exists.
    if (!fs.existsSync(stateFile)) return null;
    if (fs.statSync(stateFile).size > 4096) throw new Error("Invalid daemon update record size");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (typeof state?.version !== "string" || !state.version ||
        typeof state.binarySha256 !== "string" || !/^[a-f0-9]{64}$/.test(state.binarySha256)) {
        throw new Error("Invalid daemon update record");
    }
    return state;
}

// Called while the new daemon answers an authenticated host's
// system:info. The old daemon's version cannot acknowledge a newer release.
// A matching version AND installed bytes are required before parking ends.
export async function confirmCraneUpdate(execPath: string, runningVersion: string): Promise<boolean> {
    const pending = readPending(execPath);
    if (!pending || pending.version !== runningVersion) return false;
    if (await digestFile(execPath) !== pending.binarySha256) throw new Error("Daemon update executable changed before confirmation");
    await fs.promises.rm(`${execPath}.update`, { recursive: true });
    return true;
}

// The restart supervisor still needs wiring. Its restoration entry point
// atomically renames
// the parked inode over the replacement, even if activation removed it.
// Do not erase recovery bytes if restoring them fails.
export async function restoreCraneUpdate(execPath: string): Promise<void> {
    const directory = `${execPath}.update`;
    const previous = path.join(directory, "previous");
    if (fs.existsSync(previous)) await fs.promises.rename(previous, execPath);
    await fs.promises.rm(directory, { recursive: true, force: true });
}

export async function installCraneRelease(
    release: CraneRelease,
    activate?: () => Promise<void>,
): Promise<{ status: "activated" | "awaiting-restart" }> {
    if (!verifyRelease(releaseMessage.crane(release.version, release.sha256), release.signature, release.releaseKey ?? RELEASE_PUBLIC_KEY)) {
        throw new Error("Refusing update: the binary is not signed by the Paperboard release key");
    }
    // Windows cannot replace a running executable (and ships a node-pty
    // sidecar). Keep its existing refusal until a restart supervisor owns it.
    if (process.platform === "win32") throw new Error("Self-update is not supported on Windows yet");
    const target = `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch}`;
    const name = `papercrane-${target}`;
    if (packageArchiveSuffix(release.downloadUrl) !== ".tar.gz") throw new Error("Expected a published crane .tar.gz archive");

    // Exclusive, fixed per executable: at most one download/replacement and
    // one parked release. A retry cannot overwrite unconfirmed recovery bytes.
    const directory = `${release.execPath}.update`;
    await fs.promises.mkdir(directory, { mode: 0o700 });
    let activated = false;
    try {
        const archive = path.join(directory, "release.tar.gz");
        const contents = path.join(directory, "contents");
        const replacement = path.join(directory, "replacement");
        await streamToFileWithProgress(release.downloadUrl, archive, undefined, undefined, release.sha256);
        // Reuse the bounded scanner and member classifier; no second tar policy.
        await extractArchive(archive, contents);
        const expected = path.join(contents, name);
        if (!fs.existsSync(expected) || !fs.lstatSync(expected).isFile() || fs.lstatSync(expected).size === 0) {
            throw new Error(`Archive does not contain the expected crane binary ${name}`);
        }
        await fs.promises.rename(expected, replacement);
        await fs.promises.chmod(replacement, 0o755);
        const binarySha256 = await digestFile(replacement);
        await fs.promises.rm(contents, { recursive: true });
        await fs.promises.unlink(archive);
        writeJsonAtomicSync(path.join(directory, "state.json"), { version: release.version, binarySha256 }, { mode: 0o600 });
        // Park the old inode without opening a missing-executable window.
        // Both paths are beside the executable, so the replacement is atomic.
        await fs.promises.link(release.execPath, path.join(directory, "previous"));
        await fs.promises.rename(replacement, release.execPath);
        if (!activate) return { status: "awaiting-restart" };
        await activate(); // must observe new behaviour/readiness, never just spawn
        activated = true;
        await confirmCraneUpdate(release.execPath, release.version);
        return { status: "activated" };
    } catch (err) {
        if (!activated) {
            try {
                await restoreCraneUpdate(release.execPath);
            } catch (rollbackError) {
                throw new AggregateError([err, rollbackError], "Daemon update failed and could not restore the previous executable");
            }
        }
        throw err;
    }
}
