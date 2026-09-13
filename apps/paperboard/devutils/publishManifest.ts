// Publish target resolution, extracted from publish.ts so the version-truth
// rule is testable without running the build script's top-level side effects.
// Half-finished panels are 0.x, never a fabricated 1.0.0 (AGENTS.md: version
// numbers tell the truth). pack.ts refuses version-less too — same rule,
// enforced at both exits.
import { basename } from "path";

export interface PublishTarget {
    id: string;
    name: string;
    version: string;
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
