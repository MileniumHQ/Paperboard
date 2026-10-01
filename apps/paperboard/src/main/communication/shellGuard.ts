// Shell/panel IPC origin boundary (T1).
//
// Panels render as <iframe> elements inside the shell window and inherit the
// window's preload, so the preload channel allowlist alone cannot keep
// privileged channels shell-only. Every shell channel handler validates
// `event.senderFrame.url`: shell origins (paperboard://shell, dev http://localhost)
// are answered; panel origins (`panel://<computer>.<panel>/...`) get a
// typed refusal — never an answer, never empty silence.
//
// senderFrame is Electron-provided and unspoofable from the renderer; panel
// iframes always carry panel:// URLs. An URL that CANNOT be read (missing
// frame or url) is denied the same as a panel frame: the guard refuses
// by default. The old fail-open default ("missing frame = shell") inverted
// the polarity of every privileged channel — it is refused now.
export function isPanelOrigin(url: unknown): boolean {
    return (
        typeof url === "string" &&
        (url === "panel://" || url.startsWith("panel://"))
    );
}

export function isRefusedFrame(event: unknown): boolean {
    const url = (event as { senderFrame?: { url?: unknown } } | null | undefined)
        ?.senderFrame?.url;
    // deny-by-default: panel origins are refused, and an unreadable origin
    // (no frame / no url) is refused too — only a verdict of "shell" allows
    return url === undefined || url === null || isPanelOrigin(url);
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
