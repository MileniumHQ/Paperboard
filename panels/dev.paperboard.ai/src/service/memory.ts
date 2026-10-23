// What the agent remembers, owned by this service and shared by whichever
// brain is thinking (the harnesses' own memories are off). Two kinds:
//   facts: short, one line each, always in the agent's context;
//   notes: a key, a description of when the note is needed, and a body that
//          can be long. Only key and "when" are in context; the agent reads
//          the body with a tool.
// On disk: index.json (facts and the notes' keys and "when") and
// notes/<key>.md. Every operation goes through one queue, so there are no
// read-modify-write races; an index that can't be read or understood is an
// error, never an empty memory to overwrite.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { LIMITS, type MemoryFact, type MemoryList, type MemoryNoteInfo } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

const L = LIMITS.memory;
const KEY = /^[a-z0-9][a-z0-9-]*$/;
const INDEX_VERSION = 1;

/** A refusal the agent and the user can read and act on. */
export class MemoryError extends Error {}

interface Index {
    version: number;
    facts: MemoryFact[];
    notes: MemoryNoteInfo[];
}

export interface MemoryChange {
    revision: number;
    error: string | null;
}

export class Memory {
    private queue: Promise<unknown> = Promise.resolve();
    private revision = 0;

    constructor(private deps: { dir: string; onChange: (c: MemoryChange) => void }) {}

    private get indexPath() {
        return path.join(this.deps.dir, "index.json");
    }
    private notePath(key: string) {
        return path.join(this.deps.dir, "notes", `${key}.md`);
    }

    /** One operation at a time, in order; one failing doesn't stop the next. */
    private serial<T>(run: () => Promise<T>): Promise<T> {
        const next = this.queue.then(run, run);
        // the caller gets the failure from `next`; the queue only waits for it to settle
        this.queue = next.then(
            () => undefined,
            () => undefined,
        );
        return next;
    }

    /** Run a read or a change, and tell the UI what became of it. */
    private async track<T>(change: boolean, run: () => Promise<T>): Promise<T> {
        try {
            const out = await this.serial(run);
            if (change) this.revision++;
            this.deps.onChange({ revision: this.revision, error: null });
            return out;
        } catch (e) {
            this.deps.onChange({ revision: this.revision, error: e instanceof Error ? e.message : String(e) });
            throw e;
        }
    }

    private async readIndex(): Promise<Index> {
        let raw: string;
        try {
            raw = await fs.readFile(this.indexPath, "utf8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: INDEX_VERSION, facts: [], notes: [] };
            throw new MemoryError(`memory can't be read (${this.indexPath}): ${(e as Error).message}`);
        }
        const bad = (why: string) => new MemoryError(`memory's index is unreadable (${why}); it was left as it is: ${this.indexPath}`);
        let doc: any;
        try {
            doc = JSON.parse(raw);
        } catch (e) {
            throw bad((e as Error).message);
        }
        if (!doc || doc.version !== INDEX_VERSION || !Array.isArray(doc.facts) || !Array.isArray(doc.notes)) throw bad("not a memory index of this version");
        const keys = new Set<string>();
        for (const f of doc.facts) if (typeof f?.id !== "string" || typeof f.text !== "string") throw bad("a fact is malformed");
        for (const n of doc.notes) {
            if (typeof n?.key !== "string" || !KEY.test(n.key) || n.key.length > L.keyChars || typeof n.when !== "string" || keys.has(n.key)) throw bad("a note is malformed");
            keys.add(n.key);
        }
        return {
            version: INDEX_VERSION,
            facts: doc.facts.map((f: MemoryFact) => ({ id: f.id, text: f.text })),
            notes: doc.notes.map((n: MemoryNoteInfo) => ({ key: n.key, when: n.when })),
        };
    }

    private async writeFileAtomic(file: string, data: string) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
        try {
            const h = await fs.open(tmp, "w", 0o600);
            try {
                await h.writeFile(data);
                await h.sync();
            } finally {
                await h.close();
            }
            await fs.rename(tmp, file);
        } catch (e) {
            await fs.rm(tmp, { force: true }); // a failed cleanup throws instead of hiding the write's own failure
            throw e;
        }
    }

