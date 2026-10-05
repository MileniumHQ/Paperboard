// Title-bar insets for the frameless shell window: how far the top bar's
// right-hand buttons must stay from the OS caption buttons, and where the
// left-hand label starts past macOS traffic lights.
//
// navigator.windowControlsOverlay exists in every Chromium window, but its
// geometry only means something while the overlay is visible. With it
// hidden (macOS hiddenInset: titleBarOverlay is false there) the rect is
// all zeros, and "window width minus the title-bar area" became the whole
// window width — pushing the folder button off-screen.

export interface OverlayLike {
    visible?: boolean;
    getTitlebarAreaRect?: () => { x: number; width: number };
}

// fallback width of Windows caption buttons when no overlay geometry exists
export const WINDOWS_CAPTION_FALLBACK = 140;
// macOS traffic lights (hiddenInset) plus breathing room
export const MAC_TRAFFIC_LIGHT_RESERVE = 84;
export const DEFAULT_LEFT_RESERVE = 12;

function visibleRect(wco: OverlayLike | undefined) {
    if (!wco?.visible || typeof wco.getTitlebarAreaRect !== "function") return null;
    const rect = wco.getTitlebarAreaRect();
    if (!rect || !(rect.width > 0)) return null;
    return rect;
}

export function rightReserve(
    wco: OverlayLike | undefined,
    windowWidth: number,
    userAgent: string,
    browserShell = false,
): number {
    // a browser tab has no OS caption buttons: never reserve for them, no
    // matter what platform the client's user agent claims
    if (browserShell) return 0;
    const rect = visibleRect(wco);
    if (rect) return Math.max(0, windowWidth - rect.x - rect.width);
    return userAgent.includes("Windows") ? WINDOWS_CAPTION_FALLBACK : 0;
}

export function leftReserve(
    wco: OverlayLike | undefined,
    userAgent: string,
    browserShell = false,
): number {
    if (browserShell) return DEFAULT_LEFT_RESERVE;
    const rect = visibleRect(wco);
    if (rect && rect.x > 0) return rect.x + DEFAULT_LEFT_RESERVE;
    return userAgent.includes("Mac") ? MAC_TRAFFIC_LIGHT_RESERVE : DEFAULT_LEFT_RESERVE;
}
