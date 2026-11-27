import { BrowserWindow, app, nativeTheme } from "electron";
import * as path from "path";
import * as fs from "fs";
import type { FrameLook } from "@mileniumhq/paperapi/frameLook";
import { logger } from "daemon/core/logger";
import { setRunOnStartup } from "./loginItem";
import { withAppSettingsDefaults } from "../shared/appSettingsDefaults";
import { effectiveLook, graphicsFrom, type Graphics } from "../shared/graphics";
import { pushToShells } from "./communication/shellPush";
import { getLocalDir } from "daemon/core/paths";
import {
    TITLEBAR_OVERLAY_COLORS,
    TITLEBAR_SYMBOL_COLORS,
} from "daemon/core/themeConstants";

// the window's theme via nativeTheme; panel frames are told the theme, reduced
// motion and blur by the shell (PaperAPI's FrameLook), stamped on each panel
// document as it is served (servedFrameLook).
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

function appSettingsPath(): string {
    return path.join(getLocalDir(), "app-settings.json");
}

/** The saved settings, the defaults on a fresh install. Throws when the file
 * is there but can't be read: its defaults are not the user's settings, and
 * applying them would undo the user's choices on the system (a login item
 * removed, a theme reset). */
export function readAppSettings(): AppSettings {
    let text: string;
    try {
        text = fs.readFileSync(appSettingsPath(), "utf8");
    } catch (err: any) {
        if (err?.code === "ENOENT") return { ...DEFAULTS };
        throw new Error(`Paperboard couldn't read ${appSettingsPath()}: ${err?.message ?? err}`);
    }
    try {
        return withAppSettingsDefaults(DEFAULTS, JSON.parse(text));
    } catch (err: any) {
        throw new Error(`${appSettingsPath()} isn't valid settings: ${err?.message ?? err}`);
    }
}

export function applyNativeTheme(settings: AppSettings): void {
    nativeTheme.themeSource = settings.darkMode;
}

/** Applies Run on startup; resolves to why the system refused it, or null. */
export function applyRunOnStartup(settings: AppSettings): string | null {
    try {
        setRunOnStartup(settings.runOnStartup, {
            platform: process.platform,
            env: process.env,
            execPath: process.execPath,
            get: () => app.getLoginItemSettings(),
            set: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
        });
        return null;
    } catch (err: any) {
        // the shell shows it
        logger.warn("[AppSettings] failed to set login item:", err?.message ?? err);
        return err?.message ?? String(err);
    }
}

/** Whether this window is drawn on a GPU (shared/graphics.ts). */
export function currentGraphics(): Graphics {
    return graphicsFrom(app.getGPUFeatureStatus().gpu_compositing);
}

/** How a panel frame looks before the shell tells it (PaperAPI's FrameLook):
 * stamped on its document as it is served, so its first paint is right.
 * Settings that can't be read leave it to the shell's challenge. */
export function servedFrameLook(): FrameLook | null {
    let settings: AppSettings;
    try {
        settings = readAppSettings();
    } catch (err) {
        // quiet: the shell says its settings couldn't load, and tells the frame the look it shows
        logger.debug("[AppSettings] panel look not stamped:", err);
        return null;
    }
    const look = effectiveLook(settings, currentGraphics());
    return { theme: settings.darkMode, reducedMotion: look.disableAnimations, blurOff: look.disableBlur };
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
        } catch (err) {
            // windows drawn without the overlay (macOS, the screenshot tool) have none to set
            logger.debug("[AppSettings] title bar overlay not set:", err);
        }
    }
}

export function initAppSettingsSync(): void {
    // the theme before the first window draws; Run on startup is applied
    // when the shell has loaded the settings (useStartUp), so a refusal is
    // said on screen. Settings that can't be read change nothing; the
    // shell says so when its own read of them fails.
    try {
        applyNativeTheme(readAppSettings());
    } catch (err: any) {
        logger.error("[AppSettings] settings not applied:", err?.message ?? err);
    }

    // fires on OS flips too: under System the title bar follows the OS with the shell
    nativeTheme.on("updated", syncTitleBarOverlays);

    // a GPU process that crashes for good leaves Chromium drawing in software
    let graphics = currentGraphics();
    app.on("gpu-info-update", () => {
        const next = currentGraphics();
        if (next.gpu === graphics.gpu) return;
        graphics = next;
        pushToShells("graphics-changed", next);
    });
}
