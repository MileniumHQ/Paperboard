// Tar archive safety: pre-scan every member against its destination and
// extraction budget before handing extraction to node-tar.
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

const SUPPORTED_TYPES = new Set(["File", "OldFile", "Directory", "SymbolicLink", "Link", "ContiguousFile"]);

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
        const linkTarget =
            entry.type === "Link" && strip > 0
                ? entry.linkpath.split(/[\\/]/).slice(strip).join(path.sep)
                : entry.linkpath;
        const target = path.resolve(entry.type === "SymbolicLink" ? path.dirname(resolved) : root, linkTarget);
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

interface TarSymlink {
    path: string;
    linkpath: string;
}

// Pre-extract scan of a tar archive: every member is checked against its
// destination, supported type list, and extraction budget as the archive
// streams past. Rejection is raised outside the tar stream as a real
// rejection rather than an unhandled stream error.
export async function scanTarMembers(
    archivePath: string,
    destDir: string,
    strip = 0,
    refuse?: (member: { path: string; type: string }) => string | null,
): Promise<TarSymlink[]> {
    const symlinks: TarSymlink[] = [];
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
                const type = String(entry.type);
                if (!SUPPORTED_TYPES.has(type)) {
                    settle(new Error(`Unsupported archive member ${entry.path}: ${type}`));
                    return;
                }
                const refusal = refuse?.({ path: String(entry.path), type });
                if (refusal) {
                    settle(new Error(refusal));
                    return;
                }
                const verdict = classifyTarMember(destDir, entry.path, strip, entry);
                if (verdict === "escape") {
                    settle(new Error(`Archive entry escapes destination: ${entry.path}`));
                } else if (verdict === "ok" && type === "SymbolicLink" && entry.linkpath) {
                    const effective = path.normalize(entry.path).split(/[\\/]/).slice(strip).join(path.sep);
                    symlinks.push({ path: effective, linkpath: entry.linkpath });
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
    return symlinks;
}

/** Pre-scan an archive for escapes/budget, then extract it with node-tar. */
export async function extractTarSafely(archive: string, dest: string, strip = 0): Promise<void> {
    const symlinks = await scanTarMembers(archive, dest, strip);
    const filter = makeSafeTarFilter(dest, strip);
    let warning: Error | undefined;
    await tar.extract({
        file: archive,
        cwd: dest,
        strip,
        maxDepth: TAR_BUDGET.maxDepth,
        // node-tar rejects valid symlink chains (e.g. bin/tool -> ../lib/real -> impl),
        // so create pre-validated symlinks after files and hardlinks are extracted
        filter: (name, entry) => filter(name, entry) && (!("type" in entry) || entry.type !== "SymbolicLink"),
        onwarn: (code, message, data) => {
            warning ??= new Error(`Archive member ${(data.entry as { path?: string } | undefined)?.path ?? data.path ?? archive}: ${code}: ${message}`);
        },
    });
    if (warning) throw warning;
    for (const link of symlinks) {
        const target = path.join(dest, link.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(link.linkpath, target);
    }
}
