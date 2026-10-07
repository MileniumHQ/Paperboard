// The shell side of the panel-library embed contract. The library is
// remote content served by Origami, so every message is validated at this
// boundary: sender window, origin, type, and a panel id that satisfies the
// ONE identity validator (never a copied regex).
import {
    isPanelId,
    type InstalledPanelMedia,
    type PanelItem,
} from "@mileniumhq/paperapi";

export type LibraryToShellMessage =
    | { type: "paperboard:library-hello"; ready: boolean }
    | { type: "paperboard:library-ready" }
    | { type: "paperboard:library-install"; requestId: string; panelId: string }
    | { type: "paperboard:library-open"; panelId: string }
    | {
          type: "paperboard:library-media";
          requestId: string;
          panelId: string;
          full: boolean;
      };

export interface LibraryFrameIdentity {
    /** The exact window contentWindow of the library iframe. */
    sourceWindow: Window | null | undefined;
    /** Origin the iframe document is served from. */
    origin: string;
}

/**
 * Validates a message event against the embedded library frame. `event` is
 * accepted wholesale so callers cannot skip the source/origin checks by
 * passing `event.data` directly.
 */
export function parseLibraryMessage(
    event: { source?: unknown; origin?: unknown; data?: unknown },
    identity: LibraryFrameIdentity,
): LibraryToShellMessage | null {
    if (!identity.sourceWindow || event.source !== identity.sourceWindow) {
        return null;
    }
    if (event.origin !== identity.origin) return null;
    const data = event.data;
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;

    if (message.type === "paperboard:library-hello") {
        // ready === true means this library will follow up with
        // paperboard:library-ready once it has loaded and painted.
        return { type: "paperboard:library-hello", ready: message.ready === true };
    }
    if (message.type === "paperboard:library-ready") {
        return { type: "paperboard:library-ready" };
    }
    if (message.type === "paperboard:library-install") {
        if (typeof message.requestId !== "string" || !message.requestId) {
            return null;
        }
        if (!isPanelId(message.panelId)) return null;
        return {
            type: "paperboard:library-install",
            requestId: message.requestId,
            panelId: message.panelId,
        };
    }
    if (message.type === "paperboard:library-media") {
        if (typeof message.requestId !== "string" || !message.requestId) {
            return null;
        }
        if (!isPanelId(message.panelId)) return null;
        return {
            type: "paperboard:library-media",
            requestId: message.requestId,
            panelId: message.panelId,
            full: message.full === true,
        };
    }
    if (message.type === "paperboard:library-open") {
        if (!isPanelId(message.panelId)) return null;
        return { type: "paperboard:library-open", panelId: message.panelId };
    }
    return null;
}

export interface ShellToLibraryMessages {
    connected: (theme: string, installed: PanelItem[]) => unknown;
    installed: (theme: string, installed: PanelItem[]) => unknown;
    installResult: (input: {
        requestId: string;
        panelId: string;
        ok: boolean;
        error?: string;
    }) => unknown;
    mediaResult: (input: {
        requestId: string;
        panelId: string;
        ok: boolean;
        media?: InstalledPanelMedia;
        error?: string;
    }) => unknown;
}

export const shellToLibrary: ShellToLibraryMessages = {
    connected: (theme, installed) => ({
        type: "paperboard:library-connected",
        theme,
        installed,
    }),
    installed: (theme, installed) => ({
        type: "paperboard:library-installed",
        theme,
        installed,
    }),
    installResult: ({ requestId, panelId, ok, error }) => ({
        type: "paperboard:library-install-result",
        requestId,
        panelId,
        ok,
        error,
    }),
    mediaResult: ({ requestId, panelId, ok, media, error }) => ({
        type: "paperboard:library-media-result",
        requestId,
        panelId,
        ok,
        ...(media ? { icon: media.icon, store: media.store } : {}),
        error,
    }),
};

export type LibraryFramePhase = "failed" | "loading" | "ready";

/**
 * The iframe document URL for a given reload token. The query string makes a
 * bumped token a URL the browser treats as a new document; that is exactly
 * what the sidebar's Reload Library action does, where re-fetching the
 * registry would leave the already-rendered page (and its stale state) alive.
 */
export function libraryFrameSrc(url: string, reloadToken: number): string {
    const base = url.endsWith("/") ? url : `${url}/`;
    return `${base}?r=${reloadToken}`;
}

/**
 * The single gate for what the shell shows over the library frame. The
 * iframe is only revealed once the library has connected, and — when it
 * advertises the painted-before-reveal protocol — reported ready. A legacy
 * library that sends no capability is revealed on connect, so a shell
 * update never leaves an older deployed library stuck behind the loader.
 */
export function libraryFramePhase(state: {
    connected: boolean;
    ready: boolean;
    readyCapable: boolean;
    failure: boolean;
}): LibraryFramePhase {
    if (state.failure) return "failed";
    if (state.connected && (state.ready || !state.readyCapable)) return "ready";
    return "loading";
}
