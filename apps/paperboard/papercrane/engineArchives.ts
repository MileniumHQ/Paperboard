// archive extraction via bundled libs, no system tools
import path from "path";
import { logger } from "./logger";
import fs from "fs";
import * as tar from "tar";
import AdmZip from "adm-zip";
import { moveFileSafe, makeSafeTarFilter } from "./storage";

// Extracts .tar.gz, .tgz, .zip or single files
export async function extractArchive(
    archivePath: string,
    destDir: string,
): Promise<void> {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const isTar =
        archivePath.endsWith(".tar.gz") ||
        archivePath.endsWith(".tgz") ||
        archivePath.endsWith(".tar");
    const isZip = archivePath.endsWith(".zip");

    if (isTar) {
        await tar.extract({
            file: archivePath,
            cwd: destDir,
            strip: 0,
            filter: makeSafeTarFilter(path.resolve(destDir)),
        });
    } else if (isZip) {
        // pure-JS unzip with zip-slip guard
        const dest = path.resolve(destDir);
        const destWithSep = dest.endsWith(path.sep) ? dest : dest + path.sep;
        const zip = new AdmZip(archivePath);
        let extractedBytes = 0;
        if (zip.getEntries().length > 100_000) throw new Error("Archive exceeds entry budget");
        for (const entry of zip.getEntries()) {
            extractedBytes += entry.header.size;
            if (extractedBytes > 4 * 1024 * 1024 * 1024) throw new Error("Archive exceeds extraction budget");
            const name = entry.entryName;
            if (!name || typeof name !== "string") {
                throw new Error(`Unsafe zip entry name in ${path.basename(archivePath)}`);
            }
            const normalized = path.normalize(name);
            if (path.isAbsolute(normalized)) {
                throw new Error(`Zip entry escapes archive: ${name}`);
            }
            const resolved = path.resolve(dest, normalized);
            if (resolved !== dest && !resolved.startsWith(destWithSep)) {
                throw new Error(`Zip entry escapes archive: ${name}`);
            }
        }
        zip.extractAllTo(dest, true);
    } else {
        // raw binary
        const destFile = path.join(destDir, path.basename(archivePath));
        await moveFileSafe(archivePath, destFile);
        if (process.platform !== "win32") fs.chmodSync(destFile, 0o755);
    }
}

// find a dir containing bin/, up to maxDepth levels
export function findBinDir(dir: string, maxDepth: number): string | null {
    if (!fs.existsSync(dir) || maxDepth < 0) return null;
    if (fs.existsSync(path.join(dir, "bin"))) return dir;
    try {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            if (entry.startsWith(".")) continue;
            const sub = path.join(dir, entry);
            try {
                if (fs.statSync(sub).isDirectory()) {
                    const result = findBinDir(sub, maxDepth - 1);
                    if (result) return result;
                }
            } catch (err) { logger.debug("[engineArchives.ts] op failed:", err) }
        }
    } catch (err) { logger.debug("[engineArchives.ts] op failed:", err) }
    return null;
}

// ─── Package archive layouts ─────────────────────────────────────────────────
// A registry package record may declare how its archive maps onto the
// installed package directory (Origami writes these; see
// apps/origami/scripts/lib/records.ts). The installed package always ends
// up with a bin/ directory at its root, which is what getPackagePath and
// every consumer (`${path}/bin/java`, `${path}/bin/ollama`) rely on.
//
// - wrapped (default): one top-level wrapper dir around bin/ (JDKs); a
//   wrapper-less archive is re-extracted flat
// - root: the archive root is the package root and already holds bin/
// - bin: the archive root is the package's bin/ (flat builds whose files
//   must stay side by side, e.g. an executable next to its lib/ tree)
export const PACKAGE_LAYOUTS = ["wrapped", "root", "bin"] as const;
export type PackageLayout = (typeof PACKAGE_LAYOUTS)[number];

// An unrecognized layout is refused, never guessed: extracting with the
// wrong mapping installs a package whose binaries are not where callers
// will look for them.
export function parsePackageLayout(value: unknown): PackageLayout {
    if (value === undefined || value === null) return "wrapped";
    if (typeof value === "string" && (PACKAGE_LAYOUTS as readonly string[]).includes(value)) {
        return value as PackageLayout;
    }
    throw new Error(`Unsupported package layout ${JSON.stringify(value)}`);
}

// archive suffix from the download URL; tar variants (gzip, zstd, plain)
// share one extractor that detects compression from the bytes
export function packageArchiveSuffix(url: string): string {
    let base = "";
    try {
        base = path.basename(new URL(url).pathname).toLowerCase();
    } catch (err) {
        logger.debug("[engineArchives.ts] unparseable package url:", err);
        return "";
    }
    for (const ext of [".zip", ".tar.gz", ".tgz", ".tar.zst", ".tar"]) {
        if (base.endsWith(ext)) return ext;
    }
    return "";
}

export async function extractPackageArchive(
    archivePath: string,
    pkgDir: string,
    layout: PackageLayout,
    suffix: string,
): Promise<void> {
    const dest = layout === "bin" ? path.join(pkgDir, "bin") : pkgDir;
    fs.mkdirSync(dest, { recursive: true });
    if (suffix === ".zip") {
        await extractArchive(archivePath, dest);
        return;
    }
    if (layout !== "wrapped") {
        await tar.extract({ file: archivePath, cwd: dest, strip: 0, filter: makeSafeTarFilter(path.resolve(dest)) });
        return;
    }
    // wrapped: strip the wrapper dir; a wrapper-less archive leaves no bin/
    // behind, so it is re-extracted flat
    try {
        await tar.extract({ file: archivePath, cwd: pkgDir, strip: 1, filter: makeSafeTarFilter(path.resolve(pkgDir)) });
        if (fs.existsSync(path.join(pkgDir, "bin"))) return;
    } catch (err) {
        logger.debug(`[engineArchives.ts] wrapped tar extraction failed; retrying flat:`, err);
    }
    await fs.promises.rm(pkgDir, { recursive: true, force: true });
    fs.mkdirSync(pkgDir, { recursive: true });
    await tar.extract({ file: archivePath, cwd: pkgDir, strip: 0, filter: makeSafeTarFilter(path.resolve(pkgDir)) });
}
