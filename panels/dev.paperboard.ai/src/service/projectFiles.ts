// The effects of Local AI's project tools, confined to the project folder.
// This is the boundary: every path a model names is resolved here against
// the folder's real path, and anything that leads outside it (an absolute
// path, "..", a symlink, a dangling link to be written through) is refused.
// Every read, listing and search is capped.

import fs from "node:fs";
import path from "node:path";
import { MAX_DIFF_CHARS } from "../core/acp";
import { globMatcher, replaceExact, type ProjectTool } from "../core/projectTools";
import type { AgentToolDetails } from "../core/types";

/** a file larger than this is not read, edited or searched */
export const MAX_FILE_BYTES = 1024 * 1024;
/** text one read_file call hands back; the rest is read on with start_line */
export const MAX_READ_CHARS = 6000;
export const MAX_LIST_ENTRIES = 300;
export const MAX_SEARCH_RESULTS = 100;
/** files and folders one search looks at before it stops */
export const MAX_SEARCH_VISITED = 20_000;
/** bytes one search reads, across files */
export const MAX_SEARCH_BYTES = 32 * 1024 * 1024;
export const MAX_SEARCH_DEPTH = 24;
const MAX_LINE_CHARS = 200;
const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules"]);
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

export class ProjectScopeError extends Error {}

