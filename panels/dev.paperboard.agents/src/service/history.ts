// The conversations put away. Each is a folder in past/ holding its transcript, harness threads, files and
// carry, moved there as they were, with its summary (meta.json) to list it by. Reopening one moves it back.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChatEntry, PastConversation } from "../contract";
import { errorText } from "../lib/failure";
import { readTranscript, said, TRANSCRIPT, type Said } from "./transcript";
import { writeAtomic } from "./writeAtomic";

export const THREADS = "threads.json";
export const ATTACHMENTS = "attachments";
export const CARRY = "carry.json";
const PAST = "past";
const PAST_META = "meta.json";
/** the current conversation's id: it keeps it through being put away and reopened, so a flow can name it */
const ID = "id";
const PAST_ID = /^[a-f0-9]{12}$/;
const TITLE_CHARS = 80;

/** A conversation as the history lists it. */
export function summary(entries: ChatEntry[], id: string): PastConversation {
    const texts = said(entries);
    const first = texts.find((e) => e.kind === "user") ?? texts[0];
    const text = first?.text.replace(/\s+/g, " ").trim() ?? "";
    return {
        id,
        title: text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1).trimEnd()}…` : text || "A conversation",
        startedAt: entries[0]!.at,
        endedAt: entries.at(-1)!.at,
        messages: texts.length,
    };
}

export class History {
    /** `dir` is the conversation's folder: the current one's files are in it, the history in its past/ */
    constructor(private dir: string) {}

    /** The current conversation's own id, the one it's put away under; made the first time it's asked for. */
    currentId(): string {
        const file = path.join(this.dir, ID);
        if (fs.existsSync(file)) {
            const id = fs.readFileSync(file, "utf8").trim();
            if (!PAST_ID.test(id)) throw new Error(`${file} isn't a conversation's id`);
            // one the history has already is left from a put-away that was interrupted: it's that one's
            if (!fs.existsSync(path.join(this.pastDir(), id))) return id;
        }
        const id = randomUUID().replace(/-/g, "").slice(0, 12);
        writeAtomic(file, id);
        return id;
    }

    /** Past conversations' ids; a half-made one (a dot folder from an interrupted put-away) isn't listed. */
    ids(): string[] {
        if (!fs.existsSync(this.pastDir())) return [];
        return fs.readdirSync(this.pastDir()).filter((n) => PAST_ID.test(n));
    }

    /** The history, newest first. */
    list(): PastConversation[] {
        return this.ids()
            .map((id) => {
                const file = path.join(this.pastDir(), id, PAST_META);
                try {
                    return JSON.parse(fs.readFileSync(file, "utf8")) as PastConversation;
                } catch (e) {
                    // unreadable isn't "not there": say which one, so it can be deleted
                    throw new Error(`${file} can't be read: ${errorText(e)}`);
                }
            })
            .sort((a, b) => b.endedAt - a.endedAt);
    }

    /** A past conversation's folder; throws for what isn't a conversation's id. */
    private folder(id: unknown): string {
        if (typeof id !== "string" || !PAST_ID.test(id)) throw new Error("that isn't a conversation's id");
        return path.join(this.pastDir(), id);
    }

    /**
     * Move the current conversation (its `entries`, never empty) into the history. Its summary goes in first,
     * then the files are moved, so an interruption at any point leaves every message somewhere, never nowhere.
     */
    putAway(entries: ChatEntry[]) {
        const id = this.currentId();
        const tmp = path.join(this.pastDir(), `.${id}`);
        fs.mkdirSync(tmp, { recursive: true });
        fs.writeFileSync(path.join(tmp, PAST_META), JSON.stringify(summary(entries, id)));
        const dir = path.join(this.pastDir(), id);
        fs.renameSync(tmp, dir);
        for (const name of [TRANSCRIPT, THREADS, ATTACHMENTS, CARRY]) {
            const from = path.join(this.dir, name);
            if (fs.existsSync(from)) fs.renameSync(from, path.join(dir, name));
        }
        // the next conversation gets an id of its own
        fs.rmSync(path.join(this.dir, ID), { force: true });
    }

    /** A past conversation's folder; throws for one that isn't in the history. */
    find(id: unknown): string {
        const dir = this.folder(id);
        if (!fs.existsSync(dir)) throw new Error("That conversation isn't in the history anymore.");
        return dir;
    }

    /** Move a past conversation back to be the current one, once `vacate` has moved the current one's files out of the way. */
    restore(id: unknown, vacate: () => void) {
        const dir = this.find(id);
        vacate();
        const files = path.join(dir, ATTACHMENTS);
        if (fs.existsSync(files)) fs.renameSync(files, path.join(this.dir, ATTACHMENTS));
        // it comes back as it was put away; a part that's missing (an interrupted put-away) is empty
        for (const [name, empty] of [
            [TRANSCRIPT, ""],
            [THREADS, "{}"],
        ] as const) {
            const from = path.join(dir, name);
            const to = path.join(this.dir, name);
            if (fs.existsSync(from)) fs.renameSync(from, to);
            else writeAtomic(to, empty);
        }
        // a carry is only there if it was compacted and not yet carried on
        const carry = path.join(dir, CARRY);
        if (fs.existsSync(carry)) fs.renameSync(carry, path.join(this.dir, CARRY));
        writeAtomic(path.join(this.dir, ID), id as string);
        fs.rmSync(dir, { recursive: true });
    }

    /** Delete a past conversation for good. */
    delete(id: unknown) {
        const dir = this.find(id);
        fs.rmSync(dir, { recursive: true });
    }

    /** A past conversation's texts, every one of them, oldest first. */
    texts(id: string): Said[] {
        const dir = this.folder(id);
        if (!fs.existsSync(dir)) throw new Error(`the agent has no conversation "${id}"; it may have been deleted`);
        return said(readTranscript(path.join(dir, TRANSCRIPT)).entries);
    }

    private pastDir() {
        return path.join(this.dir, PAST);
    }
}
