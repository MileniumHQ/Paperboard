import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { terminalApi } from "@mileniumhq/paperapi";
import { clearWorkloads } from "./helpers/crane";
import { call, panelFiles, startService, stopServices } from "./helpers/service";
import { within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

/** Everything a shell prints from now on, and a wait for a line of it. */
function watchOutput(tabId: string) {
    let output = "";
    const waiters = new Set<() => void>();
    const off = terminalApi.onData(tabId, (data) => {
        output += data;
        for (const wake of [...waiters]) wake();
    });
    return {
        text: () => output,
        off,
        until: (needle: string) =>
            within(
                `${tabId} to print ${needle}`,
                new Promise<void>((resolve) => {
                    const wake = () => {
                        if (!output.includes(needle)) return;
                        waiters.delete(wake);
                        resolve();
                    };
                    waiters.add(wake);
                    wake();
                }),
                20_000,
                () => `${tabId} printed: ${JSON.stringify(output)}`,
            ),
    };
}

// Keystrokes never go to the wrong shell.
describe("keystrokes never go to the wrong shell", () => {
    test("an unknown or empty tab id is refused, and no shell receives the text", async () => {
        await panelFiles({
            "tabs.json": { tabs: [{ id: "tab1", label: "One" }, { id: "tab2", label: "Two" }], activeTabId: "tab2" },
        });
        await startService();
        const one = watchOutput("tab1");
        const two = watchOutput("tab2");
        try {
            await expect(call("write-to-terminal", { tabId: "tab3", text: "echo REFUSED-unknown\n" })).rejects.toThrow("Unknown terminal tab: tab3");
            // a renamed tab's old label is not its id either
            await expect(call("write-to-terminal", { tabId: "One", text: "echo REFUSED-label\n" })).rejects.toThrow("Unknown terminal tab: One");
            await expect(call("write-to-terminal", { tabId: "", text: "echo REFUSED-empty\n" })).rejects.toThrow("Terminal tab id required");
            await expect(call("write-to-terminal", { tabId: "   ", text: "echo REFUSED-blank\n" })).rejects.toThrow("Terminal tab id required");
            // no id at all is not "the active tab"
            await expect(call("write-to-terminal", { text: "echo REFUSED-none\n" })).rejects.toThrow("Terminal tab id required");
            await expect(call("read-terminal-buffer", { tabId: "tab3" })).rejects.toThrow("Unknown terminal tab: tab3");

            // each shell answers its own keystrokes, in order: a refused write
            // that had landed anyway would print before these
            await call("write-to-terminal", { tabId: "tab1", text: "echo done-$((40+1))\n" });
            await call("write-to-terminal", { tabId: "tab2", text: "echo done-$((40+2))\n" });
            await one.until("done-41");
            await two.until("done-42");
            expect(one.text()).not.toContain("REFUSED");
            expect(two.text()).not.toContain("REFUSED");
            expect(one.text()).not.toContain("done-42");
            expect(two.text()).not.toContain("done-41");
        } finally {
            one.off();
            two.off();
        }
    });
});

// A tabs.json written before tabs had names of their own keeps every tab and
// every name: a tab someone named stays named, a default "Tab N" goes by the
// program in it, and both survive the next start.
describe("saved tabs survive the move to named tabs", () => {
    test("an older tabs.json keeps its tabs, names and order across restarts", async () => {
        const dir = await panelFiles({
            "tabs.json": { tabs: [{ id: "tab1", label: "Server" }, { id: "tab2", label: "Tab 2" }], activeTabId: "tab2" },
        });
        await startService();
        const first = await call<any[]>("list-tabs");
        expect(first.map((t) => [t.id, t.label, Boolean(t.named)])).toEqual([
            ["tab1", "Server", true],
            ["tab2", "Tab 2", false],
        ]);

        await stopServices();
        const saved = JSON.parse(fs.readFileSync(path.join(dir, "tabs.json"), "utf8"));
        expect(saved.activeTabId).toBe("tab2");
        await startService();
        const again = await call<any[]>("list-tabs");
        expect(again.map((t) => [t.id, t.label, Boolean(t.named)])).toEqual([
            ["tab1", "Server", true],
            ["tab2", "Tab 2", false],
        ]);
    });
});
