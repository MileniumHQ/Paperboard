// The embed contract. The library is a plain web page: when it happens to
// run inside Paperboard's iframe, the shell announces itself over
// postMessage and the install action becomes a signal round-trip. A direct
// browser load never completes the handshake and stays standalone, where
// install is a plain archive download.
//
// The sensitive direction is the shell's: Paperboard accepts install
// requests only from its own frame (see the renderer's libraryFrame). This
// side holds no authority, so it only validates what it renders.
import { createSignal } from "solid-js";
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";
import type { PanelItem } from "../../../../packages/paperapi/src/panelMerge";
import {
    isDataImage,
    parseStoreListing,
    type InstalledPanelMedia,
} from "../../../../packages/paperapi/src/storeListing";

export type LibraryMode = "detecting" | "embedded" | "standalone";
export type LibraryTheme = "light" | "dark" | "system";

/** Transport to the embedding shell; null means "no shell on this page". */
export interface BridgeHost {
    send(data: unknown): void;
    listen(callback: (data: unknown) => void): () => void;
}

export interface InstallResult {
    ok: boolean;
    error?: string;
}

export interface LibraryBridge {
    mode: () => LibraryMode;
    installed: () => PanelItem[];
    theme: () => LibraryTheme;
    /** Resolves with the shell's answer; never rejects. */
    install: (panelId: string) => Promise<InstallResult>;
    /** Ask the shell to open an installed panel. */
    open: (panelId: string) => void;
    /**
     * Tell the shell the library has loaded its data and painted, so it can
     * stop covering the frame with a loader. No-op when standalone.
     */
    notifyReady: () => void;
    /**
     * Ask the shell for an installed panel's own icon (and listing when
     * `full`). Resolves null when unavailable; never rejects.
     */
    media: (panelId: string, full: boolean) => Promise<InstalledPanelMedia | null>;
    dispose: () => void;
}

export interface LibraryBridgeOptions {
    handshakeTimeoutMs?: number;
    installTimeoutMs?: number;
}

// A direct browser load must not look like a broken Paperboard forever;
// the same timeout also keeps a dead shell from locking the button.
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000;
// Installs can be slow downloads, but a never-answering shell must not leave
// the button pending for the life of the page.
const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60_000;
// Reading a few local files; a silent shell must not hold a request forever.
const MEDIA_TIMEOUT_MS = 15_000;

interface PendingInstall {
    resolve: (result: InstallResult) => void;
    timer: ReturnType<typeof setTimeout>;
}

function parseInstalled(value: unknown): PanelItem[] | null {
    if (!Array.isArray(value)) return null;
    const items: PanelItem[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        if (!isPanelId(record.id)) continue;
        if (typeof record.name !== "string" || !record.name) continue;
        items.push(entry as PanelItem);
    }
    return items;
}

function parseTheme(value: unknown): LibraryTheme {
    return value === "light" || value === "dark" ? value : "system";
}

// request ids only correlate an answer within one page session
let requestSeq = 0;
function nextRequestId(): string {
    requestSeq += 1;
    return `install-${Date.now()}-${requestSeq}`;
}

