import path from "path";
import fs from "fs";
import os from "os";
import { PANEL_ID_REGEX } from "./pack";

function getPanelsDir(): string {
    const home = typeof os.homedir === "function" ? os.homedir() : "";
    return path.join(home, ".paperboard", "panels");
}

export interface LinkOptions {
    targetDir?: string;
    force?: boolean;
}

// Links a local panel folder into ~/.paperboard/panels for live development
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
                fs.rmSync(linkPath, { recursive: true, force: true });
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

// Removes a symlinked panel from ~/.paperboard/panels
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

// Lists active symlinked panels in ~/.paperboard/panels
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
        } catch {}
    }

    return linked;
}
