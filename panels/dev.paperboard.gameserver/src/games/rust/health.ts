import type { PaperRole } from "@mileniumhq/paperui";

/** Rust's server runs well above what players need; below 30 frames a second they feel it, and below 15 the world stutters. */
export function fpsTone(fps: number): PaperRole {
    if (fps >= 30) return "success";
    if (fps >= 15) return "warning";
    return "danger";
}
