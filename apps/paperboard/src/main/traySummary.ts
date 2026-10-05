import type { MenuItemConstructorOptions } from "electron";

export function traySummary(count: number | null): string {
    if (count === null) return "Paperboard · running panel count unavailable";
    return `Paperboard · ${count} panel${count === 1 ? "" : "s"} running`;
}

// Shared by desktop and browser launches: one menu, one count readout.
export function trayMenu(count: number | null, openWindow: () => void, quit: () => void): MenuItemConstructorOptions[] {
    return [
        { label: "Open Paperboard", click: openWindow },
        { type: "separator" },
        { label: traySummary(count), enabled: false },
        { type: "separator" },
        { label: "Quit Paperboard", click: quit },
    ];
}
