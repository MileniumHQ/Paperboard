// A conversation's transcript: an append-only JSONL file in the panel's storage, compacted when it grows past
// a cap (only superseded copies go). An entry that changes is appended again and the latest copy wins.

import fs from "node:fs";
import { errorMessage } from "@mileniumhq/paperapi";
import { writeFileAtomicSync } from "@mileniumhq/paperapi/fs";
import type { ChatEntry } from "../contract";

export const TRANSCRIPT = "transcript.jsonl";
/** the latest entries kept in memory; the file keeps every one */
const KEEP_IN_MEMORY = 500;
const COMPACT_AT_BYTES = 4 * 1024 * 1024;

/** A text in a conversation: the user's or the agent's, not an error or a card. */
export type Said = Extract<ChatEntry, { kind: "user" | "agent" }>;

export function said(entries: ChatEntry[]): Said[] {
    return entries.filter((e): e is Said => e.kind === "user" || e.kind === "agent");
}

/** The current conversation's transcript, its latest entries in memory. */
export class Transcript {
    /** oldest first, the latest KEEP_IN_MEMORY of them */
    entries: ChatEntry[] = [];
    /** every id in the file, the ones past what memory keeps too: a new entry's id is none of these */
    private ids = new Set<string>();
    /** how big the file may get before its superseded copies are dropped */
    private compactAt = COMPACT_AT_BYTES;

    constructor(private file: string) {}

    has(id: string): boolean {
        return this.ids.has(id);
    }

    /** Every entry, the ones past what memory keeps too, oldest first: read from the file only when memory doesn't hold them all. */
    all(): ChatEntry[] {
        return this.ids.size > this.entries.length ? readTranscript(this.file).entries : this.entries;
    }

    /**
     * Read the file into memory. A torn last line (a crash mid-append) is cut off the file once the rest has
     * read: the next entry appended after it would join it and be lost.
     */
    load() {
        const { entries, ids, torn, unended } = readTranscript(this.file);
        if (torn !== null) fs.truncateSync(this.file, torn);
        // a whole entry that lost only its newline would join the next one the same way
        else if (unended) fs.appendFileSync(this.file, "\n");
        this.entries = entries.slice(-KEEP_IN_MEMORY);
        this.ids = ids;
        this.compactAt = COMPACT_AT_BYTES;
    }

    /** Forget it: the file is emptied. */
    clear() {
        this.forget();
        writeFileAtomicSync(this.file, "");
    }

    /** Forget what's in memory: the file was moved into the history. */
    forget() {
        this.entries = [];
        this.ids = new Set();
        this.compactAt = COMPACT_AT_BYTES;
    }

    put(entry: ChatEntry) {
        const i = this.entries.findIndex((e) => e.id === entry.id);
        if (i >= 0) this.entries[i] = entry;
        else this.entries.push(entry);
        if (this.entries.length > KEEP_IN_MEMORY) this.entries.splice(0, this.entries.length - KEEP_IN_MEMORY);
        this.ids.add(entry.id);
        fs.appendFileSync(this.file, JSON.stringify(entry) + "\n");
        if (fs.statSync(this.file).size > this.compactAt) this.dropSuperseded();
    }

    /**
     * Rewrites the file without its superseded copies. Every message stays: only memory is capped, never
     * what the user's history holds. A transcript still big after that has earned its size, so the next rewrite
     * waits until it has doubled; otherwise every append past the cap would rewrite the whole file.
     */
    private dropSuperseded() {
        const latest = new Map<string, string>();
        const lines = fs.readFileSync(this.file, "utf8").split("\n");
        lines.forEach((line, n) => {
            if (!line.trim()) return;
            let id: unknown;
            try {
                id = JSON.parse(line).id;
            } catch (err) {
                throw new Error(`${this.file} line ${n + 1} is unreadable: ${errorMessage(err)}`);
            }
            if (typeof id !== "string") throw new Error(`${this.file} line ${n + 1} has no id`);
            latest.delete(id); // re-insert so a changed entry keeps its newest position
            latest.set(id, line);
        });
        writeFileAtomicSync(this.file, [...latest.values()].join("\n") + "\n");
        this.compactAt = Math.max(COMPACT_AT_BYTES, fs.statSync(this.file).size * 2);
    }
}

/**
 * A transcript's entries, oldest first: the current conversation's, or one put away in the history. With every
 * id it holds (entries no longer shown too), the byte a torn last line starts at (or null), and whether the
 * file's last line has no newline.
 */
export function readTranscript(file: string): { entries: ChatEntry[]; ids: Set<string>; torn: number | null; unended: boolean } {
    const ids = new Set<string>();
    if (!fs.existsSync(file)) return { entries: [], ids, torn: null, unended: false };
    const byId = new Map<string, ChatEntry>();
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    let torn: number | null = null;
    lines.forEach((line, n) => {
        if (!line.trim()) return;
        let e: ChatEntry;
        try {
            e = JSON.parse(line);
        } catch (err) {
            // only the last line can be torn (a crash mid-append); anything else is damage to report
            if (lines.slice(n + 1).every((l) => !l.trim())) {
                torn = Buffer.byteLength(lines.slice(0, n).map((l) => `${l}\n`).join(""));
                return;
            }
            throw new Error(`${file} line ${n + 1} is unreadable: ${errorMessage(err)}`);
        }
        if (typeof e.id === "string") ids.add(e.id);
        // transcripts from before the chat was only a chat hold tool-call entries: not messages, not shown
        if (e.kind !== "user" && e.kind !== "agent" && e.kind !== "error" && e.kind !== "sign-in" && e.kind !== "app" && e.kind !== "access" && e.kind !== "sudo" && e.kind !== "prompt" && e.kind !== "tool-server" && e.kind !== "tool-sign-in") return;
        // a sign-in request lives only as long as the service that asked for it
        if (e.kind === "sign-in" && (e.status === "waiting" || e.status === "submitting")) e = { ...e, status: "expired" };
        if (e.kind === "access" && e.status === "waiting") e = { ...e, status: "expired" };
        // the shell sudo was asking in closed with the service
        if (e.kind === "sudo" && (e.status === "waiting" || e.status === "checking")) e = { ...e, status: "expired", error: undefined };
        if (e.kind === "prompt" && (e.status === "waiting" || e.status === "sending")) e = { ...e, status: "expired" };
        if (e.kind === "tool-server" && e.status === "waiting") e = { ...e, status: "expired" };
        byId.delete(e.id); // re-insert so a changed entry keeps its newest position
        byId.set(e.id, e);
    });
    return { entries: [...byId.values()].sort((a, b) => a.at - b.at), ids, torn, unended: text !== "" && !text.endsWith("\n") };
}
