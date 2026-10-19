// Which first-open tutorials this machine has already shown: Paperboard's
// own, and each panel's by panel id. One shell document on the local
// computer: a tutorial is about the panel, so seeing it on one computer
// counts for every computer.

import { config, isPanelId } from "@mileniumhq/paperapi";

export const PANEL_TUTORIALS_ID = "shell-panel-tutorials";
export const PANEL_TUTORIALS_COMPUTER = "local";
export const PANEL_TUTORIALS_VERSION = 1;
/** The most panels remembered; the oldest are forgotten and would show their tutorial again. */
export const MAX_SEEN_TUTORIALS = 256;

export interface PanelTutorialsDoc {
    version: typeof PANEL_TUTORIALS_VERSION;
    /** panel ids, oldest first */
    seen: string[];
    /** Paperboard's own tutorial, shown the first time the app opens */
    app?: boolean;
}

export interface SeenTutorials {
    panels: string[];
    app: boolean;
}

/**
 * Reads the stored document. null (never saved) is nothing seen; anything
 * else that doesn't parse throws, so a damaged document is reported instead
 * of being treated as empty and every tutorial shown again.
 */
export function parsePanelTutorials(raw: unknown): SeenTutorials {
    if (raw === null || raw === undefined) return { panels: [], app: false };
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Panel tutorial record is not an object");
    const doc = raw as Record<string, unknown>;
    if (doc.version !== PANEL_TUTORIALS_VERSION) {
        throw new Error(`Panel tutorial record version ${String(doc.version)} is not one this Paperboard reads`);
    }
    if (!Array.isArray(doc.seen) || !doc.seen.every(isPanelId)) {
        throw new Error("Panel tutorial record lists something that is not a panel id");
    }
    if (doc.app !== undefined && typeof doc.app !== "boolean") {
        throw new Error("Panel tutorial record's app flag is not true or false");
    }
    return { panels: doc.seen.slice(-MAX_SEEN_TUTORIALS), app: doc.app === true };
}

/** `seen` with `panelId` added as the newest, bounded to MAX_SEEN_TUTORIALS. */
export function withSeenTutorial(seen: string[], panelId: string): string[] {
    return [...seen.filter((id) => id !== panelId), panelId].slice(-MAX_SEEN_TUTORIALS);
}

/** `seen` with one more tutorial recorded: a panel's by id, or Paperboard's own with "app". */
export function withSeen(seen: SeenTutorials, which: { panelId: string } | "app"): SeenTutorials {
    return which === "app"
        ? { ...seen, app: true }
        : { ...seen, panels: withSeenTutorial(seen.panels, which.panelId) };
}

export async function loadSeenTutorials(): Promise<SeenTutorials> {
    return parsePanelTutorials(await config.get(PANEL_TUTORIALS_ID, undefined, PANEL_TUTORIALS_COMPUTER));
}

/**
 * Records a tutorial as shown. Re-reads before writing so a second window's
 * record isn't overwritten by this one's stale copy; a read failure refuses
 * the write rather than replacing an unreadable record.
 */
export async function markTutorialSeen(which: { panelId: string } | "app"): Promise<SeenTutorials> {
    const next = withSeen(await loadSeenTutorials(), which);
    const doc: PanelTutorialsDoc = { version: PANEL_TUTORIALS_VERSION, seen: next.panels, ...(next.app ? { app: true } : {}) };
    await config.set(doc, PANEL_TUTORIALS_ID, undefined, PANEL_TUTORIALS_COMPUTER);
    return next;
}
