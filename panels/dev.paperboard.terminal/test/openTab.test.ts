import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { call, panelFiles, runBlock, startService, stopServices } from "./helpers/service";
import { until } from "./helpers/wait";

setDefaultTimeout(90_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = {
    tabs: [
        { id: "tab1", label: "One" },
        { id: "tab2", label: "Two" },
        { id: "tab3", label: "Three" },
    ],
    activeTabId: "tab1",
};

// A tab's shell can be asked for by two at once: the window opening its
// screen and a block typing into it. Both get the one shell.
describe("a shell asked for twice at once", () => {
    test("starts once, and both the opening and the keystrokes reach it", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const outcomes = await Promise.allSettled([
            call.openTab({ id: "tab2", cols: 80, rows: 24 }),
            runBlock("type-in-tab", { tab: "tab2", text: "printf 'both-%s\\n' $((6*7))\n" }),
        ]);
        expect(outcomes.map((o) => (o.status === "rejected" ? String(o.reason) : "ok"))).toEqual(["ok", "ok"]);
        await until("the keystrokes' output in the tab's screen", () => call.openTab({ id: "tab2", cols: 80, rows: 24 }), (screen) => screen.some((run) => run.text.includes("both-42")));
    });
});
