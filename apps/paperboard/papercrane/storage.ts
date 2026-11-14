import * as fs from "fs";
import { logger } from "./logger";
import * as path from "path";
import * as crypto from "crypto";
import { pipeline } from "node:stream/promises";

// one-shot timers must never hold the process open: unref and move on.
// (bun and node both expose unref on Timeout handles)
export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    (timer as unknown as { unref?: () => void }).unref?.();
}

/** Runs tasks one at a time, in the order given; one that fails does not stop the next. */
export class SerialQueue {
    private tail: Promise<unknown> = Promise.resolve();
    private pending = 0;
    /** no task is waiting or running */
    get idle(): boolean {
        return this.pending === 0;
    }
    run<T>(task: () => Promise<T> | T): Promise<T> {
        this.pending++;
        const result = this.tail.then(task).finally(() => this.pending--);
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
}

// size-limit refusal thrown by engine-level code (file reads, config
// writes). Carries a wire code so the RPC layer maps it without
// message-text matching — see rpcErrorCode in rpc/params.ts.
export class LimitError extends Error {
    readonly code = "INVALID_PARAMS";
    constructor(message: string) {
        super(message);
        this.name = "LimitError";
    }
}

// ─── Atomic JSON persistence ─────────────────────────────────────────────────

// writes to one path land in the order they were asked for; a queue lives
// while writes to its path are pending
const writeQueues = new Map<string, SerialQueue>();

// A failed write names the file it was saving and the system's reason in
// its own words ("permission denied"), never the temp file it went
// through. The errno code stays on the error for callers that check it.
function saveFailed(filePath: string, tmp: string, err: unknown): Error {
    const cause = err as NodeJS.ErrnoException;
    const message = String(cause?.message ?? err);
    const reason = /^[A-Z]+: ([^,]+)/.exec(message)?.[1] ?? message.split(tmp).join(filePath);
    const failure = new Error(`Couldn't save ${filePath}: ${reason}`, { cause: err }) as NodeJS.ErrnoException;
    failure.code = cause?.code;
    failure.errno = cause?.errno;
    failure.syscall = cause?.syscall;
    failure.path = filePath;
    return failure;
}

// the temp file a write goes through, beside the file so the rename is atomic
function tempFor(filePath: string): string {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

/** Writes a file atomically via temp plus rename; the mode, when given, applies at birth. */
export function writeFileAtomic(filePath: string, data: string, options?: { mode?: number }): Promise<void> {
    let queue = writeQueues.get(filePath);
    if (!queue) writeQueues.set(filePath, (queue = new SerialQueue()));
    const done = queue.run(async () => {
        const tmp = tempFor(filePath);
        try {
            await fs.promises.writeFile(tmp, data, { encoding: "utf8", mode: options?.mode });
            if (options?.mode !== undefined) await fs.promises.chmod(tmp, options.mode);
            await fs.promises.rename(tmp, filePath);
        } catch (err) {
            await fs.promises.rm(tmp, { force: true }).catch((cleanupErr) => logger.warn(`[storage] the temp file ${tmp} could not be removed and stays on disk:`, cleanupErr));
            throw saveFailed(filePath, tmp, err);
        }
    });
    const forget = () => {
        if (queue.idle && writeQueues.get(filePath) === queue) writeQueues.delete(filePath);
    };
    done.then(forget, forget);
    return done;
}

export function writeJsonAtomicSync(
    filePath: string,
    value: unknown,
    options?: { mode?: number },
): void {
    writeFileAtomicSync(filePath, JSON.stringify(value, null, 2), options);
}

export function writeFileAtomicSync(
    filePath: string,
    data: string,
    options?: { mode?: number },
): void {
    const tmp = tempFor(filePath);
    try {
        fs.writeFileSync(tmp, data, { encoding: "utf8", mode: options?.mode });
        // the temp becomes the file, so requested mode applies at birth
        if (options?.mode !== undefined) fs.chmodSync(tmp, options.mode);
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try {
            fs.rmSync(tmp, { force: true });
        } catch (cleanupErr) {
            logger.warn(`[storage] the temp file ${tmp} could not be removed and stays on disk:`, cleanupErr);
        }
        throw saveFailed(filePath, tmp, err);
    }
}

export function writeJsonAtomic(
    filePath: string,
    value: unknown,
): Promise<void> {
    return writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

// Reads a daemon-owned state document. Missing = `empty`. Unparseable
// state is never treated as empty and then overwritten: the bytes are
// quarantined beside the file (<file>.corrupt-<ms>) for recovery, logged
// loudly, and the caller starts from `empty`. A file that exists but cannot
// be read (permissions, I/O) throws: unreadable is not empty either.
export function readStateFileSync<T>(filePath: string, empty: T, label: string): T {
    let text: string;
    try {
        text = fs.readFileSync(filePath, "utf8");
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return empty;
        throw err;
    }
    try {
        return JSON.parse(text) as T;
    } catch (parseErr) {
        const quarantine = `${filePath}.corrupt-${Date.now()}`;
        try {
            fs.renameSync(filePath, quarantine);
        } catch (moveErr) {
            logger.error(`[storage] ${label} is unreadable AND could not be quarantined; refusing to continue:`, moveErr);
            throw moveErr;
        }
        logger.error(`[storage] ${label} was unreadable; its bytes are kept in ${quarantine}:`, parseErr);
        return empty;
    }
}

// ─── Ids ─────────────────────────────────────────────────────────────────────

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

// Sanitizes an id so it can never escape its base directory
export function sanitizeId(id: string | undefined | null): string | null {
    if (!id || typeof id !== "string") return null;
    if (!SAFE_ID_RE.test(id)) return null;
    if (id.startsWith(".")) return null;
    return id;
}

// Directory name for a panel home under files/, dots preserved
export function panelFilesDirName(id: string | undefined | null): string {
    if (!id || typeof id !== "string") return "default";
    return id.replace(/[^a-zA-Z0-9_.-]/g, "_") || "default";
}

// ─── Files ───────────────────────────────────────────────────────────────────

// the hex digest of a file on disk, read as a stream
export async function hashFile(filePath: string, algorithm: string): Promise<string> {
    const hash = crypto.createHash(algorithm);
    await pipeline(fs.createReadStream(filePath), hash);
    return hash.digest("hex");
}

// Safely moves a file across filesystems or partitions
export async function moveFileSafe(src: string, dest: string): Promise<void> {
    try {
        await fs.promises.rename(src, dest);
    } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "EXDEV") {
            await fs.promises.copyFile(src, dest);
            await fs.promises.unlink(src);
        } else {
            throw err;
        }
    }
}
