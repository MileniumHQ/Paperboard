import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { clearWorkloads } from "./helpers/crane";
import { call, panelFiles, runBlock, startService, stopServices } from "./helpers/service";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

// A tab the daemon refuses to start a shell for: its id is longer than the
// 128 characters a session id may be (a tabs.json from elsewhere), so every
// create, probe and attach for it is refused with the daemon's reason.
const REFUSED = "t".repeat(140);
const DAEMON_REASON = 'Parameter "id" exceeds 128 characters';
const TABS = { tabs: [{ id: "tab1", label: "Works" }, { id: REFUSED, label: "Refused" }], activeTabId: REFUSED };

// Failures are shown.
describe("failures are shown", () => {
    test("a write into a session that couldn't be created and an open that failed reject with the daemon's reason", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const write = runBlock("type-in-tab", { tab: REFUSED, text: "echo hi\n" });
        await expect(write).rejects.toThrow(`Terminal session "${REFUSED}" could not be created; keystrokes were not sent:`);
        await expect(write).rejects.toThrow(DAEMON_REASON);
        await expect(call.openTab({ id: REFUSED, cols: 80, rows: 24 })).rejects.toThrow(DAEMON_REASON);
        // the other tab is unaffected
        expect(Array.isArray(await call.openTab({ id: "tab1", cols: 80, rows: 24 }))).toBe(true);
    });

});
