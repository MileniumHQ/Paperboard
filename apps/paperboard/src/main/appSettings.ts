import { BrowserWindow, app, nativeTheme, webContents, webFrameMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import type { WebFrameMain } from "electron";
import { logger } from "../../papercrane/logger";

// Theme flows through nativeTheme (prefers-color-scheme in every renderer);
// reduced motion is injected into panel frames as an attribute.

export interface AppSettings {
    darkMode: "system" | "light" | "dark";
    reducedMotion: boolean;
}

const DEFAULTS: AppSettings = { darkMode: "system", reducedMotion: false };

export function appSettingsPath(): string {
    return path.join(process.env.PAPERBOARD_DIR || path.join(process.env.HOME || "", ".paperboard"), "configs", "app-settings.json");
}

export function readAppSettings(): AppSettings {
    try {
        const raw = JSON.parse(fs.readFileSync(appSettingsPath(), "utf8"));
        return { ...DEFAULTS, ...raw };
    } catch {
        return { ...DEFAULTS };
    }
}

// Makes every renderer's prefers-color-scheme match
export function applyNativeTheme(): void {
    const { darkMode } = readAppSettings();
    try {
        nativeTheme.themeSource = darkMode;
    } catch (err: any) {
        logger.warn("[AppSettings] failed to set themeSource:", err?.message ?? err);
    }
}

// Applies reduced-motion to a single panel frame. Safe no-op for non-panel frames.
async function applyToFrame(frame: WebFrameMain): Promise<void> {
    try {
        if (!frame.url.startsWith("panel://")) return;
        const settings = readAppSettings();
        const js = `
            (() => {
                document.documentElement.setAttribute('data-paperui-motion', ${JSON.stringify(
                    settings.reducedMotion ? "reduced" : "auto",
                )});
            })();
        `;
        await frame.executeJavaScript(js, false);
    } catch (err: any) {
        // Frames navigate/destroy constantly mid-execution — that's routine.
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
        } catch {}
    }
}

// themeSource is already applied, so shouldUseDarkColors is authoritative.
export function syncTitleBarOverlays(): void {
    const isDark = nativeTheme.shouldUseDarkColors;
    for (const win of BrowserWindow.getAllWindows()) {
        try {
            win.setTitleBarOverlay({
                color: isDark ? "#2a2a2a" : "#e2e6eb",
                symbolColor: isDark ? "#f5f5f5" : "#0f1319",
            });
        } catch {}
    }
}

// Freshly loaded panel frames pick up settings automatically
export function initAppSettingsSync(): void {
    applyNativeTheme();

    app.on("web-contents-created", (_event, wc) => {
        wc.on("did-frame-finish-load", async (_e, _isMainFrame, processId, routingId) => {
            try {
                const frame = webFrameMain.fromId(processId, routingId);
                if (frame) await applyToFrame(frame);
            } catch {}
        });
    });

    // Fires on OS flips too (system mode)
    nativeTheme.on("updated", () => {
        syncTitleBarOverlays();
    });
}
