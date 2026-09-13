// live-iframe LRU policy (bun test): at most MAX panels stay mounted,
// eviction is least-recently-used, the active panel is always live
import { describe, it, expect } from "bun:test";
import { recordUse, liveKeys, MAX_LIVE_IFRAMES } from "../src/renderer/src/components/panels/panelLru";

const key = (i: number) => `local::panel-${i}`;

describe("live-iframe LRU", () => {
    it("bound constant is visible and sane", () => {
        expect(MAX_LIVE_IFRAMES).toBe(25);
    });

    it("keeps only the most recent MAX mounted", () => {
        const opened = Array.from({ length: 30 }, (_, i) => key(i));
        let order: string[] = [];
        for (const k of opened) order = recordUse(order, opened, k);
        const live = liveKeys(opened, order, key(29), MAX_LIVE_IFRAMES);
        expect(live.size).toBe(MAX_LIVE_IFRAMES);
        // oldest five evicted, newest kept
        for (let i = 0; i < 5; i++) expect(live.has(key(i))).toBe(false);
        for (let i = 5; i < 30; i++) expect(live.has(key(i))).toBe(true);
    });

    it("reactivating an evicted panel makes it live again", () => {
        const opened = Array.from({ length: 26 }, (_, i) => key(i));
        let order: string[] = [];
        for (const k of opened) order = recordUse(order, opened, k);
        expect(liveKeys(opened, order, key(25), 25).has(key(0))).toBe(false);
        order = recordUse(order, opened, key(0));
        const live = liveKeys(opened, order, key(0), 25);
        expect(live.has(key(0))).toBe(true);
        // something else got evicted instead
        expect(live.size).toBe(25);
    });

    it("closed panels leave the usage order", () => {
        const opened = [key(0), key(1), key(2)];
        let order = recordUse([], opened, key(2));
        order = recordUse(order, [key(0), key(2)], key(0));
        expect(order).not.toContain(key(1));
    });

    it("the active panel is reserved INSIDE the budget, never max+1", () => {
        // regression: liveKeys used to take the tail slice and then union
        // `current`, so the effective limit was MAX+1 whenever the current
        // key wasn't already the newest entry in the order
        const opened = Array.from({ length: 30 }, (_, i) => key(i));
        let order: string[] = [];
        for (const k of opened) order = recordUse(order, opened, k);
        order = recordUse(order, opened, key(0)); // activate the OLDEST
        const live = liveKeys(opened, order, key(0), MAX_LIVE_IFRAMES);
        expect(live.size).toBe(MAX_LIVE_IFRAMES);
        expect(live.has(key(0))).toBe(true);
    });
});
