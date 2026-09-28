import { BrowserWindow, app, nativeTheme, webContents, webFrameMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import type { WebFrameMain } from "electron";
import { logger } from "../../papercrane/logger";
import {
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
} from "../../papercrane/themeConstants";

// theme via nativeTheme; reduced motion AND the resolved theme are injected
// into panel frames. <html data-paperui-theme> is what PaperProvider reads
// when it has no explicit theme, and it also applies CSS tokens immediately.
export interface AppSettings {
    darkMode: "system" | "light" | "dark";
    reducedMotion: boolean;
    runOnStartup: boolean;
}

const DEFAULTS: AppSettings = {
    darkMode: "system",
    reducedMotion: false,
    runOnStartup: false,
};

// the daemon's paths module owns this fact (one implementation) — the
// loader/restorer/etc. already resolve through it
import { getPaperboardDir as paperboardDir } from "../../papercrane/paths";

export function appSettingsPath(): string {
    return path.join(paperboardDir(), "local", "app-settings.json");
}

// TODO(remove after v3.1): legacy pre-meaningful-location settings path,
// kept only for read-through; dies in one release
function legacyAppSettingsPath(): string {
    return path.join(paperboardDir(), "configs", "app-settings.json");
}

export function readAppSettings(): AppSettings {
    for (const file of [appSettingsPath(), legacyAppSettingsPath()]) {
        try {
            const raw = JSON.parse(fs.readFileSync(file, "utf8"));
            return { ...DEFAULTS, ...raw };
        } catch (err) {
            // missing or corrupt — try next location, else defaults
            logger.debug("[appSettings] ignoring unreadable settings file:", err);
        }
    }
    return { ...DEFAULTS };
}

export function applyNativeTheme(): void {
    const { darkMode } = readAppSettings();
    try {
        nativeTheme.themeSource = darkMode;
    } catch (err: any) {
        logger.warn("[AppSettings] failed to set themeSource:", err?.message ?? err);
    }
}

export function applyRunOnStartup(): void {
    const { runOnStartup } = readAppSettings();
    try {
        app.setLoginItemSettings({ openAtLogin: runOnStartup });
    } catch (err: any) {
        logger.warn("[AppSettings] failed to set login item:", err?.message ?? err);
    }
}

// safe no-op for non-panel frames
async function applyToFrame(frame: WebFrameMain): Promise<void> {
    try {
        if (!frame.url.startsWith("panel://")) return;
        const settings = readAppSettings();
        // the OS media query is not a contract: Paperboard's forced theme
        // may disagree with the OS, and nativeTheme propagation to custom
        // protocol frames is implicit. Inject the resolved theme explicitly
        // so a panel always matches the window it lives in.
        const resolvedTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
        const js = `
            (() => {
                document.documentElement.setAttribute('data-paperui-motion', ${JSON.stringify(
                    settings.reducedMotion ? "reduced" : "auto",
                )});
                document.documentElement.setAttribute('data-paperui-theme', ${JSON.stringify(
                    resolvedTheme,
                )});
            })();
        `;
        await frame.executeJavaScript(js, false);
    } catch (err: any) {
        // frames navigate/destroy mid-execution — routine
        if (!frame.isDestroyed()) {
            logger.warn(
                "[AppSettings] applyToFrame failed:",
                err?.message ?? err,
            );
        }
    }
}

export async function broadcastAppSettings(): Promise<void> {
    for (const wc of webContents.getAllWebContents()) {
        try {
            await applyToFrame(wc.mainFrame);
            for (const frame of wc.mainFrame.frames) {
                await applyToFrame(frame);
            }
        } catch (err) { logger.debug("[appSettings.ts] op failed:", err) }
    }
}

// shouldUseDarkColors is authoritative after themeSource applies
export function syncTitleBarOverlays(): void {
    const isDark = nativeTheme.shouldUseDarkColors;
    for (const win of BrowserWindow.getAllWindows()) {
        try {
            win.setTitleBarOverlay({
                color: isDark
                    ? TITLEBAR_OVERLAY_COLORS.dark
                    : TITLEBAR_OVERLAY_COLORS.light,
                symbolColor: isDark
                    ? TITLEBAR_SYMBOL_COLORS.dark
                    : TITLEBAR_SYMBOL_COLORS.light,
            });
        } catch (err) { logger.debug("[appSettings.ts] op failed:", err) }
    }
}

export function initAppSettingsSync(): void {
    applyNativeTheme();
    applyRunOnStartup();

    app.on("web-contents-created", (_event, wc) => {
        wc.on("did-frame-finish-load", async (_e, _isMainFrame, processId, routingId) => {
            try {
                const frame = webFrameMain.fromId(processId, routingId);
                if (frame) await applyToFrame(frame);
            } catch (err) { logger.debug("[appSettings.ts] op failed:", err) }
        });
    });

    // fires on OS flips too
    nativeTheme.on("updated", () => {
        syncTitleBarOverlays();
    });
}
