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
    return [item("clock", "4x1", 0, 0), item("cpu", "2x2", 0, 1), item("memory", "2x2", 2, 1)];
}
