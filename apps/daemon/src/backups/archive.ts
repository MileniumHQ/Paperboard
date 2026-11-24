// The backup archive: a gzipped tar holding data.json (the JSON the panel
// handed over, or null) and, under files/, the paths the panel named in its
// storage. Symlinks are never archived. Extraction accepts only those two
// entries, under the shared tar budget and escape scan, so an archive
// cannot write anywhere else.
import * as fs from "fs";
import * as path from "path";
import * as tar from "tar";
import * as zlib from "zlib";
import { logger } from "../core/logger";
import { hashFile, LimitError } from "../core/storage";
import { makeSafeTarFilter, scanTarMembers, TAR_BUDGET } from "../packages/tarSafety";

/** what an archive is made of: storage paths, what is left out, and the panel's JSON */
export interface ArchiveContents {
    paths: string[];
    exclude: string[];
    skip: string[];
    data: unknown;
}

/** the most JSON a panel may hand over with a backup */
export const BACKUP_DATA_MAX_BYTES = 16 * 1024 * 1024;

const TAR_BLOCK = 512;
const FILES = "files";
const DATA = "data.json";
/** a member's size in the tar stream: its header and its padded data */
const tarSize = (bytes: number) => TAR_BLOCK + Math.ceil(bytes / TAR_BLOCK) * TAR_BLOCK;

