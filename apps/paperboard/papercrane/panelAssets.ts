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
    if (fs.existsSync(distCandidate)) {
        targetFile = distCandidate;
    } else if (fs.existsSync(resolved)) {
        targetFile = resolved;
    }
    if (targetFile === null) return { kind: "not-found" };
    try {
        if (!fs.statSync(targetFile).isFile()) return { kind: "not-found" };
    } catch {
        // lost race with deletion — read as not-found
        return { kind: "not-found" };
    }
    return { kind: "ok", file: targetFile };
}
