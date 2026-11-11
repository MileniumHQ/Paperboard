import { BrowserWindow, app, nativeTheme, webContents, webFrameMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import type { WebFrameMain } from "electron";
import { logger } from "../../papercrane/logger";
import { setRunOnStartup } from "./loginItem";
import { withAppSettingsDefaults } from "../shared/appSettingsDefaults";
import { effectiveLook, graphicsFrom, type Graphics } from "../shared/graphics";
import { pushToShells } from "./communication/shellPush";
import {
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
} from "../../papercrane/themeConstants";

// theme via nativeTheme; reduced motion, blur AND the resolved theme are injected
// into panel frames. <html data-paperui-theme> is what PaperProvider reads
// when it has no explicit theme, and it also applies CSS tokens immediately.
export interface AppSettings {
    darkMode: "system" | "light" | "dark";
    /** absent until chosen: off on a GPU, on without one (shared/graphics.ts) */
    disableAnimations?: boolean;
    /** absent until chosen, the same way */
    disableBlur?: boolean;
    runOnStartup: boolean;
}

const DEFAULTS: AppSettings = {
    darkMode: "system",
    runOnStartup: false,
};

// the daemon's paths module owns this fact (one implementation) — the
// loader/restorer/etc. already resolve through it
import { getPaperboardDir as paperboardDir } from "../../papercrane/paths";

export function appSettingsPath(): string {
    return path.join(paperboardDir(), "local", "app-settings.json");
}

export function readAppSettings(): AppSettings {
    try {
        const raw = JSON.parse(fs.readFileSync(appSettingsPath(), "utf8"));
        return withAppSettingsDefaults(DEFAULTS, raw);
    } catch (err: any) {
        // missing is a fresh install; unreadable is reported, not hidden
        if (err?.code !== "ENOENT") {
            logger.warn("[appSettings] settings file unreadable, using defaults:", err?.message ?? err);
        }
        return { ...DEFAULTS };
    }
}

export function applyNativeTheme(): void {
    const { darkMode } = readAppSettings();
    try {
        nativeTheme.themeSource = darkMode;
    } catch (err: any) {
        logger.warn("[AppSettings] failed to set themeSource:", err?.message ?? err);
    }
}

/** Applies Run on startup; resolves to why the system refused it, or null. */
export function applyRunOnStartup(): string | null {
    const { runOnStartup } = readAppSettings();
    try {
        setRunOnStartup(runOnStartup, {
            platform: process.platform,
            env: process.env,
            execPath: process.execPath,
            get: () => app.getLoginItemSettings(),
            set: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
        });
        return null;
    } catch (err: any) {
        logger.warn("[AppSettings] failed to set login item:", err?.message ?? err);
        return err?.message ?? String(err);
    }
}

/** Whether this window is drawn on a GPU (shared/graphics.ts). */
export function currentGraphics(): Graphics {
    return graphicsFrom(app.getGPUFeatureStatus().gpu_compositing);
}

// safe no-op for non-panel frames
async function applyToFrame(frame: WebFrameMain): Promise<void> {
    try {
        if (!frame.url.startsWith("panel://")) return;
        const settings = readAppSettings();
        const look = effectiveLook(settings, currentGraphics());
        // the OS media query is not a contract: Paperboard's forced theme
        // may disagree with the OS, and nativeTheme propagation to custom
        // protocol frames is implicit. Inject the resolved theme explicitly
        // so a panel always matches the window it lives in.
        const resolvedTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
        const js = `
            (() => {
                document.documentElement.setAttribute('data-paperui-motion', ${JSON.stringify(
                    look.disableAnimations ? "reduced" : "auto",
                )});
                document.documentElement.setAttribute('data-paperui-theme', ${JSON.stringify(
                    resolvedTheme,
                )});
                document.documentElement.setAttribute('data-paperui-blur', ${JSON.stringify(
                    look.disableBlur ? "off" : "auto",
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

    // a GPU process that crashes for good leaves Chromium drawing in software
    let graphics = currentGraphics();
    app.on("gpu-info-update", () => {
        const next = currentGraphics();
        if (next.gpu === graphics.gpu) return;
        graphics = next;
        pushToShells("graphics-changed", next);
        broadcastAppSettings().catch((err) => logger.warn("[AppSettings] graphics broadcast failed:", err));
    });
}
