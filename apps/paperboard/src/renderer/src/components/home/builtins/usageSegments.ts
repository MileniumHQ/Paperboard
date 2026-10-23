// Turns a usage report into donut segments: each panel, Paperboard,
// everything else, and what's free. Pure, so the arithmetic is tested.
import type { UsageReport } from "@mileniumhq/paperapi";

export type UsageMetric = "cpu" | "memory";

export interface Segment {
    key: string;
    label: string;
    /** share of the donut, 0-1 */
    fraction: number;
    /** the reading as people say it: "1.2 GB", "14%" */
    detail: string;
    color: string;
    /** on the Memory chart, the same owner's CPU share, when it was measured */
    cpu?: string;
}

export interface UsageChart {
    /** share in use, 0-1 */
    used: number;
    /** largest first; free is not among them */
    segments: Segment[];
    free: Segment;
}

/** Panels beyond this many share one "Other panels" segment. */
export const MAX_PANEL_SEGMENTS = 5;
// panel colors are assigned by panel id, so a panel keeps its color while
// its rank changes from one reading to the next
const PANEL_COLORS = [
    "var(--paper-extra-1)",
    "var(--paper-extra-2)",
    "var(--paper-attention)",
    "var(--paper-extra-3)",
    "var(--paper-warning)",
];
const PAPERBOARD_COLOR = "var(--paper-primary)";
const MORE_PANELS_COLOR = "var(--paper-success)";
const OTHER_COLOR = "var(--paper-border-emphasis)";
const FREE_COLOR = "var(--paper-surface-inset)";

export function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    // promote on the shown value, so 1023.6 KB reads "1 MB", not "1024 KB"
    while (Math.round(value) >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    // one decimal below ten, and none when it would be ".0"
    const shown = value >= 10 || unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
    return `${shown} ${units[unit]}`;
}

export function formatPercent(fraction: number): string {
    const percent = fraction * 100;
    return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

/** The share of a computer's CPU or memory in use, 0-1; null while CPU hasn't been measured. */
export function usedFraction(report: UsageReport, metric: UsageMetric): number | null {
    const total = metric === "memory" ? report.memory.totalBytes : 100;
    if (total <= 0 || (metric === "cpu" && !report.cpu)) return null;
    const free = metric === "memory" ? report.memory.availableBytes : (report.cpu?.idlePercent ?? 0);
    return 1 - Math.min(1, Math.max(0, free / total));
}

/** null while CPU hasn't been measured yet */
export function usageChart(report: UsageReport, metric: UsageMetric, panelName: (id: string) => string): UsageChart | null {
    const cpu = report.cpu;
    if (metric === "cpu" && !cpu) return null;
    const total = metric === "memory" ? report.memory.totalBytes : 100;
    if (total <= 0) return null;
    const amount = (group: { memoryBytes: number; cpuPercent: number | null }) =>
        metric === "memory" ? group.memoryBytes : (group.cpuPercent ?? 0);
    const detail = (value: number) => (metric === "memory" ? formatBytes(value) : formatPercent(value / 100));
    const cpuOf = (percent: number | null | undefined) =>
        metric === "memory" && cpu && percent != null ? { cpu: formatPercent(percent / 100) } : {};
    const cpuSum = (groups: Array<{ cpuPercent: number | null }>) =>
        groups.some((g) => g.cpuPercent !== null) ? groups.reduce((sum, g) => sum + (g.cpuPercent ?? 0), 0) : null;

    const panels = report.groups.filter((g) => g.kind === "panel");
    const colorOf = new Map([...panels].sort((a, b) => a.id.localeCompare(b.id)).map((g, i) => [g.id, PANEL_COLORS[i % PANEL_COLORS.length]]));
    const ranked = [...panels].sort((a, b) => amount(b) - amount(a));
    const raw: Array<Omit<Segment, "fraction"> & { value: number }> = ranked
        .slice(0, MAX_PANEL_SEGMENTS)
        .map((g) => ({ key: g.id, label: panelName(g.id), value: amount(g), detail: detail(amount(g)), color: colorOf.get(g.id) as string, ...cpuOf(g.cpuPercent) }));
    const rest = ranked.slice(MAX_PANEL_SEGMENTS);
    const more = rest.reduce((sum, g) => sum + amount(g), 0);
    if (more > 0) raw.push({ key: "more-panels", label: "Other panels", value: more, detail: detail(more), color: MORE_PANELS_COLOR, ...cpuOf(cpuSum(rest)) });
    const paperboard = report.groups.find((g) => g.kind === "paperboard");
    if (paperboard) {
        raw.push({ key: "paperboard", label: "Paperboard", value: amount(paperboard), detail: detail(amount(paperboard)), color: PAPERBOARD_COLOR, ...cpuOf(paperboard.cpuPercent) });
    }
    const other = metric === "memory" ? report.memory.otherBytes : (cpu?.otherPercent ?? 0);
    raw.push({ key: "other", label: "Other apps", value: other, detail: detail(other), color: OTHER_COLOR, ...cpuOf(cpu?.otherPercent) });

    const freeValue = metric === "memory" ? report.memory.availableBytes : (cpu?.idlePercent ?? 0);
    const freeFraction = Math.min(1, Math.max(0, freeValue / total));
    // resident sets can overlap (shared pages), so the slices are fitted
    // into what's in use; the labels keep the readings as reported
    const sum = raw.reduce((acc, s) => acc + s.value, 0);
    const room = 1 - freeFraction;
    const scale = sum / total > room && sum > 0 ? (room * total) / sum : 1;
    const segments = raw
        .map(({ value, ...s }) => ({ ...s, fraction: (value * scale) / total }))
        .filter((s) => s.fraction > 0)
        .sort((a, b) => b.fraction - a.fraction);
    return {
        used: room,
        segments,
        free: { key: "free", label: "Free", fraction: freeFraction, detail: detail(freeValue), color: FREE_COLOR },
    };
}
