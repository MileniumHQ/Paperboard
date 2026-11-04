import type { HomeItem } from "../../../lib/homeLayout";

/** What a Home that was never arranged starts with: this computer at a glance. */
export function defaultHomeItems(computerId: string): HomeItem[] {
    const item = (widgetId: string, size: string, x: number, y: number): HomeItem => ({
        id: crypto.randomUUID(),
        source: "builtin",
        computerId,
        widgetId,
        size,
        x,
        y,
    });
    // one filled 8x3 block: the time and the drive across the top, then
    // what this computer is doing, what it's running and who it can reach
    return [
        item("clock", "4x1", 0, 0),
        item("disk", "2x1", 4, 0),
        item("computers", "2x1", 6, 0),
        item("cpu", "2x2", 0, 1),
        item("memory", "2x2", 2, 1),
        item("network", "2x2", 4, 1),
        item("panels", "2x2", 6, 1),
    ];
}
