// Tab selection is not a list mutation. Selecting an already-open panel must
// leave openedPanels reference-stable; rebuilding it reorders the keys, and
// PanelView's <For> then detaches and reinserts live iframes, flickering them.
import { expect, test } from "bun:test";
import {
    MAX_OPENED_PANELS,
    usePanels,
} from "../src/renderer/src/hooks/usePanels";

test("re-selecting an open panel does not reorder or rebuild the opened list", () => {
    const panels = usePanels();
    panels.setComputerTab("local", "panel.a");
    panels.setComputerTab("local", "panel.b");
    const before = panels.openedPanels();
    expect(before).toEqual(["local::panel.a", "local::panel.b"]);

    panels.setComputerTab("local", "panel.a");
    expect(panels.openedPanels()).toBe(before);
    expect(panels.getSelectedTab("local")).toBe("panel.a");
});

test("landing, library, and settings are never opened panels", () => {
    const panels = usePanels();
    panels.setComputerTab("local", "library");
    panels.setComputerTab("local", "settings");
    panels.setComputerTab("local", "landing");
    expect(panels.openedPanels()).toEqual([]);
});

test("the opened list is capped, and the panel just selected always survives", () => {
    const panels = usePanels();
    panels.setComputerTab("local", "panel.first");
    const first = panels.openedPanels();
    // re-selecting the first is still reference-stable
    panels.setComputerTab("local", "panel.first");
    expect(panels.openedPanels()).toBe(first);

    for (let i = 0; i < MAX_OPENED_PANELS + 5; i++) {
        panels.setComputerTab("local", `panel.p${i}`);
    }
    const opened = panels.openedPanels();
    expect(opened.length).toBe(MAX_OPENED_PANELS);
    expect(opened).toContain(`local::panel.p${MAX_OPENED_PANELS + 4}`);
});
