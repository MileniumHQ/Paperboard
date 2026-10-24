// a panel or widget frame forwards PaperUI's haptic to its shell under its
// own generation; a document the shell hasn't challenged doesn't
import { describe, test, expect } from "bun:test";
import { HAPTIC_MESSAGE, hapticMessage } from "../src/haptics";

const page = { generation: "gen-1", widget: false, computerName: null };

describe("haptic forwarding", () => {
    test("a panel page or a widget forwards the kind with its generation", () => {
        expect(hapticMessage({ kind: "paper" }, page)).toEqual({ type: HAPTIC_MESSAGE, generation: "gen-1", kind: "paper" });
        expect(hapticMessage({ kind: "light" }, { ...page, widget: true })).toEqual({ type: HAPTIC_MESSAGE, generation: "gen-1", kind: "light" });
    });
    test("an unchallenged document or a malformed request forwards nothing", () => {
        expect(hapticMessage({ kind: "paper" }, null)).toBeNull();
        expect(hapticMessage({ kind: [500] }, page)).toBeNull();
        expect(hapticMessage({ kind: "x".repeat(33) }, page)).toBeNull();
        expect(hapticMessage(null, page)).toBeNull();
    });
});
