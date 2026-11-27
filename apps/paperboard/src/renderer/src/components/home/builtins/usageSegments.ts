// Turns a usage report into donut segments: each panel, Paperboard,
// everything else, and what's free. Pure, so the arithmetic is tested.
import type { UsageReport } from "@mileniumhq/paperapi";
import { formatBytes, getVarCss } from "@mileniumhq/paperui";

export type UsageMetric = "cpu" | "memory";

export interface Segment {
    key: string;
    label: string;
    /** share of the donut, 0-1 */
    fraction: number;
    /** the reading as reported: bytes, or percent of the CPU */
    value: number;
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
    /**
     * The same segments in the order the legend picks them: by each owner's
     * share of CPU and memory together, so the CPU and Memory cards name the
     * same owners. legendRows() takes them from here.
     */
    legend: Segment[];
    free: Segment;
    /** a reading as people say it */
    format: (value: number) => string;
}

/**
 * The ring and the legend for a legend with room for `rows`: the owners
 * both cards pick, each card listing them largest first by its own reading,
 * then what's free. When there are more owners than rows, the last row
 * before Free is everything the legend can't name, and the ring draws them
 * as that one slice: every slice in the ring is a row in the legend.
 */
export function fitChart(chart: UsageChart, rows: number): { ring: Segment[]; legend: Segment[] } {
    const room = Math.max(0, rows - 1);
    if (chart.legend.length <= room) {
        const named = [...chart.legend].sort((a, b) => b.fraction - a.fraction);
        return { ring: chart.segments, legend: [...named, chart.free] };
    }
    if (room === 0) return { ring: [rest(chart, chart.segments)], legend: [chart.free] };
    const named = chart.legend.filter((s) => s.key !== "other").slice(0, room - 1);
    const kept = new Set(named.map((s) => s.key));
    const others = rest(chart, chart.segments.filter((s) => !kept.has(s.key)));
    const shown = [...named, others].sort((a, b) => b.fraction - a.fraction);
    return { ring: shown, legend: [...shown, chart.free] };
}

// the owners a legend can't name, as one slice
function rest(chart: UsageChart, segments: Segment[]): Segment {
    const value = segments.reduce((sum, s) => sum + s.value, 0);
    return { key: "rest", label: "Others", value, fraction: segments.reduce((sum, s) => sum + s.fraction, 0), detail: chart.format(value), color: OTHER_COLOR };
}

/** Panels beyond this many share one "Other panels" segment. */
export const MAX_PANEL_SEGMENTS = 5;
// panel colors are assigned by panel id, so a panel keeps its color while
// its rank changes from one reading to the next
const PANEL_COLORS = [
    getVarCss("extra-1"),
    getVarCss("extra-2"),
    getVarCss("attention"),
    getVarCss("extra-3"),
    getVarCss("warning"),
];
const PAPERBOARD_COLOR = getVarCss("primary");
const MORE_PANELS_COLOR = getVarCss("success");
const OTHER_COLOR = getVarCss("border-emphasis");
// a step above the card in either theme, lighter than "Other apps"
const FREE_COLOR = `color-mix(in srgb, ${getVarCss("contrast")} 16%, ${getVarCss("surface-raised")})`;

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
    const chart = segmentsOf(report, metric, panelName);
    if (!chart) return null;
    // an owner's share of the other figure too; CPU before it was measured adds nothing
    const other = segmentsOf(report, metric === "cpu" ? "memory" : "cpu", panelName);
    const otherShare = new Map((other?.segments ?? []).map((s) => [s.key, s.fraction]));
    const weight = (s: Segment) => s.fraction + (otherShare.get(s.key) ?? 0);
    // ties keep this figure's order, so the legend never reshuffles on equal shares
    const legend = chart.segments.map((s, rank) => ({ s, rank })).sort((a, b) => weight(b.s) - weight(a.s) || a.rank - b.rank).map(({ s }) => s);
    return { ...chart, legend };
}

function segmentsOf(report: UsageReport, metric: UsageMetric, panelName: (id: string) => string): Omit<UsageChart, "legend"> | null {
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
    const raw: Array<Omit<Segment, "fraction">> = ranked
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
        .map((s) => ({ ...s, fraction: (s.value * scale) / total }))
        .filter((s) => s.fraction > 0)
        .sort((a, b) => b.fraction - a.fraction);
    return {
        used: room,
        segments,
        free: { key: "free", label: "Free", value: freeValue, fraction: freeFraction, detail: detail(freeValue), color: FREE_COLOR },
        format: detail,
    };
}