    private writeIndex(index: Index) {
        return this.writeFileAtomic(this.indexPath, JSON.stringify(index, null, 2));
    }

    // ------------------------------------------------------------- reading

    list(): Promise<MemoryList> {
        return this.track(false, async () => {
            const { facts, notes } = await this.readIndex();
            return { facts, notes };
        });
    }

    readNote(key: unknown): Promise<{ key: string; when: string; body: string }> {
        return this.track(false, async () => {
            const k = parseKey(key);
            const note = (await this.readIndex()).notes.find((n) => n.key === k);
            if (!note) throw new MemoryError(`no note called ${k}`);
            try {
                return { key: k, when: note.when, body: await fs.readFile(this.notePath(k), "utf8") };
            } catch (e) {
                throw new MemoryError(`note ${k} is listed but its file can't be read: ${(e as Error).message}`);
            }
        });
    }

    // ------------------------------------------------------------- changes

    addFact(text: unknown): Promise<MemoryFact> {
        return this.track(true, async () => {
            const t = oneLine(text, "a fact", L.factChars);
            const index = await this.readIndex();
            const same = index.facts.find((f) => f.text === t);
            if (same) return same;
            if (index.facts.length >= L.facts) throw new MemoryError(`memory holds ${L.facts} facts already: forget some, or put detail in a note`);
            const fact = { id: `f-${randomUUID().slice(0, 8)}`, text: t };
            await this.writeIndex({ ...index, facts: [...index.facts, fact] });
            return fact;
        });
    }

    editFact(id: unknown, text: unknown): Promise<MemoryFact> {
        return this.track(true, async () => {
            const t = oneLine(text, "a fact", L.factChars);
            const index = await this.readIndex();
            const old = index.facts.find((f) => f.id === id);
            if (!old) throw new MemoryError(`no fact ${String(id)}`);
            const fact = { id: old.id, text: t };
            await this.writeIndex({ ...index, facts: index.facts.map((f) => (f.id === old.id ? fact : f)) });
            return fact;
        });
    }

    deleteFact(id: unknown): Promise<void> {
        return this.track(true, async () => {
            const index = await this.readIndex();
            if (!index.facts.some((f) => f.id === id)) throw new MemoryError(`no fact ${String(id)}`);
            await this.writeIndex({ ...index, facts: index.facts.filter((f) => f.id !== id) });
        });
    }

    /** Create the note, or replace it whole. */
    saveNote(key: unknown, when: unknown, body: unknown): Promise<MemoryNoteInfo> {
        return this.track(true, async () => {
            const k = parseKey(key);
            const w = oneLine(when, "when", L.whenChars);
            if (typeof body !== "string" || !body.trim()) throw new MemoryError("a note needs a body");
            if (Buffer.byteLength(body) > L.bodyBytes) throw new MemoryError(`a note's body is at most ${L.bodyBytes / 1024} KiB`);
            const index = await this.readIndex();
            const exists = index.notes.some((n) => n.key === k);
            if (!exists && index.notes.length >= L.notes) throw new MemoryError(`memory holds ${L.notes} notes already: forget some first`);
            // body first: a crash between the two leaves an index that still points at a complete file
            await this.writeFileAtomic(this.notePath(k), body);
            const info = { key: k, when: w };
            await this.writeIndex({ ...index, notes: exists ? index.notes.map((n) => (n.key === k ? info : n)) : [...index.notes, info] });
            return info;
        });
    }

    deleteNote(key: unknown): Promise<void> {
        return this.track(true, async () => {
            const k = parseKey(key);
            const index = await this.readIndex();
            if (!index.notes.some((n) => n.key === k)) throw new MemoryError(`no note called ${k}`);
            await this.writeIndex({ ...index, notes: index.notes.filter((n) => n.key !== k) });
            await fs.rm(this.notePath(k), { force: true });
        });
    }

