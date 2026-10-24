// a panel frame forwards PaperUI's back swipe to its shell under its own
// generation; a widget frame, or a document the shell hasn't challenged, doesn't
import { describe, test, expect } from "bun:test";
import { SWIPE_BACK_MESSAGE, swipeBackMessage } from "../src/swipeBack";

const page = { generation: "gen-1", widget: false, computerName: null };

describe("swipe-back forwarding", () => {
    test("a panel page forwards the swipe with its generation", () => {
        expect(swipeBackMessage({ phase: "move", dx: 120, velocity: 0.2 }, page)).toEqual({
            type: SWIPE_BACK_MESSAGE, generation: "gen-1", phase: "move", dx: 120, velocity: 0.2,
        });
    });
    test("a widget, an unchallenged document, or a malformed report forwards nothing", () => {
        expect(swipeBackMessage({ phase: "end", dx: 300, velocity: 0 }, { ...page, widget: true })).toBeNull();
        expect(swipeBackMessage({ phase: "end", dx: 300, velocity: 0 }, null)).toBeNull();
        expect(swipeBackMessage({ phase: "fling", dx: 300, velocity: 0 }, page)).toBeNull();
        expect(swipeBackMessage({ phase: "end", dx: "300", velocity: 0 }, page)).toBeNull();
    });
});
