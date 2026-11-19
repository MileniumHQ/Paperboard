// Tar archive safety: every member is checked against its destination
// before anything is written, and links are created only after the scan.
import * as fs from "fs";
import * as path from "path";
import * as tar from "tar";
import { LimitError } from "../core/storage";

// the one extraction budget, enforced by the pre-extract scan; the filter
// only drops members rather than throwing, because tar@7 turns filter
// throws into unhandled stream errors instead of rejections
export const TAR_BUDGET = {
    maxEntries: 100_000,
    maxBytes: 4 * 1024 * 1024 * 1024,
    // node-tar's own default, passed to it explicitly: the scan refuses a
    // deeper member up front, so extraction never meets one half way through
    maxDepth: 1024,
};

// a member's depth as node-tar counts it: path segments after the strip,
// with backslashes as separators only on Windows
function tarMemberDepth(entryPath: string, strip: number): number {
    const normalized = process.platform === "win32" ? entryPath.replace(/\\/g, "/") : entryPath;
    return normalized.split("/").length - strip;
}

// Classification shared by the refuser (scanTarMembers) and the extractor
// (makeSafeTarFilter): a member is written ("ok"), legitimately absent
// under the strip depth ("drop"), or never allowed anywhere ("escape").
// Escape members are refused by the scan — they must never become a
// silent skip that installs bytes different from the verified archive.
export function classifyTarMember(
    destDir: string,
    entryPath: unknown,
    strip: number,
    entry?: { size?: number; linkpath?: string; type?: string },
): "ok" | "drop" | "escape" {
    if (typeof entryPath !== "string") return "escape";
    const root = path.resolve(destDir);
    const destWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    const normalized = path.normalize(entryPath);
    if (entryPath.split(/[\\/]/).includes("..")) return "escape";
    if (path.isAbsolute(normalized)) return "escape";
    // node-tar strips `strip` leading segments after any filter runs, so
    // the entry lands at the stripped path. Resolve it the same way tar
    // will: a link that looks contained pre-strip can point outside once
    // its directory moves.
    let effective = normalized;
    if (strip > 0) {
        const parts = normalized.split(/[\\/]/);
        if (parts.length < strip) return "drop";
        effective = parts.slice(strip).join(path.sep);
    }
    if (!effective || effective === ".") return "drop";
    const resolved = path.resolve(root, effective);
    if (entry?.linkpath) {
        if (path.isAbsolute(entry.linkpath) || path.win32.isAbsolute(entry.linkpath)) return "escape";
        const target = path.resolve(entry.type === "SymbolicLink" ? path.dirname(resolved) : root, entry.linkpath);
        if (target !== root && !target.startsWith(destWithSep)) return "escape";
    }
    if (!resolved.startsWith(destWithSep) && resolved !== root) return "escape";
    return "ok";
}

// Tar filter with budget accounting; refusal happens in scanTarMembers
export function makeSafeTarFilter(destDir: string, strip = 0): (entryPath: string, entry?: { size?: number; linkpath?: string; type?: string }) => boolean {
    let total = 0;
    let count = 0;
    return (entryPath, entry) => {
        total += entry?.size ?? 0;
        if (++count > TAR_BUDGET.maxEntries || total > TAR_BUDGET.maxBytes) return false;
        return classifyTarMember(destDir, entryPath, strip, entry) === "ok";
    };
}