/** whether a storage path is left out by the contents' exclude or skip */
function leftOut(relative: string, contents: Pick<ArchiveContents, "exclude" | "skip">): boolean {
    if (contents.skip.includes(path.posix.basename(relative))) return true;
    return contents.exclude.some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`));
}

/** the storage paths tar is given: each named path, or for "" what the storage holds */
function members(storageDir: string, contents: ArchiveContents): string[] {
    const out: string[] = [];
    for (const named of contents.paths) {
        if (named !== "") {
            if (!fs.existsSync(path.join(storageDir, named))) throw new Error(`The panel named ${named} for the backup, but its storage has nothing there`);
            if (!leftOut(named, contents)) out.push(named);
            continue;
        }
        if (!fs.existsSync(storageDir)) continue;
        for (const name of fs.readdirSync(storageDir)) if (!leftOut(name, contents)) out.push(name);
    }
    return out;
}

/** roughly how long the tar stream of these members is, under the tar budget */
function measure(storageDir: string, list: string[], contents: ArchiveContents): number {
    let bytes = 0;
    let entries = 0;
    let tarBytes = 0;
    const stack = [...list];
    while (stack.length) {
        const relative = stack.pop()!;
        const stat = fs.lstatSync(path.join(storageDir, relative));
        if (++entries > TAR_BUDGET.maxEntries) throw new LimitError(`The backup holds more than ${TAR_BUDGET.maxEntries} entries`);
        if (stat.isDirectory()) {
            tarBytes += TAR_BLOCK;
            for (const name of fs.readdirSync(path.join(storageDir, relative))) {
                const child = `${relative}/${name}`;
                if (!leftOut(child, contents)) stack.push(child);
            }
        } else if (stat.isFile()) {
            bytes += stat.size;
            tarBytes += tarSize(stat.size);
        }
        if (bytes > TAR_BUDGET.maxBytes) throw new LimitError(`The backup is larger than ${TAR_BUDGET.maxBytes} bytes`);
    }
    return tarBytes;
}

/** data.json as one tar member: its header, then its bytes padded to a block */
function dataMember(data: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(data ?? null), "utf8");
    if (body.length > BACKUP_DATA_MAX_BYTES) throw new LimitError(`The panel handed over more than ${BACKUP_DATA_MAX_BYTES} bytes of data with the backup`);
    const header = Buffer.alloc(TAR_BLOCK);
    new tar.Header({ path: DATA, mode: 0o644, size: body.length, mtime: new Date(), type: "File" }).encode(header, 0);
    const padded = Buffer.alloc(Math.ceil(body.length / TAR_BLOCK) * TAR_BLOCK);
    body.copy(padded);
    return Buffer.concat([header, padded]);
}

/**
 * Gzips the tar into outFile and closes every handle on failure. Not tar's
 * own `file` option and not stream.pipeline: the first leaves the output open,
 * the second destroys the pack mid-member, and an open handle makes every later
 * rename of that path fail with EPERM on Windows. On failure the walk stops, and a
 * member still being read is drained so its file closes by itself. onData
 * hears each chunk of the pack before it is compressed. Without a pack the
 * tar ends after `head`.
 */
async function writeArchive(head: Buffer, pack: tar.Pack | null, outFile: string, stop: () => void, onData: (chunk: Buffer) => void): Promise<void> {
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(outFile);
    const closed = new Promise<void>((resolve) => out.once("close", () => resolve()));
    const failed = new Promise<never>((_, reject) => {
        pack?.on("error", reject);
        gzip.on("error", reject);
        out.on("error", reject);
    });
    // a rejection nobody awaits yet (the write finished first) is not unhandled
    failed.catch((err) => logger.debug("[backups] archive stream ended with an error after settling:", err));
    gzip.pipe(out);
    gzip.write(head);
    if (pack) {
        pack.pipe(gzip);
        // after the pipe: a data listener on its own would start the pack flowing
        pack.on("data", onData);
    } else {
        // the two empty blocks that end a tar
        gzip.end(Buffer.alloc(TAR_BLOCK * 2));
    }
    try {
        await Promise.race([closed, failed]);
    } catch (err) {
        stop();
        if (pack) {
            pack.unpipe(gzip);
            pack.resume();
        }
        gzip.destroy();
        out.destroy();
        await closed;
        throw err;
    }
}

/** writes the archive of `contents` from the panel's storage to outFile;
 * resolves with its size and sha256. onProgress hears the tar bytes packed
 * so far and about how many there are */
export async function createBackupArchive(
    storageDir: string,
    contents: ArchiveContents,
    outFile: string,
    onProgress?: (done: number, total: number) => void,
): Promise<{ size: number; sha256: string }> {
    const head = dataMember(contents.data);
    const list = members(storageDir, contents);
    const total = measure(storageDir, list, contents);
    let stopped = false;
    let packed = 0;
    const pack = list.length === 0 ? null : tar.c(
        {
            // compressed in writeArchive, so the tar bytes can be counted
            gzip: false,
            cwd: storageDir,
            prefix: FILES,
            portable: true,
            // one member at a time: tar parks the other members it already
            // opened behind a failed one, and they hold their files open
            jobs: 1,
            // creating reads the disk, so entries are fs.Stats; no links
            filter: (member: string, stat: fs.Stats | tar.ReadEntry) =>
                !stopped && "isFile" in stat && (stat.isFile() || stat.isDirectory()) && !leftOut(member.replace(/\\/g, "/").replace(/^\.\//, ""), contents),
        },
        list,
    );
    onProgress?.(0, total);
    await writeArchive(head, pack, outFile, () => { stopped = true; }, (chunk) => {
        packed += chunk.length;
        // a long path adds a header the estimate leaves out: never past the end
        onProgress?.(Math.min(packed, total), total);
    });
    return { size: fs.statSync(outFile).size, sha256: await hashFile(outFile, "sha256") };
}

/** true for a member an archive may hold: data.json, or files/ and what is under it */
export function isBackupMember(member: string): boolean {
    const normalized = member.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized === DATA || normalized === FILES || normalized.startsWith(`${FILES}/`);
}

/**
 * Extracts into stagingDir after refusing (at the first offending member)
 * any member that is not data.json or under files/, any link, and anything
 * over the tar budget. Resolves with the staged files dir (created empty
 * when the backup had none) and the panel's JSON.
 */
export async function extractBackupArchive(archive: string, stagingDir: string): Promise<{ filesDir: string; data: unknown }> {
    await scanTarMembers(archive, stagingDir, 0, ({ path: member, type }) =>
        (type !== "File" && type !== "Directory") || !isBackupMember(member) ? `The backup holds entries that are not a panel's backup: ${type} ${member}` : null,
    );
    await tar.x({ file: archive, cwd: stagingDir, maxDepth: TAR_BUDGET.maxDepth, filter: makeSafeTarFilter(stagingDir) });
    const filesDir = path.join(stagingDir, FILES);
    fs.mkdirSync(filesDir, { recursive: true });
    const dataFile = path.join(stagingDir, DATA);
    const stat = fs.statSync(dataFile, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error("The backup has no data.json; it was not made by this Paperboard");
    if (stat.size > BACKUP_DATA_MAX_BYTES) throw new LimitError("The backup's data is larger than a panel may hand over");
    return { filesDir, data: JSON.parse(fs.readFileSync(dataFile, "utf8")) };
}
