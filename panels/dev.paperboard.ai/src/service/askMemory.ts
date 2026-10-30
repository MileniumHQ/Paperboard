// Ask AI's memory on disk: one document, owned by this service, written
// atomically and one write at a time. An unreadable document is never
// treated as empty: memory refuses until the file is fixed or removed, so a
// bad read can't wipe what callers stored.

import fs from "node:fs";
import path from "node:path";
import { evictMemories, remember, type MemoryEntry, type MemoryMessage } from "../core/askMemory";

const FILE = "ask-memory.json";
const VERSION = 1;
/** MAX_MEMORIES × MAX_MEMORY_CHARS, with room for JSON */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export class AskMemory {
    private entries: Record<string, MemoryEntry> = {};
    private broken: Error | null = null;
    private queue: Promise<void> = Promise.resolve();
    private readonly file: string;

    constructor(filesDir: string) {
        this.file = path.join(filesDir, FILE);
    }

    async load(): Promise<void> {
        try {
            const stat = await fs.promises.stat(this.file);
            if (stat.size > MAX_FILE_BYTES) throw new Error(`${FILE} is larger than ${MAX_FILE_BYTES} bytes`);
            const doc = JSON.parse(await fs.promises.readFile(this.file, "utf8")) as { version?: unknown; entries?: unknown };
            if (doc.version !== VERSION || typeof doc.entries !== "object" || doc.entries === null) throw new Error(`${FILE} is not an Ask AI memory file`);
            this.entries = doc.entries as Record<string, MemoryEntry>;
            this.broken = null;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                this.entries = {};
                this.broken = null;
                return;
            }
            console.error(`[ai] Ask AI memory could not be read; memory is off until ${this.file} is fixed or removed:`, String(err));
            this.broken = new Error(`Ask AI's memory file could not be read (${err instanceof Error ? err.message : String(err)}). Fix or remove ${this.file}.`);
        }
    }

    private usable(): void {
        if (this.broken) throw this.broken;
    }

    history(key: string): MemoryMessage[] {
        this.usable();
        return this.entries[key]?.messages ?? [];
    }

    /** Adds an exchange to a key's memory; resolves once it is on disk. */
    add(key: string, question: string, answer: string): Promise<void> {
        return this.write((entries) =>
            evictMemories({ ...entries, [key]: { messages: remember(entries[key]?.messages ?? [], question, answer), updatedAt: Date.now() } }),
        );
    }

    /** Forgets a key; false when there was nothing to forget. */
    async forget(key: string): Promise<boolean> {
        let had = false;
        await this.write((entries) => {
            had = key in entries;
            if (!had) return null;
            const { [key]: _gone, ...rest } = entries;
            return rest;
        });
        return had;
    }

    /** The next entries are adopted only once they are on disk; null changes nothing. */
    private write(change: (entries: Record<string, MemoryEntry>) => Record<string, MemoryEntry> | null): Promise<void> {
        const run = async () => {
            this.usable();
            const next = change(this.entries);
            if (!next) return;
            const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
            await fs.promises.writeFile(tmp, JSON.stringify({ version: VERSION, entries: next }), "utf8");
            try {
                await fs.promises.rename(tmp, this.file);
            } catch (err) {
                await fs.promises.rm(tmp, { force: true });
                throw err;
            }
            this.entries = next;
        };
        const next = this.queue.then(run, run);
        // a failed write is the caller's error; the queue moves on
        this.queue = next.catch((err) => console.error("[ai] saving Ask AI memory failed:", String(err)));
        return next;
    }
}
