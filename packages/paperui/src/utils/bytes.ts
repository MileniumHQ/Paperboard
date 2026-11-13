const UNITS = ["KB", "MB", "GB", "TB"] as const;
const STEP = 1024;

// a whole number drops its ".0"; under ten keeps one decimal so a slow
// download still visibly moves
function amount(value: number): string {
    const shown = value < 10 ? value.toFixed(1) : Math.round(value).toString();
    return shown.endsWith(".0") ? shown.slice(0, -2) : shown;
}

/**
 * How much of a download has arrived, both numbers in the total's unit:
 * "5.6 / 6 GB". The one wording every download in Paperboard uses.
 */
export function formatByteProgress(done: number, total: number): string {
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
        throw new Error(`formatByteProgress needs a positive total, got ${done} of ${total}`);
    }
    let unit = 0;
    let divisor = STEP;
    while (unit < UNITS.length - 1 && total >= divisor * STEP) {
        unit += 1;
        divisor *= STEP;
    }
    const clamped = Math.min(Math.max(done, 0), total);
    return `${amount(clamped / divisor)} / ${amount(total / divisor)} ${UNITS[unit]}`;
}
