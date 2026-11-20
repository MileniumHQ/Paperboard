// The tabs a person has open, as tabs.json keeps them across restarts: never
// written over when unreadable, never shown changed when the change could
// not be saved, and each tab's scrollback kept with it and gone with it.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { clearWorkloads } from "./helpers/crane";
import { PANEL_ID, call, panelFiles, readBlock, runBlock, serviceState, startService, stopServices } from "./helpers/service";
import { stateWhere, until, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let readOnly: string | null = null;
let writeOnly: string | null = null;
afterEach(async () => {
    if (readOnly) fs.chmodSync(readOnly, 0o755);
    if (writeOnly) fs.chmodSync(writeOnly, 0o644);
    readOnly = null;
    writeOnly = null;
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

        await expect(call.createTab({ label: "New" })).rejects.toThrow("could not be read");
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

        await expect(call.renameTab({ id: "tab1", label: "Renamed" })).rejects.toThrow("Your tabs could not be saved");
        await expect(call.reorderTabs({ orderedIds: ["tab2", "tab1"] })).rejects.toThrow("Your tabs could not be saved");
        await expect(call.createTab({ label: "Three" })).rejects.toThrow("Your tabs could not be saved");
        const state = await serviceState();
        expect(state.tabs.map((t: { id: string; label: string }) => `${t.id}:${t.label}`)).toEqual(["tab1:One", "tab2:Two"]);
        expect(await readBlock("tabs")).toEqual(["tab1", "tab2"]);

        // once it can be saved, the same change goes through
        fs.chmodSync(dir, 0o755);
        readOnly = null;
        await call.renameTab({ id: "tab1", label: "Renamed" });
        expect(JSON.parse(fs.readFileSync(path.join(dir, "tabs.json"), "utf8")).tabs[0].label).toBe("Renamed");
    });
});

describe("a tab's scrollback", () => {
    test("is there again after the service restarts, and goes when the tab closes", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        await call.openTab({ id: "tab2" });
        await runBlock("type-in-tab", { tab: "tab2", text: "echo kept-$((6*7))\n" });
        await fileHolds(path.join(scrollback(dir), "tab2.json"), "kept-42");

        await stopServices();
        await startService();
        expect(await readBlock("output", { tab: "tab2", lines: 100 })).toContain("kept-42");

        await runBlock("close-tab", { tab: "tab2" });
        expect(fs.existsSync(path.join(scrollback(dir), "tab2.json"))).toBe(false);
    });

    test("saved as plain text, before it kept its sizes, is read, and goes with its tab", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        fs.mkdirSync(scrollback(dir), { recursive: true });
        fs.writeFileSync(path.join(scrollback(dir), "tab2.log"), "older-42\r\n$ ");
        await startService();
        expect(await readBlock("output", { tab: "tab2", lines: 100 })).toContain("older-42");

        await runBlock("close-tab", { tab: "tab2" });
        expect(fs.readdirSync(scrollback(dir))).not.toContain("tab2.log");
    });

    test("holds what the shell printed just before the service stopped", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        await call.openTab({ id: "tab1" });
        await runBlock("type-in-tab", { tab: "tab1", text: "echo last-$((6*7))\n" });
        await until("the output", () => readBlock<string>("output", { tab: "tab1", lines: 100 }), (out) => out.includes("last-42"));
        // stopped at once, while the output still waits to be written
        await stopServices();
        await startService();
        expect(await readBlock("output", { tab: "tab1", lines: 100 })).toContain("last-42");
    });

    test("that could not be read is said, and never written over", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        await call.openTab({ id: "tab1" });
        await runBlock("type-in-tab", { tab: "tab1", text: "echo kept-$((6*7))\n" });
        const file = path.join(scrollback(dir), "tab1.json");
        await fileHolds(file, "kept-42");
        await stopServices();
        // the shell runs on; its saved output can be written but not read
        const before = fs.readFileSync(file, "utf8");
        fs.chmodSync(file, 0o200);
        writeOnly = file;

        await startService();
        const said = await stateWhere<any>(PANEL_ID, (s) => Boolean(s.sessionErrors?.tab1?.scrollback), "the unreadable scrollback to be said");
        expect(said.sessionErrors.tab1.scrollback).toContain("earlier output couldn't be read");
        await call.openTab({ id: "tab1" });
        await runBlock("type-in-tab", { tab: "tab1", text: "echo new-$((6*7))\n" });
        await until("the new output", () => readBlock<string>("output", { tab: "tab1", lines: 100 }), (out) => out.includes("new-42"));
        await stopServices();
        fs.chmodSync(file, 0o644);
        writeOnly = null;
        expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    test("is not left behind by a tab whose shell would not start", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        await startService();
        await expect(call.createTab({ label: "Odd", shell: "/bin/not-a-shell" })).rejects.toThrow("is not a shell on this computer");
        expect(fs.existsSync(scrollback(dir)) ? fs.readdirSync(scrollback(dir)) : []).toEqual([]);
    });

    test("that can't be started for a new tab keeps the tab, and the state says why its shell didn't start", async () => {
        const dir = await panelFiles({ "tabs.json": TABS });
        // a new shell starts by clearing its saved screen, and this folder takes no writes
        fs.mkdirSync(scrollback(dir), { mode: 0o555 });
        readOnly = scrollback(dir);
        await startService();
        const id = await runBlock<string>("new-tab", { name: "Three" });
        expect(await readBlock("tabs")).toEqual(["tab1", "tab2", id]);
        const said = await serviceState();
        expect(said.sessionErrors[id]?.start).toContain("This shell didn't start");
    });
});
