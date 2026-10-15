// The backup archive: a gzipped tar of the panel's entries relative to the
// data dir (files/<dir>/... and configs/<id>.json). Symlinks are never
// archived. Extraction accepts only those two entries, under the shared
// tar budget and escape scan, so an archive cannot write anywhere else.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as tar from "tar";
import { logger } from "../logger";
import { LimitError, makeSafeTarFilter, scanTarMembers, TAR_BUDGET } from "../storage";

export interface PanelDataEntries {
    /** "files/<dir>" */
    files: string;
    /** "configs/<id>.json" */
    config: string;
}

function measure(dir: string): { bytes: number; entries: number } {
    let bytes = 0;
    let entries = 0;
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (++entries > TAR_BUDGET.maxEntries) throw new LimitError(`The panel's storage has more than ${TAR_BUDGET.maxEntries} entries`);
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (entry.isFile()) bytes += fs.statSync(full).size;
            if (bytes > TAR_BUDGET.maxBytes) throw new LimitError(`The panel's storage is larger than ${TAR_BUDGET.maxBytes} bytes`);
        }
    }
    return { bytes, entries };
}

export async function sha256File(file: string): Promise<string> {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
}

/**
 * Streams a tar pack into outFile and closes every handle on failure. Not tar's
 * own `file` option and not stream.pipeline: the first leaves the output open,
 * the second destroys the pack mid-member, and an open handle makes every later
 * rename of that path fail with EPERM on Windows. On failure the walk stops, and a
 * member still being read is drained so its file closes by itself.
 */
async function writePack(pack: tar.Pack, outFile: string, stop: () => void): Promise<void> {
    const out = fs.createWriteStream(outFile);
    const closed = new Promise<void>((resolve) => out.once("close", () => resolve()));
    const failed = new Promise<never>((_, reject) => {
        pack.on("error", reject);
        out.on("error", reject);
    });
    // a rejection nobody awaits yet (the write finished first) is not unhandled
    failed.catch((err) => logger.debug("[backups] archive stream ended with an error after settling:", err));
    pack.pipe(out);
    try {
        await Promise.race([closed, failed]);
    } catch (err) {
        stop();
        pack.unpipe(out);
        pack.resume();
        out.destroy();
        await closed;
        throw err;
    }
}

/** writes the archive to outFile; resolves with its size and sha256 */
export async function createPanelArchive(
    dataDir: string,
    entries: PanelDataEntries,
    outFile: string,
): Promise<{ size: number; sha256: string }> {
    const include: string[] = [];
    const filesDir = path.join(dataDir, entries.files);
    if (fs.existsSync(filesDir)) {
        measure(filesDir);
        include.push(entries.files);
    }
    if (fs.existsSync(path.join(dataDir, entries.config))) include.push(entries.config);
    if (include.length === 0) throw new Error("The panel has no files or settings to back up");
    let stopped = false;
    const pack = tar.c(
        {
            gzip: true,
            cwd: dataDir,
            portable: true,
            // one member at a time: tar parks the other members it already
            // opened behind a failed one, and they hold their files open
            jobs: 1,
            // creating reads the disk, so entries are fs.Stats; no links
            filter: (_p: string, stat: fs.Stats | tar.ReadEntry) => !stopped && "isFile" in stat && (stat.isFile() || stat.isDirectory()),
        },
        include,
    );
    await writePack(pack, outFile, () => { stopped = true; });
    return { size: fs.statSync(outFile).size, sha256: await sha256File(outFile) };
}

/** true for a member path inside the panel's two entries */
export function isPanelDataMember(member: string, entries: PanelDataEntries): boolean {
    const normalized = member.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized === entries.config || normalized === entries.files || normalized.startsWith(`${entries.files}/`);
}

/**
 * Extracts into stagingDir after refusing (at the first offending member)
 * any member outside the panel's entries, any link, and anything over the
 * tar budget. Returns the staged
 * files dir (created empty when the backup had none) and config file.
 */
export async function extractPanelArchive(
    archive: string,
    entries: PanelDataEntries,
    stagingDir: string,
): Promise<{ filesDir: string; configFile: string | null }> {
    await scanTarMembers(archive, stagingDir, 0, ({ path: member, type }) =>
        (type !== "File" && type !== "Directory") || !isPanelDataMember(member, entries)
            ? `The backup holds entries that are not this panel's data: ${type} ${member}`
            : null,
    );
    await tar.x({ file: archive, cwd: stagingDir, filter: makeSafeTarFilter(stagingDir) });
    const filesDir = path.join(stagingDir, entries.files);
    fs.mkdirSync(filesDir, { recursive: true });
    const configFile = path.join(stagingDir, entries.config);
    return { filesDir, configFile: fs.existsSync(configFile) ? configFile : null };
}
