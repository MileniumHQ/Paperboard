import * as fs from "fs";
import { logger } from "./logger";
import * as crypto from "crypto";
import { pipeline } from "node:stream/promises";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { writeFileAtomic as writeWhole, writeFileAtomicSync as writeWholeSync } from "@mileniumhq/paperapi/fs";
import { KeyedQueue } from "@mileniumhq/paperapi/serialQueue";

// one-shot timers must never hold the process open: unref and move on.
// (bun and node both expose unref on Timeout handles)
export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    (timer as unknown as { unref?: () => void }).unref?.();
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

// writes to one path land in the order they were asked for
const writeLines = new KeyedQueue();

// A failed write names the file it was saving and the system's reason in
// its own words ("permission denied"), never the temp file it went
// through. The errno code stays on the error for callers that check it.
function saveFailed(filePath: string, err: unknown): Error {
    const cause = err as NodeJS.ErrnoException;
    const message = errorMessage(err);
    // writeFileAtomic's temp file is the file's name and `.<12 hex>.tmp`
    const reason = /^[A-Z]+: ([^,]+)/.exec(message)?.[1] ?? message.replace(/\.[0-9a-f]{12}\.tmp/g, "");
    const failure = new Error(`Couldn't save ${filePath}: ${reason}`, { cause: err }) as NodeJS.ErrnoException;
    failure.code = cause?.code;
    failure.errno = cause?.errno;
    failure.syscall = cause?.syscall;
    failure.path = filePath;
    return failure;
}

/** Writes a file atomically via temp plus rename; the mode, when given, applies at birth. */
export function writeFileAtomic(filePath: string, data: string, options?: { mode?: number }): Promise<void> {
    return writeLines.run(filePath, () =>
        writeWhole(filePath, data, options).catch((err) => {
            throw saveFailed(filePath, err);
        }),
    );
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
    try {
        writeWholeSync(filePath, data, options);
    } catch (err) {
        throw saveFailed(filePath, err);
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
        if (errorCode(err) === "ENOENT") return empty;
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
        const code = errorCode(err);
        if (code === "EXDEV") {
            await fs.promises.copyFile(src, dest);
            await fs.promises.unlink(src);
        } else {
            throw err;
        }
    }
}
