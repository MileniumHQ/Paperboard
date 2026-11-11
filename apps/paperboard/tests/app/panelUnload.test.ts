import { describe, expect, test } from "bun:test";
import { IDLE_UNLOAD_MS, liveKeys, recordAway, recordUse, withoutIdle } from "../../src/renderer/src/components/panels/panelLru";

const key = (panel: string) => `local::${panel}`;
const [a, b, c] = [key("a"), key("b"), key("c")];

// Only a panel nobody is looking at is ever unloaded.
describe("panels out of view are unloaded", () => {
    test("the panel in view stays loaded however long it is used, and one left for the idle time is unloaded", () => {
        const opened = [a, b, c];
        let away = recordAway({}, opened, a, 1_000);
        expect(away).toEqual({ [b]: 1_000, [c]: 1_000 });
        const live = liveKeys(opened, recordUse([], opened, a), a, 25);

        const justBefore = 1_000 + IDLE_UNLOAD_MS - 1;
        expect([...withoutIdle(live, away, a, justBefore, IDLE_UNLOAD_MS)].sort()).toEqual([a, b, c]);
        const after = 1_000 + IDLE_UNLOAD_MS;
        expect([...withoutIdle(live, away, a, after, IDLE_UNLOAD_MS)]).toEqual([a]);
        // days later the one in view is still there
        expect([...withoutIdle(live, away, a, after * 1_000, IDLE_UNLOAD_MS)]).toEqual([a]);

        // going to b: it loads again and its time away is forgotten; a starts counting
        away = recordAway(away, opened, b, after);
        expect(away).toEqual({ [a]: after, [c]: 1_000 });
        expect([...withoutIdle(live, away, b, after, IDLE_UNLOAD_MS)].sort()).toEqual([a, b]);

        // a closed panel is forgotten, so opening it again starts fresh
        away = recordAway(away, [a, b], b, after + 5);
        expect(away).toEqual({ [a]: after });
    });
});
