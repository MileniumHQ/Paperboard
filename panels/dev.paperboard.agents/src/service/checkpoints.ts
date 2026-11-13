// Checkpoints of the agent's home folder: what every file in it was at one
// moment, kept so any of it can be brought back. A file's contents are
// stored once, by their SHA-256, so a checkpoint costs only what changed
// since the last. They're kept beside the home folder, out of the shell's
// reach, and erased with it. Packages (node_modules) are left out: an app's
// package.json is kept and add_package installs what it lists. Links are
// neither kept nor followed, and a restore writes only inside the folder.

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { localStamp } from "../routineText";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { HomeFolder } from "./homeFolder";
import type { Toolset } from "./toolsets";

/** how many are kept; past that the oldest go */
export const KEPT = 100;
/** a file bigger than this isn't kept, and the checkpoint says so */
export const FILE_BYTES = 100 * 1024 * 1024;
const NOTE_CHARS = 200;
/** how many paths a summary names before it counts the rest */
const NAMED = 20;

interface Entry {
    hash: string;
    size: number;
    mtime: number;
}
interface Checkpoint {
    id: number;
    note: string;
    at: number;
    files: Record<string, Entry>;
    dirs: string[];
}
interface Scan {
    files: Record<string, Entry>;
    dirs: string[];
    /** what wasn't kept, and why */
    left: string[];
}
interface Changes {
    changed: string[];
    added: string[];
    removed: string[];
}

export const CHECKPOINT_INSTRUCTIONS = `**Checkpoints:** \`checkpoint\` before a change that could go wrong, and once something works. \`restore\` undoes back to one.`;

export const CHECKPOINT_TOOLS: ToolSpec[] = [
    {
        name: "checkpoint",
        description: "Keep what every file in your home folder is now, with a note, so it can be restored later. node_modules isn't kept; `add_package` reinstalls it.",
        inputSchema: {
            type: "object",
            properties: { note: { type: "string", description: "What it is, e.g. `planner works: week view and due dates`." } },
            required: ["note"],
        },
    },
    {
        name: "checkpoints",
        description: "List the checkpoints and what's changed since the last; or, given one, what's changed since it.",
        inputSchema: {
            type: "object",
            properties: { checkpoint: { type: "integer", description: "A checkpoint's number, to see what's changed since it." } },
        },
    },
    {
        name: "restore",
        description: "Bring the home folder, or one path in it, back to a checkpoint. How it was before is kept as a new checkpoint.",
        inputSchema: {
            type: "object",
            properties: {
                checkpoint: { type: "integer", description: "The checkpoint's number." },
                path: { type: "string", description: "Only this file or folder, e.g. ~/Pages/planner. All of ~ when left out." },
            },
            required: ["checkpoint"],
        },
    },
];

const changesBetween = (from: { files: Record<string, Entry> }, to: { files: Record<string, Entry> }, within = (_: string) => true): Changes => {
    const c: Changes = { changed: [], added: [], removed: [] };
    for (const [p, e] of Object.entries(to.files)) {
        if (!within(p)) continue;
        const was = from.files[p];
        if (!was) c.added.push(p);
        else if (was.hash !== e.hash) c.changed.push(p);
    }
    for (const p of Object.keys(from.files)) if (within(p) && !(p in to.files)) c.removed.push(p);
    for (const list of [c.changed, c.added, c.removed]) list.sort();
    return c;
};
const count = (c: Changes) => c.changed.length + c.added.length + c.removed.length;
/** whether anything, an empty folder included, is different */
const differs = (a: Scan | Checkpoint, b: Scan | Checkpoint) => count(changesBetween(a, b)) > 0 || a.dirs.join("\0") !== b.dirs.join("\0");

/** "2 changed (~/a, ~/b), 1 new (~/c)", naming up to NAMED paths in all. */
function describe(c: Changes, words: { changed: string; added: string; removed: string }): string {
    let left = NAMED;
    const part = (list: string[], word: string) => {
        if (!list.length) return null;
        const named = list.slice(0, Math.max(left, 0)).map((p) => `~/${p}`);
        left -= named.length;
        const more = list.length - named.length;
        return `${list.length} ${word} (${named.join(", ")}${more ? `${named.length ? ", " : ""}and ${more} more` : ""})`;
    };
    return [part(c.changed, words.changed), part(c.added, words.added), part(c.removed, words.removed)].filter(Boolean).join(", ");
}
const SINCE = { changed: "changed", added: "new", removed: "removed" };

export class Checkpoints {
    private queue: Promise<unknown> = Promise.resolve();
    private loaded = new Map<number, Checkpoint>();
    /** what each file hashed to when last read, so an unchanged file isn't read again */
    private hashes = new Map<string, Entry>();

    constructor(private o: { home: HomeFolder; dir: string; now?: () => number }) {
        o.home.onErase(() => this.erase());
    }

