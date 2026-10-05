import { describe, expect, test } from "bun:test";
import { trayMenu, traySummary } from "../src/main/traySummary";
import { pollTrayCount } from "../src/main/trayCount";

describe("tray summary", () => {
    test("unavailable is distinct from zero and counts panels", () => {
        expect(traySummary(null)).toBe("Paperboard · running panel count unavailable");
        expect(traySummary(0)).toBe("Paperboard · 0 panels running");
        expect(traySummary(1)).toBe("Paperboard · 1 panel running");
        expect(traySummary(4)).toBe("Paperboard · 4 panels running");
    });
    test("the shared tray opens the app, shows the count, and quits", () => {
        let opened = 0;
        let quit = 0;
        const menu = trayMenu(2, () => opened++, () => quit++);
        expect(menu.filter((item) => item.label).map((item) => item.label)).toEqual([
            "Open Paperboard", "Paperboard · 2 panels running", "Quit Paperboard",
        ]);
        expect(menu[2].enabled).toBe(false);
        menu[0].click?.({} as never, {} as never, {} as never);
        menu[4].click?.({} as never, {} as never, {} as never);
        expect(opened).toBe(1);
        expect(quit).toBe(1);
    });
    test("poll replaces a stale count on failure and recovers", async () => {
        const counts: (number | null)[] = [];
        let reads = 0;
        const failure = new Error("daemon unavailable");
        const errors: unknown[] = [];
        let complete!: () => void;
        const done = new Promise<void>((resolve) => { complete = resolve; });
        const stop = pollTrayCount({
            read: async () => { reads++; if (reads === 2) throw failure; return reads; },
            render: (count) => { counts.push(count); if (counts.length === 3) complete(); },
            onError: (error) => errors.push(error),
        }, 5);
        try {
            await done;
            expect(counts).toEqual([1, null, 3]);
            expect(errors).toEqual([failure]);
        } finally { stop(); }
    });
    test("a pending read cannot overlap or update a destroyed tray", async () => {
        let resolve!: (count: number) => void;
        let reads = 0;
        const counts: (number | null)[] = [];
        const stop = pollTrayCount({
            read: () => { reads++; return new Promise<number>((done) => { resolve = done; }); },
            render: (count) => counts.push(count),
            onError: (error) => { throw error; },
        }, 1);
        try {
            await Bun.sleep(10);
            expect(reads).toBe(1);
            stop(); resolve(9);
            await Bun.sleep(10);
            expect(counts).toEqual([]);
            expect(reads).toBe(1);
        } finally { stop(); }
    });
});
