import path from "path";
import fs from "fs";
import { requirePanelId } from "./panelIdentity";
import { debugErr } from "./debug";
import { panelsDir as getPanelsDir } from "./cli/paths";
import { daemonAnswers } from "./cli/daemon";

export interface LinkOptions {
    targetDir?: string;
    force?: boolean;
}

export interface LinkResult {
    id: string;
    name: string;
    sourcePath: string;
    linkPath: string;
    /** whether the manifest declares a background service */
    hasService: boolean;
}

// the panel folder to link, its manifest, and where its link goes
function linkTarget(options: LinkOptions): { sourcePath: string; manifest: any; linkPath: string } {
    const sourcePath = path.resolve(options.targetDir || process.cwd());
    const manifestPath = path.join(sourcePath, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`No manifest.json found at ${sourcePath}. Cannot link non-panel directory.`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    requirePanelId(manifest.id);
    return { sourcePath, manifest, linkPath: path.join(getPanelsDir(), manifest.id) };
}

// links a local panel folder into the data folder's panels/ for live dev
export function linkPanel(options: LinkOptions = {}): LinkResult {
    const { sourcePath, manifest, linkPath } = linkTarget(options);
    const panelsDir = path.dirname(linkPath);

    if (!fs.existsSync(panelsDir)) {
        fs.mkdirSync(panelsDir, { recursive: true });
    }

    // lstat, not exists: a link whose folder moved away is still in the way
    const lstat = lstatOrNull(linkPath);
    if (lstat) {
        if (lstat.isSymbolicLink()) {
            fs.unlinkSync(linkPath);
        } else if (lstat.isDirectory()) {
            if (options.force) {
                // --force replaces the installed panel with the dev link;
                // no copy of the replaced directory is retained
                fs.rmSync(linkPath, { recursive: true, force: true });
            } else {
                throw new Error(`An installed copy of ${manifest.id} already exists at ${linkPath}. Use --force to replace it with this folder.`);
            }
        } else {
            throw new Error(`${linkPath} is a file, not a panel; remove it first`);
        }
    }

    fs.symlinkSync(sourcePath, linkPath, "dir");

    return {
        id: manifest.id,
        name: manifest.name || manifest.id,
        sourcePath,
        linkPath,
        hasService: typeof manifest.service === "string" && manifest.service.length > 0,
    };
}

/**
 * linkPanel, refusing to replace an installed panel's folder while
 * Paperboard runs on this data folder: the daemon serves the panel's pages
 * and runs its service from that folder, and it has no call that stops one
 * panel's service, so the folder is only replaced once Paperboard is quit.
 */
export async function linkPanelWhenStopped(options: LinkOptions = {}): Promise<LinkResult> {
    if (options.force) {
        const { manifest, linkPath } = linkTarget(options);
        if (lstatOrNull(linkPath)?.isDirectory() && await daemonAnswers()) {
            throw new Error(`Paperboard is running ${manifest.id} from ${linkPath}, so its installed copy can't be replaced now. Quit Paperboard, then run paperapi link --force again.`);
        }
    }
    return linkPanel(options);
}

function lstatOrNull(target: string): fs.Stats | null {
    try {
        return fs.lstatSync(target);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
    }
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
    const lstat = lstatOrNull(linkPath);
    if (!lstat) return false;
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
