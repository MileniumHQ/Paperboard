// What the Home widgets say comes from these; the widgets only lay it out.
import { describe, expect, it } from "bun:test";
import { consoleTail, playerCount, rosterRows } from "../src/widget/view";

describe("widget view", () => {
    it("counts players against the cap only once the server told it", () => {
        expect(playerCount(3, 20).short).toBe("3/20");
        expect(playerCount(3, null).short).toBe("3");
        expect(playerCount(1, null).long).toBe("1 player online");
    });

    it("keeps the roster's last row for 'more' when players don't fit", () => {
        expect(rosterRows(["a", "b"], 5)).toEqual({ shown: ["a", "b"], more: 0 });
        expect(rosterRows(["a", "b", "c", "d", "e", "f"], 5)).toEqual({ shown: ["a", "b", "c", "d"], more: 2 });
    });

    it("tails the log with the time split off and errors marked", () => {
        const tail = consoleTail(
            [
                { type: "info", content: "[12:00:00] [Server thread/INFO]: Done (1.3s)!" },
                { type: "warn", content: "[12:00:01] [Server thread/WARN]: Can't keep up!" },
                { type: "error", content: "[12:00:02 ERROR]: Could not pass event" },
            ],
            2,
        );
        expect(tail).toEqual([
            { time: "12:00:01", text: "Can't keep up!", tone: "warn" },
            { time: "12:00:02", text: "Could not pass event", tone: "error" },
        ]);
    });
});