// Pre-extract scan of a tar archive: every member is classified against
// its planned destination as the archive streams past. The first escape
// member, `refuse` verdict, or budget excess rejects at once and stops
// reading (the installed bytes must be the verified bytes, and a limit
// never trips only after the excess was skipped). A bounded member graph
// validates forward links. Rejection is raised outside the tar stream as a real
// rejection rather than an unhandled stream error.
export async function scanTarMembers(
    archivePath: string,
    destDir: string,
    strip = 0,
    refuse?: (member: { path: string; type: string }) => string | null,
): Promise<TarMember[]> {
    const members: TarMember[] = [];
    const source = fs.createReadStream(archivePath);
    await new Promise<void>((resolve, reject) => {
        let total = 0;
        let count = 0;
        let settled = false;
        const settle = (err?: Error) => {
            if (settled) return;
            settled = true;
            source.unpipe();
            source.destroy();
            if (err) reject(err);
            else resolve();
        };
        const parser = new tar.Parser({
            onwarn: (code, message, data) => settle(new Error(`Archive member ${(data.entry as { path?: string } | undefined)?.path ?? data.path ?? archivePath}: ${code}: ${message}`)),
            onReadEntry: (entry) => {
                entry.resume();
                if (settled) return;
                total += entry.size ?? 0;
                if (++count > TAR_BUDGET.maxEntries || total > TAR_BUDGET.maxBytes) {
                    settle(new LimitError(`Archive exceeds extraction budget at member: ${entry.path}`));
                    return;
                }
                if (tarMemberDepth(String(entry.path), strip) > TAR_BUDGET.maxDepth) {
                    settle(new LimitError(`Archive member nests deeper than ${TAR_BUDGET.maxDepth} levels: ${String(entry.path).slice(0, 200)}`));
                    return;
                }
                const refusal = refuse?.({ path: String(entry.path), type: String(entry.type) });
                if (refusal) {
                    settle(new Error(refusal));
                    return;
                }
                // Symbolic targets require component-by-component graph resolution,
                // not lexical normalization (which can both hide and invent escapes).
                const verdict = classifyTarMember(destDir, entry.path, strip,
                    entry.type === "SymbolicLink" ? { type: entry.type } : entry);
                if (verdict === "escape") {
                    settle(new Error(`Archive entry escapes destination: ${entry.path}`));
                } else if (verdict === "ok") {
                    const name = path.relative(path.resolve(destDir), path.resolve(destDir, path.normalize(entry.path).split(/[\\/]/).slice(strip).join(path.sep)));
                    members.push({ path: name, original: String(entry.path), type: String(entry.type), size: entry.size, linkpath: entry.type === "Link" ? (entry.linkpath ?? "").split("/").slice(strip).join("/") : entry.linkpath ?? "" });
                }
            },
        });
        parser.on("ignoredEntry", (entry: tar.ReadEntry) => {
            if (classifyTarMember(destDir, entry.path, strip, entry) !== "drop") {
                settle(new Error(`Archive member was skipped by parser: ${entry.path}`));
            }
        });
        parser.on("error", (err: Error) => settle(err));
        parser.on("end", () => settle());
        source.on("error", (err) => settle(err));
        source.pipe(parser);
    });
    validateTarGraph(members);
    return members;
}

interface TarMember {
    path: string;
    original: string;
    type: string;
    size: number;
    linkpath: string;
}

// Resolve components before processing '..': normalizing first can hide an
// escape through a directory link. Missing leaves are permitted (dangling links).
function validateTarGraph(members: TarMember[]): Map<string, TarMember> {
    const graph = new Map<string, TarMember>();
    for (const member of members) {
        if (!["File", "OldFile", "Directory", "SymbolicLink", "Link", "ContiguousFile"].includes(member.type)) {
            throw new Error(`Unsupported archive member ${member.original}: ${member.type}`);
        }
        if ((member.type === "SymbolicLink" || member.type === "Link") &&
            (path.isAbsolute(member.linkpath) || path.win32.isAbsolute(member.linkpath))) {
            throw new Error(`Archive link escapes destination: ${member.original}`);
        }
        const previous = graph.get(member.path);
        if (previous && !(previous.type === "Directory" && member.type === "Directory")) {
            throw new Error(`Duplicate archive member: ${member.original}`);
        }
        graph.set(member.path, member);
    }
    for (const member of members) {
        const parts = member.path.split(path.sep);
        for (let i = 1; i < parts.length; i++) {
            const parent = graph.get(parts.slice(0, i).join(path.sep));
            if (parent && parent.type !== "Directory") throw new Error(`Archive member ${member.original} writes through ${parent.original}`);
        }
        if (member.type === "SymbolicLink" || member.type === "Link") resolveTarLink(graph, member);
    }
    return graph;
}

