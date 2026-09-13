import * as fs from "fs";
import { logger } from "./logger";
import * as path from "path";

// optional branding files, callers fall back to defaults
const brandingDirCandidates = (): string[] => {
    const dirs: string[] = [];
    try {
        // standalone binary: <exedir>/branding/
        dirs.push(path.join(path.dirname(process.execPath), "branding"));
    } catch (err) { logger.debug("[branding.ts] op failed:", err) }
    try {
        // dev run: ./papercrane/branding/
        dirs.push(path.join(process.cwd(), "papercrane", "branding"));
    } catch (err) { logger.debug("[branding.ts] op failed:", err) }
    try {
        // bundled CJS: <this-module-dir>/branding/
        if (typeof __dirname === "string" && __dirname) {
            dirs.push(path.join(__dirname, "branding"));
        }
    } catch (err) { logger.debug("[branding.ts] op failed:", err) }
    return dirs;
};

let brandingCache: Map<string, string | null> | null = null;

/** Branding file path, or null when absent */
export function findBrandingFile(name: string): string | null {
    if (!brandingCache) brandingCache = new Map();
    if (brandingCache.has(name)) return brandingCache.get(name) ?? null;
    for (const dir of brandingDirCandidates()) {
        const candidate = path.join(dir, name);
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                brandingCache.set(name, candidate);
                return candidate;
            }
        } catch (err) { logger.debug("[branding.ts] op failed:", err) }
    }
    brandingCache.set(name, null);
    return null;
}

/** Banner text, or null when absent */
export function readBanner(): string | null {
    const file = findBrandingFile("banner.txt");
    if (!file) return null;
    try {
        const text = fs.readFileSync(file, "utf8").replace(/\s+$/, "");
        return text || null;
    } catch (err) {
        logger.debug("[branding] banner unreadable, continuing without one:", err);
        return null;
    }
}
