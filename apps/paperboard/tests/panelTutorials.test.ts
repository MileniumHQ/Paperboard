// Seen tutorials (bun test): a never-saved record is nothing seen, a
// damaged one is reported instead of read as empty, and the record stays bounded.
import { describe, it, expect } from "bun:test";
import {
    MAX_SEEN_TUTORIALS,
    PANEL_TUTORIALS_VERSION,
    parsePanelTutorials,
    withSeen,
    withSeenTutorial,
} from "../src/renderer/src/lib/panelTutorials";

describe("panel tutorial record", () => {
    it("reads a missing record as nothing seen and a stored one as written", () => {
        expect(parsePanelTutorials(null)).toEqual({ panels: [], app: false });
        expect(parsePanelTutorials({ version: PANEL_TUTORIALS_VERSION, seen: ["dev.paperboard.terminal"] }))
            .toEqual({ panels: ["dev.paperboard.terminal"], app: false });
        expect(parsePanelTutorials({ version: PANEL_TUTORIALS_VERSION, seen: [], app: true }))
            .toEqual({ panels: [], app: true });
    });

    it("refuses a damaged record instead of treating it as empty", () => {
        expect(() => parsePanelTutorials({ seen: [] })).toThrow(/version/);
        expect(() => parsePanelTutorials({ version: PANEL_TUTORIALS_VERSION, seen: ["../x"] })).toThrow(/panel id/);
        expect(() => parsePanelTutorials([])).toThrow(/object/);
        expect(() => parsePanelTutorials({ version: PANEL_TUTORIALS_VERSION, seen: [], app: "yes" })).toThrow(/app flag/);
    });

    it("moves a re-seen panel to newest and forgets the oldest past the cap", () => {
        expect(withSeenTutorial(["a", "b"], "a")).toEqual(["b", "a"]);
        const full = Array.from({ length: MAX_SEEN_TUTORIALS }, (_, i) => `p${i}`);
        const next = withSeenTutorial(full, "new");
        expect(next.length).toBe(MAX_SEEN_TUTORIALS);
        expect(next[0]).toBe("p1");
        expect(next.at(-1)).toBe("new");
    });

    it("records Paperboard's own tutorial apart from the panels'", () => {
        const seen = { panels: ["dev.paperboard.terminal"], app: false };
        expect(withSeen(seen, "app")).toEqual({ panels: ["dev.paperboard.terminal"], app: true });
        expect(withSeen(seen, { panelId: "dev.paperboard.ai" }))
            .toEqual({ panels: ["dev.paperboard.terminal", "dev.paperboard.ai"], app: false });
    });
});
