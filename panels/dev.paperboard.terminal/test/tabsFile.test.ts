// The tabs a person has open, as tabs.json keeps them across restarts: never
// written over when unreadable, never shown changed when the change could
// not be saved, and each tab's scrollback kept with it and gone with it.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { clearWorkloads } from "./helpers/crane";
import { call, panelFiles, readBlock, runBlock, serviceState, startService, stopServices } from "./helpers/service";
import { within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let readOnly: string | null = null;
afterEach(async () => {
    if (readOnly) fs.chmodSync(readOnly, 0o755);
    readOnly = null;
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }, { id: "tab2", label: "Two" }], activeTabId: "tab1" };
const scrollback = (dir: string) => path.join(dir, "terminal-scrollback");

/** Resolves once `file` exists holding `needle`, checked on every change to its folder. */
function fileHolds(file: string, needle: string): Promise<void> {
    const holds = () => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(needle);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return within(
        `${path.basename(file)} to hold ${needle}`,
        new Promise<void>((resolve) => {
            if (holds()) return resolve();
            const watcher = fs.watch(path.dirname(file), () => {
                if (!holds()) return;
                watcher.close();
                resolve();
            });
        }),
    );
}

describe("tabs.json", () => {
    test("an unreadable file is left as it was, said, and no tab opens over it", async () => {
        const broken = '{"tabs": [{"id": "tab1", "label": "Mine"';
        const dir = await panelFiles({ "tabs.json": broken });
        await startService();
        const state = await serviceState();
        expect(state.tabsError).toContain("could not be read");
        expect(state.tabs).toEqual([]);

        await expect(call("create-tab", { label: "New" })).rejects.toThrow("could not be read");
        await expect(runBlock("new-tab", { name: "New" })).rejects.toThrow("could not be read");
        await stopServices();
        expect(fs.readFileSync(path.join(dir, "tabs.json"), "utf8")).toBe(broken);
        // no shell was started for a tab that was never opened
        expect(fs.existsSync(scrollback(dir)) ? fs.readdirSync(scrollback(dir)) : []).toEqual([]);
    });

    test("a change that could not be saved fails, and the tabs stay as they were", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        fs.chmodSync(dir, 0o555);
        readOnly = dir;

        await expect(call("rename-tab", { id: "tab1", label: "Renamed" })).rejects.toThrow("Your tabs could not be saved");
        await expect(call("reorder-tabs", { orderedIds: ["tab2", "tab1"] })).rejects.toThrow("Your tabs could not be saved");
        await expect(call("create-tab", { label: "Three" })).rejects.toThrow("Your tabs could not be saved");
        const state = await serviceState();
        expect(state.tabs.map((t: { id: string; label: string }) => `${t.id}:${t.label}`)).toEqual(["tab1:One", "tab2:Two"]);
        expect(await readBlock("tabs")).toEqual(["tab1", "tab2"]);

        // once it can be saved, the same change goes through
        fs.chmodSync(dir, 0o755);
        readOnly = null;
        await call("rename-tab", { id: "tab1", label: "Renamed" });
        expect(JSON.parse(fs.readFileSync(path.join(dir, "tabs.json"), "utf8")).tabs[0].label).toBe("Renamed");
    });
});

describe("a tab's scrollback", () => {
    test("is there again after the service restarts, and goes when the tab closes", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        await call("open-tab", { id: "tab2" });
        await runBlock("type-in-tab", { tab: "tab2", text: "echo kept-$((6*7))\n" });
        await fileHolds(path.join(scrollback(dir), "tab2.log"), "kept-42");

        await stopServices();
        await startService();
        expect(await readBlock("output", { tab: "tab2", lines: 100 })).toContain("kept-42");

        await runBlock("close-tab", { tab: "tab2" });
        expect(fs.existsSync(path.join(scrollback(dir), "tab2.log"))).toBe(false);
    });

    test("is not left behind by a tab whose shell would not start", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        await expect(call("create-tab", { label: "Odd", shell: "/bin/not-a-shell" })).rejects.toThrow("is not a shell on this computer");
        expect(fs.existsSync(scrollback(dir)) ? fs.readdirSync(scrollback(dir)) : []).toEqual([]);
    });
});
