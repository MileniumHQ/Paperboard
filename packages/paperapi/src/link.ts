import path from "path";
import fs from "fs";
import os from "os";
import { PANEL_ID_REGEX } from "./pack";
import { debugErr } from "./debug";

// dev-link target root. Same root variable the transport handshake uses
// (PAPERBOARD_DIR, see ws.ts), so a machine with a relocated .paperboard
// links into the same tree the daemon scans.
function getPanelsDir(): string {
    const root =
        process.env.PAPERBOARD_DIR ||
        path.join(typeof os.homedir === "function" ? os.homedir() : "", ".paperboard");
    return path.join(root, "panels");
}

export interface LinkOptions {
    targetDir?: string;
    force?: boolean;
}

// links a local panel folder into ~/.paperboard/panels for live dev
export function linkPanel(options: LinkOptions = {}): {
    id: string;
    name: string;
    sourcePath: string;
    linkPath: string;
} {
    const panelsDir = getPanelsDir();
    const sourcePath = path.resolve(options.targetDir || process.cwd());
    const manifestPath = path.join(sourcePath, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`No manifest.json found at ${sourcePath}. Cannot link non-panel directory.`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest.id || typeof manifest.id !== "string" || !PANEL_ID_REGEX.test(manifest.id)) {
        throw new Error(`Invalid panel id '${manifest.id}'. Must follow reverse-domain format.`);
    }

    if (!fs.existsSync(panelsDir)) {
        fs.mkdirSync(panelsDir, { recursive: true });
    }

    const linkPath = path.join(panelsDir, manifest.id);

    if (fs.existsSync(linkPath)) {
        const lstat = fs.lstatSync(linkPath);
        if (lstat.isSymbolicLink()) {
            fs.unlinkSync(linkPath);
        } else if (lstat.isDirectory()) {
            if (options.force) {
                // recoverable destruction: rename to a trash name BEFORE
                // rmSync — a crash mid-delete leaves a recoverable trash
                // entry instead of a half-destroyed panel directory
                const trashPath = path.join(
                    panelsDir,
                    `${manifest.id}.trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                );
                fs.renameSync(linkPath, trashPath);
                fs.rmSync(trashPath, { recursive: true, force: true });
            } else {
                throw new Error(`Destination ${linkPath} already exists. Use --force to replace it.`);
            }
        }
    }

    fs.symlinkSync(sourcePath, linkPath, "dir");

    return {
        id: manifest.id,
        name: manifest.name || manifest.id,
        sourcePath,
        linkPath,
    };
}

// removes a symlinked panel
export function unlinkPanel(panelId: string): boolean {
    const panelsDir = getPanelsDir();
    const linkPath = path.join(panelsDir, panelId);
    if (!fs.existsSync(linkPath)) return false;

    const lstat = fs.lstatSync(linkPath);
    if (lstat.isSymbolicLink()) {
        fs.unlinkSync(linkPath);
        return true;
    }
    throw new Error(`${linkPath} is a physical directory, not a dev link.`);
}

// lists active symlinked panels
export function listLinkedPanels(): {
    id: string;
    targetPath: string;
    isBroken: boolean;
}[] {
    const panelsDir = getPanelsDir();
    if (!fs.existsSync(panelsDir)) return [];

    const entries = fs.readdirSync(panelsDir);
    const linked: { id: string; targetPath: string; isBroken: boolean }[] = [];

    for (const entry of entries) {
        const fullPath = path.join(panelsDir, entry);
        try {
            const lstat = fs.lstatSync(fullPath);
            if (lstat.isSymbolicLink()) {
                const target = fs.readlinkSync(fullPath);
                linked.push({
                    id: entry,
                    targetPath: target,
                    isBroken: !fs.existsSync(fullPath),
                });
            }
        } catch (err) { debugErr(`listLinkedPanels ${entry}`, err); }
    }

    return linked;
}
