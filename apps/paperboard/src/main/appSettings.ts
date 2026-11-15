import { BrowserWindow, app, nativeTheme, webContents, webFrameMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import type { WebFrameMain } from "electron";
import { logger } from "../../papercrane/logger";
import { setRunOnStartup } from "./loginItem";
import { withAppSettingsDefaults } from "../shared/appSettingsDefaults";
import { effectiveLook, graphicsFrom, type Graphics } from "../shared/graphics";
import { pushToShells } from "./communication/shellPush";
import { getLocalDir } from "../../papercrane/paths";
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
    // applyToFrame says why a frame refused; a window closed meanwhile has none
    for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed()) continue;
        await applyToFrame(wc.mainFrame);
        for (const frame of wc.mainFrame.frames) await applyToFrame(frame);
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

    app.on("web-contents-created", (_event, wc) => {
        wc.on("did-frame-finish-load", (_e, _isMainFrame, processId, routingId) => {
            const frame = webFrameMain.fromId(processId, routingId);
            if (frame) void applyToFrame(frame);
        });
    });

    // fires on OS flips too: under System the panels follow the OS with the shell
    nativeTheme.on("updated", () => {
        syncTitleBarOverlays();
        broadcastAppSettings().catch((err) => logger.warn("[AppSettings] theme broadcast failed:", err));
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