    toolset(): Toolset {
        return {
            id: "checkpoints",
            tools: () => CHECKPOINT_TOOLS,
            instructions: () => CHECKPOINT_INSTRUCTIONS,
            call: (name, args) => this.serial(async (): Promise<ToolResult> => {
                try {
                    if (name === "checkpoint") return { text: await this.make(args.note) };
                    if (name === "checkpoints") return { text: await this.list(args.checkpoint) };
                    if (name === "restore") return { text: await this.restore(args.checkpoint, args.path) };
                    return { text: `unknown tool ${name}`, isError: true };
                } catch (e) {
                    return { text: e instanceof Error ? e.message : String(e), isError: true };
                }
            }),
        };
    }

    /** One at a time: each reads the whole folder, and a restore changes it. */
    private serial<T>(run: () => Promise<T>): Promise<T> {
        const next = this.queue.then(run, run);
        this.queue = next;
        return next;
    }

    private erase() {
        fs.rmSync(this.o.dir, { recursive: true, force: true });
        this.loaded.clear();
        this.hashes.clear();
    }

    private ids(): number[] {
        if (!fs.existsSync(this.o.dir)) return [];
        return fs
            .readdirSync(this.o.dir)
            .map((n) => n.match(/^(\d+)\.json$/)?.[1])
            .filter((n): n is string => n !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
    }

    private load(id: number): Checkpoint {
        const known = this.loaded.get(id);
        if (known) return known;
        const file = path.join(this.o.dir, `${id}.json`);
        if (!fs.existsSync(file)) throw new Error(`there's no checkpoint ${id}`);
        const c = JSON.parse(fs.readFileSync(file, "utf8")) as Checkpoint;
        this.loaded.set(id, c);
        return c;
    }

    private blob(hash: string): string {
        return path.join(this.o.dir, "files", hash.slice(0, 2), hash);
    }

    private writeAtomic(file: string, data: Buffer | string) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${randomBytes(4).toString("hex")}.partial`;
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, file);
    }

    /** Every file and folder in ~ as it is now; with `keep`, each file's contents are stored too. */
    private async scan(keep: boolean): Promise<Scan> {
        this.o.home.ensure();
        const root = fs.realpathSync(this.o.home.root);
        const out: Scan = { files: {}, dirs: [], left: [] };
        const walk = async (dir: string, rel: string) => {
            for (const d of (await fs.promises.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                const r = rel ? `${rel}/${d.name}` : d.name;
                const full = path.join(dir, d.name);
                if (d.isSymbolicLink()) {
                    out.left.push(`~/${r} (a link)`);
                } else if (d.isDirectory()) {
                    // packages come back from package.json; an install's half-made folder isn't the app's
                    if (d.name === "node_modules" || d.name.startsWith(".node_modules-")) continue;
                    out.dirs.push(r);
                    await walk(full, r);
                } else if (d.isFile()) {
                    const st = await fs.promises.stat(full);
                    if (st.size > FILE_BYTES) {
                        out.left.push(`~/${r} (over ${FILE_BYTES / 1024 / 1024} MB)`);
                        continue;
                    }
                    const known = this.hashes.get(r);
                    let entry: Entry;
                    if (known && known.size === st.size && known.mtime === st.mtimeMs && (!keep || fs.existsSync(this.blob(known.hash)))) {
                        entry = known;
                    } else {
                        const data = await fs.promises.readFile(full);
                        entry = { hash: createHash("sha256").update(data).digest("hex"), size: st.size, mtime: st.mtimeMs };
                        if (keep && !fs.existsSync(this.blob(entry.hash))) this.writeAtomic(this.blob(entry.hash), data);
                        this.hashes.set(r, entry);
                    }
                    out.files[r] = entry;
                }
            }
        };
        await walk(root, "");
        return out;
    }

    private save(scan: Scan, note: string): Checkpoint {
        const ids = this.ids();
        const c: Checkpoint = { id: (ids.at(-1) ?? 0) + 1, note, at: (this.o.now ?? Date.now)(), files: scan.files, dirs: scan.dirs };
        this.writeAtomic(path.join(this.o.dir, `${c.id}.json`), JSON.stringify(c));
        this.loaded.set(c.id, c);
        this.prune();
        return c;
    }

    /** Past KEPT, the oldest go, and with them the contents no checkpoint left needs. */
    private prune() {
        const ids = this.ids();
        if (ids.length <= KEPT) return;
        for (const id of ids.slice(0, ids.length - KEPT)) {
            fs.rmSync(path.join(this.o.dir, `${id}.json`));
            this.loaded.delete(id);
        }
        const needed = new Set(this.ids().flatMap((id) => Object.values(this.load(id).files).map((e) => e.hash)));
        const files = path.join(this.o.dir, "files");
        for (const shard of fs.readdirSync(files)) {
            for (const hash of fs.readdirSync(path.join(files, shard))) {
                if (!needed.has(hash)) fs.rmSync(path.join(files, shard, hash));
            }
        }
    }

    private name(c: Checkpoint): string {
        return `checkpoint ${c.id} ("${c.note}")`;
    }

    private async make(note: unknown): Promise<string> {
        if (typeof note !== "string" || !note.trim()) throw new Error("give the checkpoint a note saying what it is");
        if (note.trim().length > NOTE_CHARS) throw new Error(`a note is up to ${NOTE_CHARS} characters`);
        const scan = await this.scan(true);
        const last = this.ids().at(-1);
        const prev = last === undefined ? null : this.load(last);
        const left = scan.left.length ? ` Not kept: ${scan.left.join(", ")}.` : "";
        if (prev && !differs(prev, scan)) return `Nothing has changed since ${this.name(prev)}, so it already has everything.${left}`;
        const c = this.save(scan, note.trim());
        const n = Object.keys(c.files).length;
        const what = prev ? `since checkpoint ${prev.id}: ${describe(changesBetween(prev, scan), SINCE)}` : `${n} file${n === 1 ? "" : "s"}`;
        return `Kept ${this.name(c)}, ${what}.${left}`;
    }

    private async list(id: unknown): Promise<string> {
        const ids = this.ids();
        if (!ids.length) return "There are no checkpoints yet: make one with checkpoint.";
        const now = await this.scan(false);
        if (id !== undefined) {
            if (typeof id !== "number" || !Number.isInteger(id)) throw new Error("a checkpoint is given by its number");
            const c = this.load(id);
            const since = changesBetween(c, now);
            return count(since) ? `Since ${this.name(c)}: ${describe(since, SINCE)}.` : `Nothing has changed since ${this.name(c)}.`;
        }
        const lines = ids
            .slice(-NAMED)
            .reverse()
            .map((i) => {
                const c = this.load(i);
                return `${c.id} · ${localStamp(c.at)} · ${c.note}`;
            });
        const older = ids.length > NAMED ? `\n…and ${ids.length - NAMED} older` : "";
        const last = this.load(ids.at(-1)!);
        const since = changesBetween(last, now);
        const tail = count(since) ? `Since checkpoint ${last.id}: ${describe(since, SINCE)}.` : `Nothing has changed since checkpoint ${last.id}.`;
        return `${lines.join("\n")}${older}\n\n${tail}`;
    }

    private async restore(id: unknown, where: unknown): Promise<string> {
        if (typeof id !== "number" || !Number.isInteger(id)) throw new Error("a checkpoint is given by its number");
        const target = this.load(id);
        const home = this.o.home;
        let scope = "";
        if (where !== undefined) {
            if (typeof where !== "string") throw new Error("path is a file or folder in your home folder, e.g. ~/Pages/planner");
            const full = home.resolve(where);
            scope = path.relative(fs.realpathSync(home.root), full).split(path.sep).join("/");
        }
        const within = (p: string) => !scope || p === scope || p.startsWith(`${scope}/`);
        const shownScope = scope ? `~/${scope}` : "~";
        const now = await this.scan(true);
        const undo = changesBetween(target, now, within);
        const dirsBack = target.dirs.filter((d) => within(d) && !now.dirs.includes(d));
        const dirsGone = now.dirs.filter((d) => within(d) && !target.dirs.includes(d));
        if (!count(undo) && !dirsBack.length && !dirsGone.length) return `${shownScope} already matches ${this.name(target)}.`;

        // how things are now, so this restore can be undone too
        const last = this.load(this.ids().at(-1)!);
        const saved = differs(last, now);
        const kept = saved ? this.save(now, `before restoring checkpoint ${target.id}`) : last;

        try {
            // what's gone first, so a file can take a folder's place or a folder a file's
            for (const p of undo.added) {
                const full = home.resolve(`~/${p}`);
                if (!fs.lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink()) fs.rmSync(full, { force: true });
            }
            // the deepest first; a folder still holding something not kept (packages, a link) stays
            for (const d of dirsGone.sort((a, b) => b.length - a.length)) {
                const full = home.resolve(`~/${d}`);
                if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
            }
            for (const d of dirsBack) fs.mkdirSync(home.resolve(`~/${d}`), { recursive: true });
            for (const p of [...undo.changed, ...undo.removed]) {
                const blob = this.blob(target.files[p]!.hash);
                if (!fs.existsSync(blob)) throw new Error(`checkpoint ${target.id}'s copy of ~/${p} is missing`);
                home.write(`~/${p}`, fs.readFileSync(blob));
            }
        } catch (e) {
            throw new Error(`${shownScope} is only partly back to ${this.name(target)}, and checkpoint ${kept.id} has how it was: ${e instanceof Error ? e.message : String(e)}`);
        }

        const parts = describe({ changed: undo.changed, added: undo.added, removed: undo.removed }, { changed: "changed back", added: "removed", removed: "brought back" });
        const packages = [...undo.changed, ...undo.removed]
            .map((p) => p.match(/^Pages\/([^/]+)\/package\.json$/)?.[1])
            .filter((a): a is string => a !== undefined)
            .map((a) => ` ~/Pages/${a}'s package.json changed: add_package for ${a}, with no packages, installs what it lists.`)
            .join("");
        const undoNote = saved ? `Checkpoint ${kept.id} has how it was before` : `${this.name(kept)} already has how it was before`;
        return `${shownScope} is back to ${this.name(target)}${parts ? `: ${parts}` : ""}. ${undoNote}, to undo this.${packages}`;
    }
}
