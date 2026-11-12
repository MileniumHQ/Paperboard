// Desktop tray. Closing the window hides the app to the tray instead of
// quitting: panel services keep running, and the tray icon reopens the
// window or quits for real. The tooltip and menu show how many panels
// are still running, so a backgrounded Paperboard is never a mystery.
import { app, Menu, Tray, nativeImage } from "electron";
import { trayMenu, traySummary } from "./traySummary";

let tray: Tray | null = null;

export interface DesktopTrayDeps {
    icon: string;
    /** macOS menu bar glyph: a black "…Template" PNG with an @2x beside it */
    macTemplateIcon: string;
    /** show + focus the main window, recreating it if it was destroyed */
    openWindow: () => void;
    /** open Paperboard in the default browser, signed in */
    openInBrowser: () => void;
    /** running panel-service count; a number, or null when unknown */
    runningCount: () => number | null;
}

export function createDesktopTray(deps: DesktopTrayDeps): Tray {
    if (tray) return tray;
    // macOS draws a template image in the menu bar's own colour, for light,
    // dark and tinted bars alike; elsewhere the tray shows the app icon.
    const image =
        process.platform === "darwin"
            ? nativeImage.createFromPath(deps.macTemplateIcon)
            : nativeImage.createFromPath(deps.icon).resize({ width: 16, height: 16 });
    if (image.isEmpty()) throw new Error(`Tray icon failed to load: ${process.platform === "darwin" ? deps.macTemplateIcon : deps.icon}`);
    tray = new Tray(image);

    const refresh = () => {
        if (!tray) return;
        const count = deps.runningCount();
        tray.setToolTip(traySummary(count));
        tray.setContextMenu(Menu.buildFromTemplate(trayMenu(count, { openWindow: deps.openWindow, openInBrowser: deps.openInBrowser, quit: () => app.quit() })));
    };

    refresh();
    tray.on("click", () => deps.openWindow());
    // hook the shell calls to re-render the count
    (tray as Tray & { refreshSummary?: () => void }).refreshSummary = refresh;
    return tray;
}

export function refreshDesktopTray(): void {
    (tray as (Tray & { refreshSummary?: () => void }) | null)?.refreshSummary?.();
}

export function hasDesktopTray(): boolean {
    return tray !== null;
}

export function destroyDesktopTray(): void {
    tray?.destroy();
    tray = null;
}
