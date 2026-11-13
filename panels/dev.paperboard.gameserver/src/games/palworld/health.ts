import type { PaperRole } from "@mileniumhq/paperui";

/** Palworld's server aims for 60 frames a second; below 30 players feel the lag. */
export function fpsTone(fps: number): PaperRole {
    if (fps >= 50) return "success";
    if (fps >= 30) return "warning";
    return "danger";
}
