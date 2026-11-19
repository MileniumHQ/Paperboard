// Publish target resolution, kept apart from the publish flows so the
// version rule is testable without running them. A panel publishes under the
// version its manifest declares (0.x while unfinished), never a fabricated
// 1.0.0; packages/paperapi/src/pack.ts refuses a version-less manifest too.
//
// Panel discovery lives here too; the root it reads is PANELS_ROOT in
// panelsRoot.ts.
import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, join, relative } from "path";
import { requirePanelId } from "../../packages/paperapi/src/panelIdentity";

export interface PublishTarget {
    id: string;
    name: string;
    version: string;
}

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

// A panel's built files must reach each other by relative address. The app
// serves a panel at panel://<computer>.<panel>/ but a browser serves it from
// /_panel/<computer>/<panel>/ on the shell's origin, where "/assets/x.js"
// names the shell's file and 404s: the panel never connects. Vite writes
// root-absolute addresses unless the panel's config sets base: "./".
const ROOT_ABSOLUTE_REF = /(?:\b(?:src|href)\s*=\s*["']?|\burl\(\s*["']?)(\/(?!\/)[^"')\s>]*)/gi;

export function rootAbsoluteRefs(text: string): string[] {
    return [...text.matchAll(ROOT_ABSOLUTE_REF)].map((m) => m[1]);
}

export function assertRelativePanelBuild(panelDir: string, panelId: string): void {
    const dist = join(panelDir, "dist");
    if (!existsSync(dist)) return;
    const found: string[] = [];
    for (const entry of readdirSync(dist, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(html?|css)$/i.test(entry.name)) continue;
        const file = join(entry.parentPath, entry.name);
        for (const ref of rootAbsoluteRefs(readFileSync(file, "utf8"))) {
            found.push(`${relative(panelDir, file)}: ${ref}`);
        }
    }
    if (found.length) {
        throw new Error(
            `Refusing to pack ${panelId}: its build links files by root-absolute address, which breaks the panel in a browser. ` +
                `Set base: "./" in its vite.config.ts.\n  ${found.join("\n  ")}`,
        );
    }
}