    // ------------------------------------------------------- the agent's view

    toolset(): Toolset {
        return { id: "memory", tools: () => MEMORY_TOOLS, call: (name, args) => this.call(name, args), instructions: () => this.instructions() };
    }

    private async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        try {
            switch (name) {
                case "remember": {
                    const f = await this.addFact(args.fact);
                    return { text: `Remembered (${f.id}).` };
                }
                case "forget":
                    if (typeof args.fact === "string") await this.deleteFact(args.fact);
                    else if (typeof args.note === "string") await this.deleteNote(args.note);
                    else throw new MemoryError("say which to forget: a fact's id or a note's key");
                    return { text: "Forgotten." };
                case "save_note": {
                    const n = await this.saveNote(args.key, args.when, args.body);
                    return { text: `Saved note ${n.key}.` };
                }
                case "read_note":
                    return { text: (await this.readNote(args.key)).body };
            }
        } catch (e) {
            // a refusal is the tool's answer, which the agent reads; anything else is a fault
            if (e instanceof MemoryError) return { text: e.message, isError: true };
            throw e;
        }
        throw new MemoryError(`unknown memory tool ${name}`);
    }

    /** Facts and the notes' index, read fresh each turn so edits (the user's too) are seen. */
    async instructions(): Promise<string> {
        let list: MemoryList;
        try {
            list = await this.list();
        } catch (e) {
            return `Your memory is unavailable right now (${e instanceof Error ? e.message : String(e)}). Tell the user if it matters; don't pretend to remember.`;
        }
        const facts = list.facts.length ? list.facts.map((f) => `- [${f.id}] ${f.text}`).join("\n") : "(nothing yet)";
        const notes = list.notes.length ? list.notes.map((n) => `- ${n.key}: ${n.when}`).join("\n") : "(none yet)";
        return `Your memory is shared with the user, who can read and edit it, and it's the only memory you have.
Facts, always with you:
${facts}
Notes, read one with \`read_note\` when its description applies:
${notes}
\`remember\` short durable things about the user and their world. \`save_note\` (key, when it's needed, markdown body) anything long or only sometimes relevant, so your context stays clean. \`forget\` what's stale. Never store secrets (tokens, passwords, keys): they don't belong in memory.`;
    }
}

function oneLine(v: unknown, what: string, max: number): string {
    if (typeof v !== "string") throw new MemoryError(`${what} must be text`);
    const t = v.trim();
    if (!t) throw new MemoryError(`${what} can't be empty`);
    if (/[\r\n]/.test(t)) throw new MemoryError(`${what} is one line`);
    if (t.length > max) throw new MemoryError(`${what} is at most ${max} characters`);
    return t;
}

function parseKey(v: unknown): string {
    if (typeof v !== "string" || !KEY.test(v) || v.length > L.keyChars) {
        throw new MemoryError(`a note's key is lowercase letters, digits and dashes, at most ${L.keyChars} characters`);
    }
    return v;
}

export const MEMORY_TOOLS: ToolSpec[] = [
    {
        name: "remember",
        description: `Remember a short durable fact (one line, at most ${L.factChars} characters). It will be in your context every turn.`,
        inputSchema: { type: "object", properties: { fact: { type: "string", maxLength: L.factChars } }, required: ["fact"] },
    },
    {
        name: "forget",
        description: "Forget a fact (by its id) or a note (by its key).",
        inputSchema: { type: "object", properties: { fact: { type: "string" }, note: { type: "string" } } },
    },
    {
        name: "save_note",
        description: "Create or replace a note: a longer memory kept out of your context until needed. `when` says when to read it.",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string", description: "lowercase letters, digits and dashes", maxLength: L.keyChars },
                when: { type: "string", description: "one line: when this note is needed", maxLength: L.whenChars },
                body: { type: "string", description: `markdown, at most ${L.bodyBytes / 1024} KiB` },
            },
            required: ["key", "when", "body"],
        },
    },
    {
        name: "read_note",
        description: "Read a note's body by its key.",
        inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    },
];