function resolveTarLink(graph: Map<string, TarMember>, member: TarMember): string {
    let depth = 0;
    const resolve = (parts: string[], current: string[] = []): string => {
        for (const part of parts) {
            if (!part || part === ".") continue;
            if (part === "..") {
                if (!current.length) throw new Error(`Archive link escapes destination: ${member.original}`);
                current.pop();
                continue;
            }
            current.push(part);
            const link = graph.get(current.join(path.sep));
            if (link?.type === "SymbolicLink" || link?.type === "Link") {
                if (++depth > 40) throw new Error(`Archive link loop or depth exceeded: ${member.original}`);
                current = resolve(link.linkpath.split(/[\\/]/), link.type === "SymbolicLink" ? current.slice(0, -1) : []).split(path.sep).filter(Boolean);
            }
        }
        return current.join(path.sep);
    };
    return resolve(member.linkpath.split(/[\\/]/), member.type === "SymbolicLink" ? member.path.split(path.sep).slice(0, -1) : []);
}

/** Extract every accepted member or reject; node-tar never creates links. */
export async function extractTarSafely(archive: string, dest: string, strip = 0): Promise<void> {
    const members = await scanTarMembers(archive, dest, strip);
    const graph = validateTarGraph(members);
    // Existing destination aliases must not redirect our deferred link writes.
    for (const member of members) {
        const paths = [member.path];
        if (member.type === "SymbolicLink" || member.type === "Link") paths.push(resolveTarLink(graph, member));
        for (const name of paths) {
            let current = path.resolve(dest);
            for (const part of ["", ...name.split(path.sep)]) {
                current = path.join(current, part);
                if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
                    throw new Error(`Archive member ${member.original} traverses existing symlink: ${current}`);
                }
            }
        }
    }
    let warning: Error | undefined;
    await tar.extract({
        file: archive, cwd: dest, strip, maxDepth: TAR_BUDGET.maxDepth,
        filter: (name, entry) => {
            const verdict = classifyTarMember(dest, name, strip,
                "type" in entry && entry.type === "SymbolicLink" ? { type: entry.type } : entry);
            if (verdict === "escape") warning ??= new Error(`Archive member refused: ${name}`);
            return verdict === "ok" && ("type" in entry && entry.type !== "SymbolicLink" && entry.type !== "Link");
        },
        onwarn: (code, message, data) => {
            warning ??= new Error(`Archive member ${(data.entry as { path?: string } | undefined)?.path ?? data.path ?? archive}: ${code}: ${message}`);
        },
    });
    if (warning) throw warning;
    // Hardlinks resolve to the final regular file, so forward links work too.
    for (const member of members.filter(m => m.type === "Link")) {
        const target = resolveTarLink(graph, member);
        const source = path.join(dest, target);
        if (!fs.lstatSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`Archive hardlink target is not a file: ${member.original}`);
        fs.mkdirSync(path.dirname(path.join(dest, member.path)), { recursive: true });
        fs.linkSync(source, path.join(dest, member.path));
    }
    for (const member of members.filter(m => m.type === "SymbolicLink")) {
        fs.mkdirSync(path.dirname(path.join(dest, member.path)), { recursive: true });
        fs.symlinkSync(member.linkpath, path.join(dest, member.path));
    }
    for (const member of members) {
        const full = path.join(dest, member.path);
        const stat = fs.lstatSync(full, { throwIfNoEntry: false });
        const valid = member.type === "SymbolicLink" ? stat?.isSymbolicLink() && fs.readlinkSync(full) === member.linkpath
            : member.type === "Directory" ? stat?.isDirectory()
            : stat?.isFile() && (member.type === "Link" || stat.size === member.size);
        if (!valid) throw new Error(`Archive member was not written correctly: ${member.original}`);
    }
}

/** Recheck links after recipe takes have changed the tree's root/layout. */
export function validateExtractedLinks(root: string): void {
    const members: TarMember[] = [];
    const visit = (dir: string) => {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const stat = fs.lstatSync(full);
            const relative = path.relative(root, full);
            members.push({ path: relative, original: relative, size: stat.size,
                type: stat.isSymbolicLink() ? "SymbolicLink" : stat.isDirectory() ? "Directory" : "File",
                linkpath: stat.isSymbolicLink() ? fs.readlinkSync(full) : "" });
            if (stat.isDirectory()) visit(full);
        }
    };
    visit(root);
    validateTarGraph(members);
}
