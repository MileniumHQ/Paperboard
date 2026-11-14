// The shell keeps a bounded list of opened panels (usePanels): past
// MAX_OPENED_PANELS the oldest is let go. A panel another computer shows is
// never the one let go: switching back to that computer shows its panel
// without selecting it again, and with no frame for it the panel area would
// be empty and silent.
//
// This runs the hook itself. The browser harness can't reach it: its
// standalone daemon tunnels to no paired computer, so a second computer
// lists no panels to open there.
import { expect, test } from "bun:test";
import { MAX_OPENED_PANELS, usePanels } from "../../src/renderer/src/hooks/usePanels";

// Inventory: Core contracts — a computer's shown panel keeps its frame however many panels are opened elsewhere.
test(`opening ${MAX_OPENED_PANELS} panels on one computer keeps the panel another computer shows`, () => {
    const panels = usePanels();
    panels.setComputerTab("workshop", "notes");
    const here = Array.from({ length: MAX_OPENED_PANELS }, (_, i) => `p${i}`);
    for (const id of here) panels.setComputerTab("local", id);

    const opened = panels.openedPanels();
    expect(opened).toHaveLength(MAX_OPENED_PANELS);
    expect(opened).toContain("workshop::notes");
    // the oldest one nobody shows went instead
    expect(opened).not.toContain("local::p0");
    expect(opened.at(-1)).toBe(`local::${here.at(-1)}`);
});
