// panelHostLabel: a computer and a panel in one DNS label that reads back
// exactly, so a public host can serve every panel from *.<its own name>.
import { describe, test, expect } from "bun:test";
import { panelHostLabel, parsePanelHostLabel, PANEL_HOST_LABEL_MAX } from "../src/panelHost";

describe("panelHostLabel", () => {
    test("round-trips ids with every escaped character", () => {
        for (const [computerId, panelId] of [
            ["local", "dev.paperboard.ai"],
            ["remote-17-abc", "dev.paperboard.game_server"],
            ["k3m9x2qp", "a-x.b-0_c"],
        ]) {
            const label = panelHostLabel(computerId!, panelId!);
            expect(label).toMatch(/^[a-z0-9-]+$/);
            expect(parsePanelHostLabel(label)).toEqual({ computerId, panelId });
        }
    });

    test("is readable for the usual ids", () => {
        expect(panelHostLabel("k3m9x2", "dev.paperboard.terminal")).toBe("k3m9x2-xdev-1paperboard-1terminal");
    });

    test("refuses ids that don't fit one label instead of truncating", () => {
        expect(() => panelHostLabel("k3m9x2", `dev.${"a".repeat(PANEL_HOST_LABEL_MAX)}`)).toThrow(/too long/);
        expect(() => panelHostLabel("Upper", "dev.x")).toThrow();
    });

    test("rejects anything that isn't a label it made", () => {
        for (const bad of ["", "local", "local-x", "-xdev", "a-xb-xc", "a-9b-xc", "a-xb-", "A-xb", "a.b-xc"]) {
            expect(parsePanelHostLabel(bad)).toBeNull();
        }
    });
});
