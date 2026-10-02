// write-path failure surfacing (bun test): a session that could not be
// created must make write-to-terminal FAIL with a typed error — keystrokes
// vanishing while the action reports true is silent data loss
import { describe, it, expect, afterAll } from "bun:test";
import { writeToTerminal, __terminalTestState } from "../src/service";

afterAll(() => {
    __terminalTestState().clearTabsForTest();
});

describe("writeToTerminal refuses on missing sessions", () => {
    it("requires a known tab id", async () => {
        await expect(
            writeToTerminal(null as any, { tabId: "tab_ghost", text: "hi" }),
        ).rejects.toThrow(/Unknown terminal tab/);
    });

    it("refuses with a typed error when the session could not be created", async () => {
        // no transport in the unit test: create() rejects, so the session
        // is NOT live and the write must fail loudly instead of returning true
        __terminalTestState().registerTabForTest("tab_write_test");
        if (!__terminalTestState().tabIds().includes("tab_write_test")) {
            throw new Error("test seed failed");
        }
        await expect(
            writeToTerminal(null as any, { tabId: "tab_write_test", text: "do-not-lose" }),
        ).rejects.toThrow(/could not be created/);
    });
});

// trash-first close (bun test): the irrecoverable delete happens only
// after a copy — the trashed name is a sibling of the live file, never its
// replacement
import { trashScrollbackName } from "../src/service";

describe("trashScrollbackName", () => {
    it("derives a .trash sibling name from the live scrollback", () => {
        expect(trashScrollbackName("tab1", 1700000000000)).toBe(
            ".trash-1700000000000-tab1.log",
        );
    });

    it("never equals the live path and always carries the id", () => {
        const name = trashScrollbackName("tab_live");
        expect(name).not.toBe("terminal-scrollback/tab_live.log");
        expect(name).toContain("tab_live");
        expect(name.startsWith(".trash-")).toBe(true);
    });
});

// open-tab is how the panel shows a session. A shell that could not start
// (every Windows terminal, when the crane could not load conpty) must fail
// the open with the daemon's reason; it used to return an empty scrollback
// and leave a blank terminal with no explanation.
describe("open-tab reports a session that could not start", () => {
    it("rejects instead of returning an empty scrollback", async () => {
        __terminalTestState().registerTabForTest("tab_open_test");
        const openTab = __terminalTestState().actionForTest("open-tab") as any;
        const ctx = { emit: () => {}, broadcast: () => {} } as any;
        await expect(openTab.run(ctx, { id: "tab_open_test" })).rejects.toThrow();
    });
});
