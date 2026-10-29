// What a panel's document may use beyond the page itself. Panels are
// first-party and trusted, so this isn't a sandbox: any panel may ask, and
// you're asked once per panel before it gets your microphone, camera or
// screen. The answer is kept (local/panel-permissions.json) and can be
// changed in App Settings. Grants never reach the shell, a sign-in page or
// anything else that isn't a panel.
//
// The clipboard isn't a permission: every panel has it. writeText may check
// "clipboard-write" or "clipboard-sanitized-write" depending on the
// Chromium release; readText checks "clipboard-read".

import * as fs from "fs";
import { logger } from "../../papercrane/logger";
import { writeJsonAtomicSync } from "../../papercrane/storage";
import { parsePanelHost } from "./panelAssets";

import { PANEL_PERMISSIONS, isPanelPermission, type PanelPermission, type PanelPermissionEntry, type PermissionAnswer } from "../shared/panelPermissions";

export { isPanelPermission };
export type { PanelPermission, PermissionAnswer };

/** who asked: the panel a panel:// frame belongs to */
export interface PanelAsker {
    computerId: string;
    panelId: string;
}

const CLIPBOARD = new Set(["clipboard-read", "clipboard-sanitized-write", "clipboard-write"]);

export const isPanelOrigin = (origin: string) => origin.startsWith("panel://");

export const isClipboardPermission = (permission: string) => CLIPBOARD.has(permission);

/** The panel behind a panel:// origin or URL; null for anything else. */
export function panelAsker(originOrUrl: string): PanelAsker | null {
    if (!isPanelOrigin(originOrUrl)) return null;
    let host: string;
    try {
        host = new URL(originOrUrl).hostname;
    } catch (err) {
        logger.debug("[panelPermissions] unparseable panel URL, not a panel:", originOrUrl, err);
        return null;
    }
    const parsed = parsePanelHost(host);
    return parsed ? { computerId: parsed.comp, panelId: parsed.panelId } : null;
}

/**
 * What a getUserMedia request needs. Chromium asks for "media" with the
 * kinds it wants: audio is the microphone, video the camera. Null when the
 * request isn't one for media devices at all.
 */
export function mediaPermissions(permission: string, mediaTypes: readonly string[] | undefined): PanelPermission[] | null {
    if (permission !== "media" || !mediaTypes || mediaTypes.length === 0) return null;
    const wanted = new Set<PanelPermission>();
    for (const t of mediaTypes) {
        if (t === "audio") wanted.add("microphone");
        else if (t === "video") wanted.add("camera");
        else return null;
    }
    return [...wanted];
}

/** getDisplayMedia's request: "media" with no media types (Electron 44), or "display-capture". */
export function isScreenRequest(permission: string, mediaTypes: readonly string[] | undefined): boolean {
    return permission === "display-capture" || (permission === "media" && mediaTypes !== undefined && mediaTypes.length === 0);
}

/** A permission check (navigator.permissions, device labels) names one kind. */
export function checkedPermission(permission: string, mediaType: string | undefined): PanelPermission | null {
    if (permission !== "media") return null;
    if (mediaType === "audio") return "microphone";
    if (mediaType === "video") return "camera";
    return null;
}

type Saved = Record<string, Partial<Record<PanelPermission, PermissionAnswer>>>;

/**
 * Your answers, per panel. A missing file is a fresh install; a file that
 * can't be read or parsed is an error, not "nothing allowed", so it throws
 * and the caller says so.
 */
export class PanelPermissionStore {
    private saved: Saved | null = null;
    private pending = new Map<string, Promise<boolean>>();
    private listeners = new Set<() => void>();

    constructor(private file: string) {}

    private load(): Saved {
        if (this.saved) return this.saved;
        let raw: string;
        try {
            raw = fs.readFileSync(this.file, "utf8");
        } catch (err: any) {
            if (err?.code === "ENOENT") return (this.saved = {});
            throw new Error(`Panel permissions couldn't be read from ${this.file}: ${err?.message ?? err}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (err: any) {
            throw new Error(`Panel permissions in ${this.file} aren't valid JSON: ${err?.message ?? err}`);
        }
        const panels = (parsed as { panels?: unknown })?.panels;
        if (!panels || typeof panels !== "object" || Array.isArray(panels)) {
            throw new Error(`Panel permissions in ${this.file} have no "panels" object`);
        }
        const saved: Saved = {};
        for (const [panelId, answers] of Object.entries(panels as Record<string, unknown>)) {
            if (!answers || typeof answers !== "object") continue;
            for (const [permission, answer] of Object.entries(answers as Record<string, unknown>)) {
                if (isPanelPermission(permission) && (answer === "allowed" || answer === "denied")) {
                    (saved[panelId] ??= {})[permission] = answer;
                }
            }
        }
        return (this.saved = saved);
    }

    get(panelId: string, permission: PanelPermission): PermissionAnswer | undefined {
        return this.load()[panelId]?.[permission];
    }

    set(panelId: string, permission: PanelPermission, answer: PermissionAnswer): void {
        const saved = this.load();
        const next: Saved = { ...saved, [panelId]: { ...saved[panelId], [permission]: answer } };
        writeJsonAtomicSync(this.file, { version: 1, panels: next });
        this.saved = next;
        for (const cb of this.listeners) cb();
    }

    list(): PanelPermissionEntry[] {
        const out: PanelPermissionEntry[] = [];
        for (const [panelId, answers] of Object.entries(this.load())) {
            for (const permission of PANEL_PERMISSIONS) {
                const answer = answers[permission];
                if (answer) out.push({ panelId, permission, answer });
            }
        }
        return out;
    }

    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /**
     * Whether `panelId` may use all of `permissions`. Anything you said no to
     * refuses at once; anything you haven't answered is asked about (one
     * question for the lot), and the answer is kept; a question closed
     * without an answer refuses this once and asks again next time. Asks for
     * the same thing at the same time share one question.
     */
    async decide(panelId: string, permissions: PanelPermission[], ask: (unanswered: PanelPermission[]) => Promise<PermissionAnswer | null>): Promise<boolean> {
        if (permissions.some((p) => this.get(panelId, p) === "denied")) return false;
        const unanswered = permissions.filter((p) => this.get(panelId, p) === undefined);
        if (unanswered.length === 0) return true;
        const key = `${panelId}\n${[...unanswered].sort().join(",")}`;
        let asking = this.pending.get(key);
        if (!asking) {
            asking = (async () => {
                try {
                    const answer = await ask(unanswered);
                    if (answer === null) return false;
                    for (const p of unanswered) this.set(panelId, p, answer);
                    return answer === "allowed";
                } finally {
                    this.pending.delete(key);
                }
            })();
            this.pending.set(key, asking);
        }
        return asking;
    }
}
