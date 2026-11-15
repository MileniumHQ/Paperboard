// A quit the person asks for (the tray, the menu or Dock, Quit Paperboard,
// Restart to update) waits for every shell window whose panels hold unsaved
// work: the window is shown, each page asks in its own dialog, and the quit
// goes ahead only once all of them agreed. A signal or the system shutting
// down does not ask. Each window says whether it holds unsaved work
// (panels-unsaved), so a quit with nothing unsaved never waits.
import { app, BrowserWindow, dialog, type WebContents } from "electron";
import { askShell } from "./shellAsk";
import { logger } from "../../papercrane/logger";

// each window holding unsaved work, with what drops it once the window is gone
const unsaved = new Map<WebContents, () => void>();
// the quit was agreed to, or isn't the person's (a signal, a shutdown)
let agreed = false;
let asking: Promise<boolean> | null = null;

/** a shell window said its panels hold unsaved work, or no longer do */
export function setShellUnsaved(wc: WebContents, value: boolean): void {
    const gone = unsaved.get(wc);
    if (!value) {
        if (!gone) return;
        unsaved.delete(wc);
        wc.off("destroyed", gone);
        wc.off("render-process-gone", gone);
        return;
    }
    if (gone) return;
    // a window that is gone has nothing left to lose
    const drop = () => setShellUnsaved(wc, false);
    unsaved.set(wc, drop);
    wc.once("destroyed", drop);
    wc.once("render-process-gone", drop);
}

/** Asks each window holding unsaved work, in turn; false once one keeps Paperboard open. */
export function confirmQuit(): Promise<boolean> {
    asking ??= (async () => {
        for (const wc of [...unsaved.keys()]) {
            if (wc.isDestroyed()) continue;
            const window = BrowserWindow.fromWebContents(wc);
            if (window) {
                if (window.isMinimized()) window.restore();
                window.show();
                window.focus();
            }
            // null: the window went away while it asked
            if ((await askShell(wc, "quit-ask", {})) === false) return false;
        }
        return true;
    })().finally(() => {
        asking = null;
    });
    return asking;
}

/** the next quit goes ahead without asking */
export function agreeToQuit(): void {
    agreed = true;
}

/** A signal or a shutdown: quit now, whatever is unsaved. */
export function quitWithoutAsking(): void {
    agreed = true;
    app.quit();
}

/**
 * before-quit: a quit nobody agreed to yet, with unsaved work open, waits
 * while the pages ask, and starts again once they all agreed. True when it
 * held the quit.
 */
export function holdQuit(event: { preventDefault(): void }): boolean {
    if (agreed || unsaved.size === 0) return false;
    event.preventDefault();
    void confirmQuit().then((ok) => {
        if (!ok) return;
        agreed = true;
        app.quit();
    }, (err) => {
        logger.error("[Main] the quit could not ask about unsaved work, so Paperboard stays open:", err);
        dialog.showErrorBox("Paperboard didn't quit", `It couldn't ask the open pages about their unsaved work: ${err instanceof Error ? err.message : String(err)}`);
    });
    return true;
}
