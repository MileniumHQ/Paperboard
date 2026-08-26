// Archive extraction helpers for PaperCraneEngine.

import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import * as tar from "tar";
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
        if (process.platform === "win32") {
            // EncodedCommand avoids any quoting/injection issues with paths
            const psScript = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;
            const encoded = Buffer.from(psScript, "utf16le").toString(
                "base64",
            );
            spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], {
                stdio: "pipe",
            });
        } else {
            spawnSync("unzip", ["-q", "-o", archivePath, "-d", destDir], {
                stdio: "pipe",
            });
        }
    } else {
        // Raw binary
        const destFile = path.join(destDir, path.basename(archivePath));
        await moveFileSafe(archivePath, destFile);
        if (process.platform !== "win32") fs.chmodSync(destFile, 0o755);
    }
}

// Recursively searches for a directory containing a bin/ subdirectory,
// up to maxDepth levels.
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
            } catch {}
        }
    } catch {}
    return null;
}
