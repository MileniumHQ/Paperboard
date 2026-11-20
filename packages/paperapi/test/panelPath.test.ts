// panelPath: a host serving the shell and panels from one origin gives each
// panel a folder, and reads the folder back exactly.
import { describe, test, expect } from "bun:test";
import { panelPath, parsePanelPath } from "../src/panelPath";

describe("panelPath", () => {
    test("isn't a panel's without both ids and the folder's slash", () => {
        for (const path of ["/", "/_panel/", "/_panel/k3m9x2", "/_panel/k3m9x2/dev.paperboard.agents", "/_panel//dev.paperboard.agents/", "/_panel/k3m9x2/settings/", "/_panel/k3m9x2/Bad/", "/assets/x.js"]) {
            expect(parsePanelPath(path)).toBeNull();
        }
    });

    test("refuses ids that would escape their segment", () => {
        expect(() => panelPath("../x", "dev.paperboard.agents")).toThrow();
        expect(() => panelPath("k3m9x2", "a/b")).toThrow();
        expect(() => panelPath("", "dev.paperboard.agents")).toThrow();
    });
});
