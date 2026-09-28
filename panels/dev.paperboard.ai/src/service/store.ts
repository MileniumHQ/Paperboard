// Conversation persistence in the panel's own files:
//   conversations/<id>.json   one conversation, the source of truth
//   conversations/index.json  summaries, a cache rebuilt from the files
//
// Writes are atomic (temp + rename). This service is the only writer, and
// every write goes through one queue, so read-modify-write cannot race.

import fs from "node:fs";
import path from "node:path";
import {
    isConversationId,
    markInterrupted,
    MAX_CONVERSATIONS,
    sortSummaries,
    summarize,
} from "../core/conversation";
import type { Conversation, ConversationSummary } from "../core/types";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export class ConversationStore {
    private readonly dir: string;
    private queue: Promise<unknown> = Promise.resolve();
    private summaries: ConversationSummary[] = [];

    constructor(filesDir: string) {
        this.dir = path.join(filesDir, "conversations");
    }

    private serial<T>(op: () => Promise<T>): Promise<T> {
        const next = this.queue.then(op, op);
        this.queue = next.catch((err) => console.debug("[ai] store op failed:", String(err)));
        return next;
    }

    private file(id: string): string {
        if (!isConversationId(id)) throw new Error(`invalid conversation id ${JSON.stringify(id)}`);
        return path.join(this.dir, `${id}.json`);
    }

    private async writeAtomic(target: string, data: string): Promise<void> {
        if (Buffer.byteLength(data) > MAX_FILE_BYTES) {
            throw new Error("This conversation is too long to save. Start a new chat.");
        }
        const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
        await fs.promises.writeFile(tmp, data, "utf8");
        try {
            await fs.promises.rename(tmp, target);
        } catch (err) {
            await fs.promises.rm(tmp, { force: true });
            throw err;
        }
    }

    private async readConversationFile(file: string): Promise<Conversation> {
        const stat = await fs.promises.stat(file);
        if (stat.size > MAX_FILE_BYTES) throw new Error(`${path.basename(file)} exceeds ${MAX_FILE_BYTES} bytes`);
        const data = JSON.parse(await fs.promises.readFile(file, "utf8")) as Conversation;
        if (!isConversationId(data.id) || !Array.isArray(data.messages)) {
            throw new Error(`${path.basename(file)} is not a conversation`);
        }
        return data;
    }

    /**
     * Loads summaries. A missing directory is an empty history. An unreadable
     * index is rebuilt from the conversation files (the recovery succeeds or
     * this throws); unreadable conversation files are reported, never dropped
     * silently from disk.
     */
    load(): Promise<{ summaries: ConversationSummary[]; unreadable: string[] }> {
        return this.serial(async () => {
            await fs.promises.mkdir(this.dir, { recursive: true });
            const indexFile = path.join(this.dir, "index.json");
            try {
                const index = JSON.parse(await fs.promises.readFile(indexFile, "utf8")) as { conversations?: ConversationSummary[] };
                if (!Array.isArray(index.conversations)) throw new Error("index has no conversation list");
                this.summaries = sortSummaries(index.conversations.filter((c) => isConversationId(c?.id)));
                return { summaries: this.summaries, unreadable: [] };
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                    console.warn("[ai] conversation index unreadable, rebuilding from files:", String(err));
                }
            }
            const unreadable: string[] = [];
            const found: ConversationSummary[] = [];
            const names = (await fs.promises.readdir(this.dir)).filter((n) => /^[a-z0-9-]+\.json$/.test(n) && n !== "index.json");
            for (const name of names) {
                try {
                    found.push(summarize(await this.readConversationFile(path.join(this.dir, name))));
                } catch (err) {
                    console.warn(`[ai] conversation ${name} unreadable:`, String(err));
                    unreadable.push(name);
                }
            }
            this.summaries = sortSummaries(found);
            await this.writeAtomic(indexFile, JSON.stringify({ conversations: this.summaries }));
            return { summaries: this.summaries, unreadable };
        });
    }

    get list(): ConversationSummary[] {
        return this.summaries;
    }

    /** A conversation, with any reply cut off by a restart marked stopped. */
    get(id: string): Promise<Conversation> {
        return this.serial(async () => markInterrupted(await this.readConversationFile(this.file(id))));
    }

    /**
     * Saves one conversation and its summary. Past the history cap the oldest
     * conversation leaves the index, but its file stays on disk.
     */
    save(conversation: Conversation): Promise<ConversationSummary[]> {
        return this.serial(async () => {
            await fs.promises.mkdir(this.dir, { recursive: true });
            await this.writeAtomic(this.file(conversation.id), JSON.stringify(conversation));
            const others = this.summaries.filter((s) => s.id !== conversation.id);
            this.summaries = sortSummaries([summarize(conversation), ...others]).slice(0, MAX_CONVERSATIONS);
            await this.writeAtomic(path.join(this.dir, "index.json"), JSON.stringify({ conversations: this.summaries }));
            return this.summaries;
        });
    }

    /** Deleting a chat is the user's explicit decision about their own data. */
    delete(id: string): Promise<ConversationSummary[]> {
        return this.serial(async () => {
            await fs.promises.rm(this.file(id), { force: true });
            this.summaries = this.summaries.filter((s) => s.id !== id);
            await this.writeAtomic(path.join(this.dir, "index.json"), JSON.stringify({ conversations: this.summaries }));
            return this.summaries;
        });
    }
}
