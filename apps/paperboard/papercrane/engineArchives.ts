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
        for (const entry of zip.getEntries()) {
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
