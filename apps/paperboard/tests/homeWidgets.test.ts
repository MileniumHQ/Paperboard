// Home's built-in widgets (bun test): the donut arithmetic behind CPU and
// Memory, and the Home a new user starts with.
import { describe, expect, it } from "bun:test";
import type { UsageReport } from "@mileniumhq/paperapi";
import { canPlace, parseHomeLayout, placementOf, serializeHomeLayout } from "../src/renderer/src/lib/homeLayout";
import { defaultHomeItems } from "../src/renderer/src/components/home/builtins/defaults";
import { formatBytes, MAX_PANEL_SEGMENTS, usageChart, usedFraction } from "../src/renderer/src/components/home/builtins/usageSegments";

const GiB = 1024 ** 3;
const name = (id: string) => `Panel ${id}`;

function report(panels: Array<[id: string, gib: number, cpu: number]>, over: Partial<UsageReport> = {}): UsageReport {
    return {
        sampledAt: 0,
        memory: { totalBytes: 16 * GiB, availableBytes: 8 * GiB, otherBytes: 4 * GiB },
        cpu: { cores: 8, idlePercent: 60, otherPercent: 20 },
        groups: [
            { id: "paperboard", kind: "paperboard", memoryBytes: 1 * GiB, cpuPercent: 5 },
            ...panels.map(([id, gib, cpu]) => ({ id, kind: "panel" as const, memoryBytes: gib * GiB, cpuPercent: cpu })),
        ],
        ...over,
    };
}

describe("usage chart", () => {
    it("splits memory into panels, Paperboard, other apps and free", () => {
        const chart = usageChart(report([["a", 2, 10], ["b", 1, 5]]), "memory", name);
        expect(chart?.used).toBe(0.5);
        expect(chart?.free).toMatchObject({ label: "Free", fraction: 0.5, detail: "8 GB" });
        expect(chart?.segments.map((s) => [s.label, s.fraction])).toEqual([
            ["Other apps", 0.25],
            ["Panel a", 0.125],
            ["Panel b", 0.0625],
            ["Paperboard", 0.0625],
        ]);
    });

    it("reads CPU as shares of the whole computer", () => {
        const chart = usageChart(report([["a", 2, 10]]), "cpu", name);
        expect(chart?.used).toBeCloseTo(0.4);
        expect(chart?.segments.find((s) => s.key === "a")?.detail).toBe("10%");
        expect(chart?.segments.find((s) => s.key === "other")?.fraction).toBeCloseTo(0.2);
    });

    it("names each owner's CPU beside its memory", () => {
        const memory = usageChart(report([["a", 2, 10]]), "memory", name);
        const cpuOf = (key: string) => memory?.segments.find((s) => s.key === key)?.cpu;
        expect([cpuOf("a"), cpuOf("paperboard"), cpuOf("other")]).toEqual(["10%", "5%", "20%"]);
        expect(memory?.free.cpu).toBeUndefined();
        expect(usageChart(report([["a", 2, 10]]), "cpu", name)?.segments.some((s) => s.cpu)).toBe(false);
        expect(usageChart(report([["a", 2, 10]], { cpu: null }), "memory", name)?.segments.some((s) => s.cpu)).toBe(false);
    });

    it("has nothing to draw for CPU before it was measured", () => {
        expect(usageChart(report([], { cpu: null }), "cpu", name)).toBeNull();
        expect(usageChart(report([], { cpu: null }), "memory", name)).not.toBeNull();
    });

    it("reads the share in use for the trend line, the same as the ring shows", () => {
        expect(usedFraction(report([]), "memory")).toBe(0.5);
        expect(usedFraction(report([]), "cpu")).toBeCloseTo(0.4);
        expect(usedFraction(report([], { cpu: null }), "cpu")).toBeNull();
    });

    it("folds panels past the limit into one segment", () => {
        const many = Array.from({ length: MAX_PANEL_SEGMENTS + 2 }, (_, i) => [`p${i}`, 0.5, 1] as [string, number, number]);
        const chart = usageChart(report(many), "memory", name);
        expect(chart?.segments.filter((s) => /^p\d/.test(s.key))).toHaveLength(MAX_PANEL_SEGMENTS);
        expect(chart?.segments.find((s) => s.key === "more-panels")?.detail).toBe("1 GB");
    });

    it("keeps a panel's color when its rank changes", () => {
        const before = usageChart(report([["a", 2, 0], ["b", 1, 0]]), "memory", name);
        const after = usageChart(report([["a", 1, 0], ["b", 2, 0]]), "memory", name);
        const color = (chart: typeof before, key: string) => chart?.segments.find((s) => s.key === key)?.color;
        expect(color(after, "a")).toBe(color(before, "a"));
        expect(color(after, "b")).toBe(color(before, "b"));
    });

    it("fits overlapping resident sets into what's in use, never past free", () => {
        const chart = usageChart(
            report([["a", 6, 0]], { memory: { totalBytes: 16 * GiB, availableBytes: 12 * GiB, otherBytes: 0 } }),
            "memory",
            name,
        );
        const drawn = (chart?.segments ?? []).reduce((sum, s) => sum + s.fraction, 0);
        expect(drawn).toBeCloseTo(0.25);
        // the reading is still the one reported
        expect(chart?.segments.find((s) => s.key === "a")?.detail).toBe("6 GB");
    });

    it("writes sizes the way people read them", () => {
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1.5 * GiB)).toBe("1.5 GB");
        expect(formatBytes(24 * GiB)).toBe("24 GB");
    });
});

describe("a new Home", () => {
    it("starts with built-in widgets that form a valid, non-overlapping layout", () => {
        const items = defaultHomeItems("local");
        expect(items.map((i) => i.widgetId)).toEqual(["clock", "cpu", "memory"]);
        expect(parseHomeLayout(JSON.parse(JSON.stringify(serializeHomeLayout(items))))).toEqual(items);
        for (const item of items) expect(canPlace(items, placementOf(item), item.id)).toBe(true);
    });
});
