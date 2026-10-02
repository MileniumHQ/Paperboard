// Publish target resolution, extracted from publish.ts so the version-truth
// rule is testable without running the build script's top-level side effects.
// Half-finished panels are 0.x, never a fabricated 1.0.0 (AGENTS.md: version
// numbers tell the truth). pack.ts refuses version-less too — same rule,
// enforced at both exits.
//
// Panel discovery lives here too because every consumer (publish panels, USB
// bundle) must read the same root. A wrong root silently bundles zero panels.
import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { requirePanelId } from "../packages/paperapi/src/panelIdentity";

export interface PublishTarget {
    id: string;
    name: string;
    version: string;
}

// The one canonical panel source: <repo>/panels. publishManifest.ts lives in
// scripts/, so its parent is the repo root.
export const PANELS_ROOT = join(import.meta.dir, "..", "panels");

export interface DiscoveredPanel extends PublishTarget {
    dir: string;
}

export function resolvePublishTarget(
    manifest: unknown,
    boardDir: string,
): PublishTarget {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error(
            `Refusing to publish "${basename(boardDir)}": manifest.json is not an object`,
        );
    }
    const record = manifest as Record<string, unknown>;
    const boardId =
        typeof record.id === "string" && record.id ? record.id : basename(boardDir);
    requirePanelId(boardId);
    const boardName =
        typeof record.name === "string" && record.name ? record.name : boardId;
    if (typeof record.version !== "string" || record.version.length === 0) {
        throw new Error(
            `Refusing to publish "${boardName}" (${boardId}): manifest.json has no "version" field. ` +
                `Declare a real version (0.x while unfinished) before publishing.`,
        );
    }
    return { id: boardId, name: boardName, version: record.version };
}

// Every directory under panelsRoot carrying a valid manifest.json, sorted by
// id. A broken manifest is reported to onSkip (and omitted) rather than
// silently dropped, so callers can tell "no panels" apart from "all broken".
export function discoverPanels(
    panelsRoot: string,
    onSkip?: (dirName: string, err: unknown) => void,
): DiscoveredPanel[] {
    const out: DiscoveredPanel[] = [];
    if (!existsSync(panelsRoot)) return out;
    for (const e of readdirSync(panelsRoot, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = join(panelsRoot, e.name);
        const manifestPath = join(dir, "manifest.json");
        if (!existsSync(manifestPath)) continue;
        try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
            out.push({ dir, ...resolvePublishTarget(manifest, dir) });
        } catch (err) {
            if (onSkip) onSkip(e.name, err);
            else throw err;
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}
