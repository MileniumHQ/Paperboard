// The tray label for a running-service count. Pure and Electron-free so the
// wiring in tray.ts can be tested without a display.

export function traySummary(count: number | null): string {
    if (count === null) return "Paperboard";
    if (count === 0) return "Paperboard · no processes running";
    return `Paperboard · running ${count} process${count === 1 ? "" : "es"}`;
}
