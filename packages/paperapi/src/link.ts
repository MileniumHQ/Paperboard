import path from "path";
import fs from "fs";
import os from "os";
import { requirePanelId } from "./panelIdentity";
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
    requirePanelId(manifest.id);

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
                // Keep the previous package for recovery.
                const trashPath = path.join(
                    panelsDir,
                    `.trash-${Date.now()}-${manifest.id}`,
                );
                fs.renameSync(linkPath, trashPath);
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

export interface LinkAllResult {
    linked: { id: string; linkPath: string }[];
    skipped: { dir: string; reason: string }[];
}

// links every panel directory under panelsRoot. A directory without a
// manifest is not a panel and is not a candidate. A candidate that cannot be
// linked (bad id, physical target without --force) is reported in `skipped`,
// never swallowed; the caller decides whether that is fatal.
export function linkAllPanels(
    panelsRoot: string,
    options: { force?: boolean } = {},
): LinkAllResult {
    const linked: LinkAllResult["linked"] = [];
    const skipped: LinkAllResult["skipped"] = [];
    for (const entry of fs.readdirSync(panelsRoot)) {
        const dir = path.join(panelsRoot, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        if (!fs.existsSync(path.join(dir, "manifest.json"))) continue;
        try {
            const res = linkPanel({ targetDir: dir, force: options.force });
            linked.push({ id: res.id, linkPath: res.linkPath });
        } catch (err) {
            skipped.push({
                dir,
                reason: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { linked, skipped };
}

// removes a symlinked panel
export function unlinkPanel(panelId: string): boolean {
    requirePanelId(panelId);
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
