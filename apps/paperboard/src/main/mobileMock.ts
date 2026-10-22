// `--mobile`: a development mock of Paperboard on a phone. The window takes
// an iPhone 16 Pro's viewport (402x874 CSS px) and Chromium emulates a
// mobile device on it: overlay scrollbars, and the mouse sends touch events
// so swipes and taps behave like a finger. The shell switches to its phone
// layout from the same flag (shared/launchOptions.ts).
import type { BrowserWindowConstructorOptions, WebContents } from "electron";

export const IPHONE_16_PRO = { width: 402, height: 874 } as const;

/** window options that replace the desktop frame and size */
export function mobileWindowOptions(): BrowserWindowConstructorOptions {
    return {
        width: IPHONE_16_PRO.width,
        height: IPHONE_16_PRO.height,
        useContentSize: true,
        minWidth: 320,
        minHeight: 480,
        // a plain OS frame: the phone layout has no desktop title bar to
        // draw caption buttons over
        titleBarStyle: "default",
        titleBarOverlay: false,
    };
}

/**
 * Turns on mobile emulation through the DevTools protocol. Rejects when the
 * debugger can't attach or a command fails; the phone layout itself does not
 * depend on it, so the caller reports the failure and keeps the window.
 */
export async function emulatePhone(contents: WebContents): Promise<void> {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    // width/height 0: follow the window, so a resized mock stays truthful
    await contents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        width: 0,
        height: 0,
        deviceScaleFactor: 0,
        mobile: true,
    });
    await contents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 5,
    });
    await contents.debugger.sendCommand("Emulation.setEmitTouchEventsForMouse", {
        enabled: true,
        configuration: "mobile",
    });
}
