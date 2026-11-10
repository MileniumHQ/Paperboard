// Terminal's blocks (Actions API v2), used the way the Blocks panel uses
// them: through the real daemon, from the service as the daemon runs it.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "@mileniumhq/paperapi";
import { clearWorkloads } from "./helpers/crane";
import { PANEL_ID, panelFiles, startService, stopServices } from "./helpers/service";
import { within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

const TABS = { tabs: [{ id: "tab1", label: "One" }, { id: "tab2", label: "Two" }], activeTabId: "tab1" };
const run = <T = unknown>(command: string, inputs: Record<string, unknown> = {}) => blocksApi.run<T>(PANEL_ID, command, inputs);
const read = <T = unknown>(value: string, inputs: Record<string, unknown> = {}) => blocksApi.read<T>(PANEL_ID, value, inputs);

/** The next payload `event` fires with, once it fires. */
function nextEvent(event: string, accept: (payload: Record<string, unknown>) => boolean = () => true) {
    let off = () => {};
    const fired = new Promise<Record<string, unknown>>((resolve) => {
        off = blocksApi.onEvent(PANEL_ID, event, (payload) => {
            if (accept(payload)) resolve(payload);
        });
    });
    return { fired: within(`${event} to fire`, fired).finally(() => off()), off };
}

/** Resolves once a fresh read of `value` passes `accept`, read again every 50 ms. */
async function readUntil<T>(value: string, inputs: Record<string, unknown>, accept: (v: T) => boolean, what: string): Promise<T> {
    const deadline = Date.now() + 20_000;
    let last: T;
    for (;;) {
        last = await read<T>(value, inputs);
        if (accept(last)) return last;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}; last read: ${JSON.stringify(last)}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

// subscriptions reach the daemon on their own; let them land before acting
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe("the Terminal's blocks", () => {
    test("registers the Tab and Saved Command types, the reads as values, and no page plumbing", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const entries = await blocksApi.list(PANEL_ID);
        expect(entries.map((b) => b.entry).sort()).toEqual([
            "command.close-tab",
            "command.new-tab",
            "command.remove-saved-command",
            "command.rename-tab",
            "command.run-in-tab",
            "command.run-saved-command",
            "command.run-shell-command",
            "command.save-command",
            "command.type-in-tab",
            "event.saved-command-finished",
            "event.terminal-exit",
            "type.saved-command",
            "type.tab",
            "value.output",
            "value.saved-commands",
            "value.tabs",
        ]);
        const schema = (entry: string) => entries.find((b) => b.entry === entry)!.schema;
        expect(schema("command.new-tab")).toMatchObject({ output: `${PANEL_ID}:tab`, category: "Tabs" });
        expect(schema("value.tabs")).toMatchObject({ type: `list<${PANEL_ID}:tab>`, changes: true });
        expect(schema("event.terminal-exit")).toMatchObject({ filters: { tab: "tab" }, values: { tab: { type: `${PANEL_ID}:tab` } } });
        expect(await read("tabs")).toEqual(["tab1", "tab2"]);
        expect(await blocksApi.property(`${PANEL_ID}:tab`, "name", "tab2")).toBe("Two");
    });

    test("a new tab is a Tab, announces the change, runs commands and shows their output; an unknown tab is refused", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        let tabsChanged = 0;
        const off = blocksApi.onChange(PANEL_ID, "tabs", () => tabsChanged++);
        try {
            await settle();
            const tab = await run<string>("new-tab", { name: "Build" });
            expect(await read("tabs")).toEqual(["tab1", "tab2", tab]);
            expect(await blocksApi.property(`${PANEL_ID}:tab`, "name", tab)).toBe("Build");
            await within("the tabs to announce the change", (async () => {
                while (tabsChanged === 0) await new Promise((resolve) => setTimeout(resolve, 20));
            })());

            expect(await run("run-in-tab", { command: "echo blocks-$((40+2))", tab })).toBeNull();
            await readUntil<string>("output", { tab, lines: 20 }, (out) => out.includes("blocks-42"), "the command's output");

            await expect(run("type-in-tab", { text: "echo REFUSED", tab: "nope" })).rejects.toThrow("Unknown terminal tab: nope");
            await expect(read("output", { tab: "nope", lines: 5 })).rejects.toThrow("Unknown terminal tab: nope");
            await expect(read("output", { tab, lines: 0 })).rejects.toThrow('"Lines" must be at least 1');
            await expect(blocksApi.property(`${PANEL_ID}:tab`, "name", "nope")).rejects.toThrow("Unknown terminal tab: nope");

            await run("rename-tab", { tab, name: "Deploy" });
            expect(await blocksApi.property(`${PANEL_ID}:tab`, "name", tab)).toBe("Deploy");
            await run("close-tab", { tab });
            expect(await read("tabs")).toEqual(["tab1", "tab2"]);
        } finally {
            off();
        }
    });

    test("a shell that exits fires When a Tab's Shell Ends with how it ended", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const ended = nextEvent("terminal-exit", (p) => p.tab === "tab2");
        try {
            await settle();
            await run("run-in-tab", { command: "exit 3", tab: "tab2" });
            expect(await ended.fired).toEqual({ tab: "tab2", succeeded: false, result: "Exit 3" });
        } finally {
            ended.off();
        }
    });

    test("a saved command is a Saved Command with its fields, and its run's end fires with the outcome", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const command = await run<string>("save-command", { command: "exit 0", name: "Check" });
        expect(await read("saved-commands")).toEqual([command]);
        const type = `${PANEL_ID}:saved-command`;
        expect(await blocksApi.property(type, "name", command)).toBe("Check");
        expect(await blocksApi.property(type, "command", command)).toBe("exit 0");

        const finished = nextEvent("saved-command-finished");
        try {
            await settle();
            expect(await run("run-saved-command", { command })).toBeNull();
            expect(await finished.fired).toEqual({ command, succeeded: true, result: "Exit 0" });
        } finally {
            finished.off();
        }
        expect(await blocksApi.property(type, "running", command)).toBe(false);

        await run("remove-saved-command", { command });
        expect(await read("saved-commands")).toEqual([]);
        await expect(blocksApi.property(type, "name", command)).rejects.toThrow(`No saved command "${command}"`);
        await expect(run("run-saved-command", { command })).rejects.toThrow(`No saved command "${command}"`);
    });

    test("Run Shell Command gives back what the command printed", async () => {
        await panelFiles({});
        await startService();
        expect((await run<string>("run-shell-command", { command: "echo shell-$((6*7))" })).trim()).toBe("shell-42");
        await expect(run("run-shell-command", {})).rejects.toThrow('"Command" is required');
    });
});
