// Desktop tray. Closing the window hides the app to the tray instead of
// quitting: panel services keep running, and the tray icon reopens the
// window or quits for real. The tooltip and menu show how many panels
// are still running, so a backgrounded Paperboard is never a mystery.
import { app, Menu, Tray, nativeImage } from "electron";
import { trayMenu, traySummary } from "./traySummary";

let tray: Tray | null = null;

export interface DesktopTrayDeps {
    icon: string;
    /** show + focus the main window, recreating it if it was destroyed */
    openWindow: () => void;
    /** running panel-service count; a number, or null when unknown */
    runningCount: () => number | null;
}

export function createDesktopTray(deps: DesktopTrayDeps): Tray {
    if (tray) return tray;
    tray = new Tray(nativeImage.createFromPath(deps.icon).resize({ width: 16, height: 16 }));

    const refresh = () => {
        if (!tray) return;
        const count = deps.runningCount();
        tray.setToolTip(traySummary(count));
        tray.setContextMenu(Menu.buildFromTemplate(trayMenu(count, deps.openWindow, () => app.quit())));
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