export function createLibraryBridge(
    host: BridgeHost | null,
    options: LibraryBridgeOptions = {},
): LibraryBridge {
    const handshakeTimeoutMs =
        options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    const installTimeoutMs =
        options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;

    const [mode, setMode] = createSignal<LibraryMode>(
        host ? "detecting" : "standalone",
    );
    const [installed, setInstalled] = createSignal<PanelItem[]>([]);
    const [theme, setTheme] = createSignal<LibraryTheme>("system");
    const pending = new Map<string, PendingInstall>();
    const pendingMedia = new Map<
        string,
        { resolve: (media: InstalledPanelMedia | null) => void; timer: ReturnType<typeof setTimeout> }
    >();
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

    const clearHandshake = () => {
        if (handshakeTimer !== undefined) {
            clearTimeout(handshakeTimer);
            handshakeTimer = undefined;
        }
    };

    const handleShellMessage = (data: unknown) => {
        if (!data || typeof data !== "object") return;
        const message = data as Record<string, unknown>;
        if (message.type === "paperboard:library-connected") {
            // a late handshake still wins: being embedded is a fact, the
            // timeout only covered "no answer arrived yet"
            clearHandshake();
            const list = parseInstalled(message.installed);
            if (list) setInstalled(list);
            setTheme(parseTheme(message.theme));
            setMode("embedded");
            return;
        }
        if (message.type === "paperboard:library-installed") {
            const list = parseInstalled(message.installed);
            if (list) setInstalled(list);
            if (message.theme !== undefined) setTheme(parseTheme(message.theme));
            return;
        }
        if (message.type === "paperboard:library-media-result") {
            if (typeof message.requestId !== "string") return;
            const entry = pendingMedia.get(message.requestId);
            if (!entry) return;
            pendingMedia.delete(message.requestId);
            clearTimeout(entry.timer);
            if (message.ok !== true) {
                console.warn("[library] panel media unavailable:", message.error);
                entry.resolve(null);
                return;
            }
            // the shell is trusted to answer, not to be well-formed: the
            // same listing parser as registry records, data images allowed
            const media: InstalledPanelMedia = {};
            if (isDataImage(message.icon)) media.icon = message.icon;
            const store = parseStoreListing(message.store, { allowDataImages: true });
            if (store) media.store = store;
            entry.resolve(media);
            return;
        }
        if (message.type === "paperboard:library-install-result") {
            if (typeof message.requestId !== "string") return;
            const entry = pending.get(message.requestId);
            if (!entry) return;
            pending.delete(message.requestId);
            clearTimeout(entry.timer);
            entry.resolve({
                ok: message.ok === true,
                error:
                    typeof message.error === "string" && message.error
                        ? message.error
                        : undefined,
            });
        }
    };

    const unsubscribe = host ? host.listen(handleShellMessage) : () => {};

    if (host) {
        // `ready: true` advertises the painted-before-reveal protocol; a
        // shell that sees it holds its loader until notifyReady(). Older
        // library builds omit it and the shell reveals on connect instead.
        host.send({ type: "paperboard:library-hello", ready: true });
        handshakeTimer = setTimeout(() => {
            handshakeTimer = undefined;
            if (mode() === "detecting") setMode("standalone");
        }, handshakeTimeoutMs);
    }

    const install = (panelId: string): Promise<InstallResult> => {
        if (!host || mode() !== "embedded") {
            return Promise.resolve({
                ok: false,
                error: "Paperboard is not connected",
            });
        }
        if (!isPanelId(panelId)) {
            return Promise.resolve({ ok: false, error: "Invalid panel id" });
        }
        const requestId = nextRequestId();
        return new Promise<InstallResult>((resolve) => {
            const timer = setTimeout(() => {
                pending.delete(requestId);
                resolve({
                    ok: false,
                    error: "Paperboard did not answer the install request",
                });
            }, installTimeoutMs);
            pending.set(requestId, { resolve, timer });
            host.send({
                type: "paperboard:library-install",
                requestId,
                panelId,
            });
        });
    };

    const open = (panelId: string) => {
        if (!host || mode() !== "embedded" || !isPanelId(panelId)) return;
        host.send({ type: "paperboard:library-open", panelId });
    };

    const notifyReady = () => {
        if (!host || mode() === "standalone") return;
        host.send({ type: "paperboard:library-ready" });
    };

    const media = (panelId: string, full: boolean): Promise<InstalledPanelMedia | null> => {
        if (!host || mode() !== "embedded" || !isPanelId(panelId)) {
            return Promise.resolve(null);
        }
        const requestId = nextRequestId();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingMedia.delete(requestId);
                resolve(null);
            }, MEDIA_TIMEOUT_MS);
            pendingMedia.set(requestId, { resolve, timer });
            host.send({ type: "paperboard:library-media", requestId, panelId, full });
        });
    };

    const dispose = () => {
        clearHandshake();
        unsubscribe();
        // a promise left pending forever is a leak; answer it with the
        // reason the caller can never get an answer now
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.resolve({ ok: false, error: "The panel library was unloaded" });
        }
        pending.clear();
        for (const entry of pendingMedia.values()) {
            clearTimeout(entry.timer);
            entry.resolve(null);
        }
        pendingMedia.clear();
    };

    return { mode, installed, theme, install, open, notifyReady, media, dispose };
}
