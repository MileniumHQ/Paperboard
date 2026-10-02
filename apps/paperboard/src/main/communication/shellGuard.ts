// Shell IPC origin boundary.
//
// Shell channels answer only the shell document: paperboard://shell (the
// packaged shell's scheme) and, in development only, the renderer dev
// server origin main registers at startup. Every other sender is refused:
// panel:// frames, remote pages, file:// documents, and any frame whose URL
// cannot be read. senderFrame is Electron-provided and unspoofable from the
// renderer.
//
// This is an allowlist on purpose. The old guard refused only panel://, so
// anything else that reached the preload (a top-level navigation to remote
// content, a dropped file) was answered as the shell — including
// crane-credentials, which returns the master token.
import { SHELL_ORIGIN } from "../shellAssets";
import { logger } from "../../../papercrane/logger";

let devShellOrigin: string | null = null;

// main calls this in development with ELECTRON_RENDERER_URL; production
// never registers one
export function allowDevShellOrigin(url: string): void {
    devShellOrigin = new URL(url).origin;
}

export function isPanelOrigin(url: unknown): boolean {
    return (
        typeof url === "string" &&
        (url === "panel://" || url.startsWith("panel://"))
    );
}

export function isShellUrl(url: unknown): boolean {
    if (typeof url !== "string") return false;
    if (url === SHELL_ORIGIN || url.startsWith(`${SHELL_ORIGIN}/`)) return true;
    if (!devShellOrigin) return false;
    try {
        return new URL(url).origin === devShellOrigin;
    } catch (err) {
        // an unparseable sender URL is not the shell
        logger.debug("[Shell] sender URL unparseable, refusing:", err);
        return false;
    }
}

export function isRefusedFrame(event: unknown): boolean {
    const url = (event as { senderFrame?: { url?: unknown } } | null | undefined)
        ?.senderFrame?.url;
    return !isShellUrl(url);
}

// will-navigate guard for shell windows: the shell document never navigates
// away from the shell, because whatever it navigated to would inherit the
// preload and with it every shell channel
export function keepShellNavigation(event: { preventDefault(): void }, url: string): boolean {
    if (isShellUrl(url)) return true;
    event.preventDefault();
    return false;
}

export const PANEL_IPC_REFUSED = "PANEL_IPC_REFUSED";

// invoke/handle path: throws a typed refusal the renderer receives as a
// rejected promise for panel origins AND unreadable origins
export function assertShellFrame(event: unknown, channel: string): void {
    if (isRefusedFrame(event)) {
        throw new Error(
            `${PANEL_IPC_REFUSED}: channel "${channel}" is shell-only (panel origins get an empty allowlist)`,
        );
    }
}
