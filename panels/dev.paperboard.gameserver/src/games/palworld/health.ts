import type { PaperRole } from "@mileniumhq/paperui";

/** Palworld's server aims for 60 frames a second; below 30 players feel the lag. */
export const TARGET_FPS = 60;

export function fpsTone(fps: number): PaperRole {
    if (fps >= 50) return "success";
    if (fps >= 30) return "warning";
    return "danger";
}

/** "45s", "12m", "3h 05m" or "2d 4h", from seconds. */
export function uptimeLabel(seconds: number): string {
    const s = Math.floor(seconds);
    if (s < 60) return `${s}s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