function inside(root: string, p: string): boolean {
    return p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function display(root: string, abs: string): string {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    return rel || ".";
}

function isMissing(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
}

interface Resolved {
    /** the real path inside the project, or where a new file goes */
    abs: string;
    /** the path as the model reads it back, relative to the project */
    shown: string;
    exists: boolean;
}

/**
 * One project's folder. `root` must be the project folder the service owns
 * (Projects.path); its real path is the boundary.
 */
export class ProjectFiles {
    private constructor(readonly root: string) {}

    static async open(dir: string): Promise<ProjectFiles> {
        return new ProjectFiles(await fs.promises.realpath(dir));
    }

    /**
     * A model's path, resolved inside the project. An existing path is
     * followed to its real location, which must be inside; a new one must
     * sit under a real folder inside, with no link anywhere on the way.
     */
    async resolve(raw: string): Promise<Resolved> {
        if (raw.includes("\0")) throw new ProjectScopeError("Paths can't contain NUL characters.");
        if (path.isAbsolute(raw) || path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw)) {
            throw new ProjectScopeError(`"${raw}" is not inside the project. Use a path relative to the project folder.`);
        }
        const target = path.resolve(this.root, raw);
        if (!inside(this.root, target)) throw new ProjectScopeError(`"${raw}" is outside the project.`);
        try {
            const real = await fs.promises.realpath(target);
            if (!inside(this.root, real)) throw new ProjectScopeError(`"${raw}" leads outside the project.`);
            return { abs: real, shown: display(this.root, real), exists: true };
        } catch (err) {
            if (!isMissing(err)) throw err;
        }
        // not there yet: every missing part must really be missing (a
        // dangling link would be written through), and the nearest part
        // that exists must be a real folder inside
        const missing: string[] = [];
        let at = target;
        for (;;) {
            try {
                await fs.promises.lstat(at);
            } catch (err) {
                if (!isMissing(err)) throw err;
                missing.unshift(path.basename(at));
                at = path.dirname(at);
                continue;
            }
            break;
        }
        if (missing.length === 0) throw new ProjectScopeError(`"${raw}" is a link that leads nowhere.`);
        const base = await fs.promises.realpath(at).catch((err) => {
            if (isMissing(err)) throw new ProjectScopeError(`"${raw}" is a link that leads nowhere.`);
            throw err;
        });
        if (!inside(this.root, base)) throw new ProjectScopeError(`"${raw}" leads outside the project.`);
        const stat = await fs.promises.stat(base);
        if (!stat.isDirectory()) throw new ProjectScopeError(`"${display(this.root, base)}" is a file, not a folder.`);
        const abs = path.join(base, ...missing);
        return { abs, shown: display(this.root, abs), exists: false };
    }

    /** A text file's content, refused when it is larger than the cap or not text. */
    private async readText(abs: string, shown: string): Promise<string> {
        const handle = await fs.promises.open(abs, fs.constants.O_RDONLY | NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (stat.isDirectory()) throw new ProjectScopeError(`"${shown}" is a folder. Use list_directory.`);
            if (!stat.isFile()) throw new ProjectScopeError(`"${shown}" is not a regular file.`);
            if (stat.size > MAX_FILE_BYTES) throw new ProjectScopeError(`"${shown}" is ${stat.size} bytes; files over ${MAX_FILE_BYTES} bytes are not read.`);
            const buf = Buffer.alloc(stat.size);
            const { bytesRead } = await handle.read(buf, 0, stat.size, 0);
            const bytes = buf.subarray(0, bytesRead);
            if (bytes.includes(0)) throw new ProjectScopeError(`"${shown}" is a binary file.`);
            return bytes.toString("utf8");
        } finally {
            await handle.close();
        }
    }

    async readFile(raw: string, startLine = 1): Promise<string> {
        const r = await this.resolve(raw);
        if (!r.exists) throw new ProjectScopeError(`"${r.shown}" does not exist.`);
        const text = await this.readText(r.abs, r.shown);
        const lines = text.split("\n");
        if (startLine > lines.length) return `${r.shown} has ${lines.length} lines; start_line ${startLine} is past the end.`;
        const out: string[] = [];
        let size = 0;
        let line = startLine;
        for (; line <= lines.length; line++) {
            const next = lines[line - 1]!;
            if (size + next.length + 1 > MAX_READ_CHARS && out.length > 0) break;
            out.push(next.length > MAX_READ_CHARS ? `${next.slice(0, MAX_READ_CHARS)} [line cut]` : next);
            size += next.length + 1;
        }
        const head = `${r.shown} (lines ${startLine}-${line - 1} of ${lines.length})`;
        const more = line <= lines.length ? `\n[more: read on with start_line ${line}]` : "";
        return `${head}\n${out.join("\n")}${more}`;
    }

    async listDirectory(raw: string): Promise<string> {
        const r = await this.resolve(raw);
        if (!r.exists) throw new ProjectScopeError(`"${r.shown}" does not exist.`);
        const stat = await fs.promises.stat(r.abs);
        if (!stat.isDirectory()) throw new ProjectScopeError(`"${r.shown}" is a file. Use read_file.`);
        const names: string[] = [];
        let more = 0;
        const dir = await fs.promises.opendir(r.abs);
        for await (const entry of dir) {
            if (names.length >= MAX_LIST_ENTRIES) {
                more++;
                if (more >= MAX_LIST_ENTRIES) break; // counted far enough to say "many"
                continue;
            }
            names.push(entry.isDirectory() ? `${entry.name}/` : entry.isSymbolicLink() ? `${entry.name} (link)` : entry.name);
        }
        names.sort((a, b) => a.localeCompare(b));
        const head = `${r.shown}: ${names.length === 0 ? "empty" : `${names.length} entries`}`;
        const tail = more ? `\n[${more >= MAX_LIST_ENTRIES ? "many" : more} more not listed]` : "";
        return `${head}\n${names.join("\n")}${tail}`;
    }

    /**
     * Files whose path matches `pattern`, and lines containing `text`.
     * Walks breadth first, never through links, and stops at the result,
     * visit, byte and depth caps, saying which one it hit.
     */
    async search(raw: string, opts: { pattern?: string; text?: string }, signal?: AbortSignal): Promise<string> {
        const r = await this.resolve(raw);
        if (!r.exists) throw new ProjectScopeError(`"${r.shown}" does not exist.`);
        if (!(await fs.promises.stat(r.abs)).isDirectory()) throw new ProjectScopeError(`"${r.shown}" is a file, not a folder.`);
        const matches = opts.pattern ? globMatcher(opts.pattern) : () => true;
        const needle = opts.text?.toLowerCase();
        const results: string[] = [];
        let visited = 0;
        let bytes = 0;
        let stopped = "";
        const queue: { abs: string; depth: number }[] = [{ abs: r.abs, depth: 0 }];
        // leaving a for-await loop closes its folder
        walk: while (queue.length > 0) {
            const { abs: folder, depth } = queue.shift()!;
            const dir = await fs.promises.opendir(folder);
            for await (const entry of dir) {
                if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
                if (++visited > MAX_SEARCH_VISITED) {
                    stopped = `stopped after looking at ${MAX_SEARCH_VISITED} files and folders`;
                    break walk;
                }
                const abs = path.join(folder, entry.name);
                if (entry.isDirectory()) {
                    if (SKIPPED_DIRS.has(entry.name)) continue;
                    if (depth + 1 > MAX_SEARCH_DEPTH) {
                        stopped ||= `folders deeper than ${MAX_SEARCH_DEPTH} levels were skipped`;
                        continue;
                    }
                    queue.push({ abs, depth: depth + 1 });
                    continue;
                }
                if (!entry.isFile()) continue; // links and devices are never followed
                const rel = display(this.root, abs);
                if (!matches(rel)) continue;
                if (needle === undefined) {
                    results.push(rel);
                } else {
                    const stat = await fs.promises.lstat(abs);
                    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
                    if (bytes + stat.size > MAX_SEARCH_BYTES) {
                        stopped = `stopped after reading ${MAX_SEARCH_BYTES} bytes`;
                        break walk;
                    }
                    bytes += stat.size;
                    let text: string;
                    try {
                        text = await this.readText(abs, rel);
                    } catch (err) {
                        if (err instanceof ProjectScopeError) continue; // binary or changed under us: not text to search
                        throw err;
                    }
                    const lines = text.split("\n");
                    for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
                        if (lines[i]!.toLowerCase().includes(needle)) {
                            const line = lines[i]!.trim();
                            results.push(`${rel}:${i + 1}: ${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line}`);
                        }
                    }
                }
                if (results.length >= MAX_SEARCH_RESULTS) {
                    stopped = `stopped at ${MAX_SEARCH_RESULTS} results`;
                    break walk;
                }
            }
        }
        const head = results.length === 0 ? "No matches." : `${results.length} ${results.length === 1 ? "match" : "matches"}:`;
        return [head, ...results, ...(stopped ? [`[${stopped}]`] : [])].join("\n");
    }

    /**
     * A file change, prepared but not made: what the approval card shows,
     * and the write that happens once allowed. The write refuses when the
     * file changed after it was shown.
     */
    async prepareChange(tool: Extract<ProjectTool, "write_file" | "edit_file">, args: Record<string, unknown>): Promise<PreparedChange> {
        const r = await this.resolve(args.path as string);
        let before: string | null = null;
        if (r.exists) before = await this.readText(r.abs, r.shown);
        let after: string;
        let summary: string;
        if (tool === "write_file") {
            after = args.content as string;
            summary = `${before === null ? "Created" : "Replaced"} ${r.shown} (${Buffer.byteLength(after)} bytes).`;
        } else {
            if (before === null) throw new ProjectScopeError(`"${r.shown}" does not exist. Use write_file to create it.`);
            const replaced = replaceExact(before, args.old_text as string, args.new_text as string, args.replace_all === true);
            after = replaced.text;
            summary = `Edited ${r.shown}: replaced ${replaced.count} ${replaced.count === 1 ? "occurrence" : "occurrences"}.`;
        }
        if (Buffer.byteLength(after) > MAX_FILE_BYTES) throw new ProjectScopeError(`The result would be over ${MAX_FILE_BYTES} bytes.`);
        const cut = (t: string) => (t.length > MAX_DIFF_CHARS ? t.slice(0, MAX_DIFF_CHARS) : t);
        const truncated = (before?.length ?? 0) > MAX_DIFF_CHARS || after.length > MAX_DIFF_CHARS;
        const details: AgentToolDetails = {
            kind: "edit",
            locations: [r.shown],
            diffs: [{ path: r.shown, oldText: before === null ? null : cut(before), newText: cut(after), ...(truncated ? { truncated: true } : {}) }],
        };
        return {
            details,
            apply: async () => {
                // resolved again: the folder may have changed while the card waited
                const now = await this.resolve(args.path as string);
                if (now.abs !== r.abs) throw new ProjectScopeError(`"${r.shown}" moved after it was shown. Nothing was written.`);
                const current = now.exists ? await this.readText(now.abs, now.shown) : null;
                if (current !== before) throw new ProjectScopeError(`"${r.shown}" changed after the change was shown. Nothing was written; read it again.`);
                await this.writeAtomic(now.abs, after);
                return summary;
            },
        };
    }

    /** Writes beside the target and renames over it: a link put in its place is replaced, not followed. */
    private async writeAtomic(abs: string, text: string): Promise<void> {
        const parent = path.dirname(abs);
        await fs.promises.mkdir(parent, { recursive: true });
        // the folders just made must still be inside (nothing raced a link in)
        const realParent = await fs.promises.realpath(parent);
        if (!inside(this.root, realParent)) throw new ProjectScopeError("The folder moved outside the project. Nothing was written.");
        let mode: number | undefined;
        try {
            const st = await fs.promises.lstat(abs);
            if (st.isFile()) mode = st.mode & 0o777;
        } catch (err) {
            if (!isMissing(err)) throw err;
        }
        const tmp = path.join(realParent, `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`);
        try {
            await fs.promises.writeFile(tmp, text, { flag: "wx", ...(mode !== undefined ? { mode } : {}) });
            await fs.promises.rename(tmp, path.join(realParent, path.basename(abs)));
        } catch (err) {
            await fs.promises.rm(tmp, { force: true }).catch((cleanup) => console.error("[ai] removing a half-written file failed:", String(cleanup)));
            throw err;
        }
    }
}

export interface PreparedChange {
    details: AgentToolDetails;
    /** makes the change; resolves with what the model reads back */
    apply: () => Promise<string>;
}
