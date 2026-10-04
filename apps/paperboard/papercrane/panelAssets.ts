// Panel asset resolution (daemon-owned, Electron-free): containment is
// decided here so both the local panel:// protocol handler and the
// daemon /panel/ HTTP route serve from ONE implementation — mirrors
// drift, extracts don't. Dist builds win over loose files, containment
// is enforced before touching disk, lost races read as not-found.
import * as fs from "fs";
import * as path from "path";
import { sanitizeId } from "./storage";

export type PanelAssetResolution =
    | { kind: "invalid" }
    | { kind: "not-found" }
    | { kind: "forbidden" }
    | { kind: "ok"; file: string };

// shared traversal vectors: every panel-asset surface (local panel://
// protocol, daemon /panel/ route) proves THESE subpaths stay inside the
// panel dir. Tests interpolate their own fixture names around them.
export const PANEL_TRAVERSAL_VECTORS = [
    "../../SENTINEL",
    "dist/../../SENTINEL",
    "..",
] as const;

export function resolveLocalPanelFile(
    panelsDir: string,
    panelId: string,
    subpath: string,
): PanelAssetResolution {
    const cleanPanelId = sanitizeId(panelId);
    if (!cleanPanelId) return { kind: "invalid" };
    const panelDir = path.join(panelsDir, cleanPanelId);
    if (!fs.existsSync(panelDir)) return { kind: "not-found" };

    // containment check before touching disk
    const normalized = path.normalize(subpath.replace(/^[/\\]+/, ""));
    const resolved = path.resolve(panelDir, normalized);
    const prefix = panelDir.endsWith(path.sep) ? panelDir : panelDir + path.sep;
    if (resolved !== panelDir && !resolved.startsWith(prefix)) {
        return { kind: "forbidden" };
    }

    // dist build wins over loose files
    const distCandidate = path.join(panelDir, "dist", normalized);
    let targetFile: string | null = null;
    let intendedSubpath = normalized;
    if (fs.existsSync(distCandidate)) {
        targetFile = distCandidate;
        intendedSubpath = path.join("dist", normalized);
    } else if (fs.existsSync(resolved)) {
        targetFile = resolved;
    }
    if (targetFile === null) return { kind: "not-found" };
    try {
        // The panel directory itself may be a symlink: a dev-linked panel
        // is installed exactly that way (`isDevLink`), and the engine lists
        // it on purpose. Nothing BELOW the panel root may be a link though —
        // a planted `dist/` or a leaf symlink would map the literal path
        // outside the panel and turn the asset route into an arbitrary read.
        // Canonicalize the root once, then require the target's real path to
        // be exactly the intended file under it.
        const realRoot = fs.realpathSync(panelDir);
        const intended = path.resolve(realRoot, intendedSubpath);
        const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
        if (intended !== realRoot && !intended.startsWith(rootPrefix)) {
            return { kind: "forbidden" };
        }
        if (fs.realpathSync(targetFile) !== intended) return { kind: "forbidden" };
        if (!fs.statSync(targetFile).isFile()) return { kind: "not-found" };
    } catch {
        // lost race with deletion — read as not-found
        return { kind: "not-found" };
    }
    return { kind: "ok", file: targetFile };
}
