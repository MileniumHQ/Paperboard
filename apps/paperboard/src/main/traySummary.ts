import type { MenuItemConstructorOptions } from "electron";

export function traySummary(count: number | null): string {
    if (count === null) return "Paperboard · running panel count unavailable";
    return `Paperboard · ${count} panel${count === 1 ? "" : "s"} running`;
}

export interface TrayActions {
    openWindow: () => void;
    /** Paperboard in the person's default browser, signed in */
    openInBrowser: () => void;
    quit: () => void;
}

// Shared by desktop and browser launches: one menu, one count readout.
export function trayMenu(count: number | null, actions: TrayActions): MenuItemConstructorOptions[] {
    return [
        { label: "Open Paperboard", click: actions.openWindow },
        { label: "Open in Browser", click: actions.openInBrowser },
        { type: "separator" },
        { label: traySummary(count), enabled: false },
        { type: "separator" },
        { label: "Quit Paperboard", click: actions.quit },
    ];
}
