// The Electron side of panel permissions (panelPermissions.ts): Chromium's
// requests are answered from your saved answers, and anything unanswered is
// asked in the window the panel is in. Screen sharing also picks what to
// share there, unless the system already did (the Wayland portal).
//
// The operating system has its own say on macOS and Windows: when it blocks
// Paperboard, the window says so and opens the right system settings.
import { desktopCapturer, shell, systemPreferences, webContents as allWebContents, type Session, type WebContents } from "electron";
import { randomUUID } from "crypto";
import * as path from "path";
import { logger } from "../../papercrane/logger";
import { getLocalDir } from "../../papercrane/paths";
import { pushToShells } from "./communication/shellPush";
import {
    PanelPermissionStore,
    checkedPermission,
    isClipboardPermission,
    isPanelOrigin,
    isPanelPermission,
    isScreenRequest,
    mediaPermissions,
    panelAsker,
    type PanelAsker,
    type PanelPermission,
    type PermissionAnswer,
} from "./panelPermissions";
import type { ScreenSource, SystemBlock } from "../shared/panelPermissions";

const SYSTEM_SETTINGS: Record<"darwin" | "win32", Partial<Record<PanelPermission, string>>> = {
    darwin: {
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
        screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    },
    win32: {
        microphone: "ms-settings:privacy-microphone",
        camera: "ms-settings:privacy-webcam",
    },
};

let store: PanelPermissionStore | null = null;

/** Your answers, kept in local/panel-permissions.json; open shells hear when they change. */
export function panelPermissionStore(): PanelPermissionStore {
    if (store) return store;
    store = new PanelPermissionStore(path.join(getLocalDir(), "panel-permissions.json"));
    store.onChange(() => pushToShells("panel-permissions-changed", null));
    return store;
}

const pending = new Map<string, { wc: WebContents; settle: (value: unknown) => void }>();

/** Ask the shell in `wc`; null when the window goes away before it answers. */
function askShell(wc: WebContents | null, channel: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!wc || wc.isDestroyed()) return Promise.reject(new Error("there's no window to ask in"));
    const askId = randomUUID();
    return new Promise((resolve) => {
        const gone = () => settle(null);
        const settle = (value: unknown) => {
            if (!pending.delete(askId)) return;
            wc.off("destroyed", gone);
            wc.off("render-process-gone", gone);
            resolve(value);
        };
        pending.set(askId, { wc, settle });
        wc.once("destroyed", gone);
        wc.once("render-process-gone", gone);
        wc.send(channel, { askId, ...payload });
    });
}

/** The shell's answer to an ask; only the window that was asked may answer it. */
export function answerPanelPermissionAsk(sender: WebContents, args: unknown): void {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const ask = typeof a.askId === "string" ? pending.get(a.askId) : undefined;
    if (!ask) throw new Error("That question was already answered, or never asked");
    if (ask.wc !== sender) throw new Error("Only the window that was asked can answer");
    ask.settle(a.answer ?? null);
}

export function openSystemPrivacySettings(permission: unknown): Promise<void> {
    if (!isPanelPermission(permission)) throw new Error(`Not a panel permission: ${String(permission)}`);
    if (process.platform !== "darwin" && process.platform !== "win32") throw new Error("This system has no privacy settings for Paperboard");
    const url = SYSTEM_SETTINGS[process.platform][permission];
    if (!url) throw new Error(`This system has no ${permission} privacy setting`);
    return shell.openExternal(url);
}

/** Whether the operating system lets Paperboard itself use `permission`; macOS asks the first time. */
async function systemAllows(permission: PanelPermission): Promise<boolean> {
    if (process.platform !== "darwin" && process.platform !== "win32") return true;
    const status = systemPreferences.getMediaAccessStatus(permission);
    if (status === "granted" || status === "unknown") return true;
    if (status === "not-determined") {
        // macOS asks about the screen itself on the first capture
        if (permission === "screen" || process.platform !== "darwin") return true;
        return systemPreferences.askForMediaAccess(permission);
    }
    return false;
}

function askAnswer(value: unknown): PermissionAnswer | null {
    return value === "allowed" || value === "denied" ? value : null;
}

export function installPanelPermissions(ses: Session, store: PanelPermissionStore): void {
    const askPanel = (wc: WebContents | null, asker: PanelAsker, permissions: PanelPermission[]) =>
        store.decide(asker.panelId, permissions, async (unanswered) =>
            askAnswer(await askShell(wc, "panel-permission-ask", { ...asker, permissions: unanswered })),
        );

    /** your answer, then the system's; a system block is shown, not swallowed */
    const allowed = async (wc: WebContents | null, asker: PanelAsker, permissions: PanelPermission[]) => {
        if (!(await askPanel(wc, asker, permissions))) return false;
        for (const permission of permissions) {
            if (await systemAllows(permission)) continue;
            if (wc && !wc.isDestroyed() && (process.platform === "darwin" || process.platform === "win32")) {
                const block: SystemBlock = { ...asker, permission, platform: process.platform };
                wc.send("panel-permission-system", block);
            }
            return false;
        }
        return true;
    };

    const refuse = (what: string) => (err: unknown): false => {
        logger.warn(`[Main] panel ${what} refused:`, err instanceof Error ? err.message : err);
        return false;
    };

    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
        // the requesting frame's URL, not the top frame's: wc.getURL() is the
        // shell for panel iframes. Read as a URL, never through URL.origin:
        // Node doesn't know the panel scheme and calls every origin "null".
        const origin = details?.requestingUrl || "";
        if (isClipboardPermission(permission)) return callback(isPanelOrigin(origin));
        const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
        // getDisplayMedia arrives as "media" with no media types: it's let
        // through to setDisplayMediaRequestHandler below, which asks about
        // the screen and what to share
        if (isScreenRequest(permission, mediaTypes)) return callback(isPanelOrigin(origin));
        const asker = panelAsker(origin);
        const wanted = mediaPermissions(permission, mediaTypes);
        if (!asker || !wanted) return callback(false);
        void allowed(wc, asker, wanted).catch(refuse(`${wanted.join(" and ")} for ${asker.panelId}`)).then(callback);
    });

    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
        if (isClipboardPermission(permission)) return isPanelOrigin(requestingOrigin);
        const asker = panelAsker(requestingOrigin);
        const checked = checkedPermission(permission, details?.mediaType);
        if (!asker || !checked) return false;
        try {
            return store.get(asker.panelId, checked) === "allowed";
        } catch (err) {
            return refuse(`${checked} check for ${asker.panelId}`)(err);
        }
    });

    ses.setDisplayMediaRequestHandler((request, callback) => {
        const frame = request.frame;
        const asker = panelAsker(request.securityOrigin || frame?.url || "");
        // a refusal is a callback with nothing to share
        const nothing = () => callback({});
        if (!asker || !frame || !request.videoRequested) return nothing();
        const wc = allWebContents.fromFrame(frame) ?? null;
        void (async () => {
            if (!(await allowed(wc, asker, ["screen"]))) return null;
            const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
            if (sources.length === 0) return null;
            // one source: the system's picker (Wayland's portal) already chose it
            if (sources.length === 1) return sources[0]!;
            const offered: ScreenSource[] = sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
            const chosen = await askShell(wc, "panel-screen-pick", { ...asker, sources: offered });
            return sources.find((s) => s.id === chosen) ?? null;
        })()
            .catch(refuse(`screen for ${asker.panelId}`))
            .then((source) => (source ? callback({ video: source }) : nothing()));
    });
}
