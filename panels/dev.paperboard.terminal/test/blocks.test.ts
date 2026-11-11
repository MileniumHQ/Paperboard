// Terminal's blocks (Actions API v2), used the way the Blocks panel uses
// them: through the real daemon, from the service as the daemon runs it.
import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { blocksApi } from "@mileniumhq/paperapi";
import { clearWorkloads, testDaemon } from "./helpers/crane";
import { PANEL_ID, call, panelFiles, serviceState, startService, stopServices } from "./helpers/service";
import { within } from "./helpers/wait";
import { runShellCommand } from "../src/lib/shellCommand";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-blocks-"));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

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
            "command.move-tab",
            "command.new-tab",
            "command.remove-saved-command",
            "command.rename-tab",
            "command.run-in-tab",
            "command.run-saved-command",
            "command.run-shell-command",
            "command.save-command",
            "command.show-tab",
            "command.split-tab",
            "command.stop-saved-command",
            "command.type-in-tab",
            "command.unsplit-tab",
            "event.command-finished",
            "event.saved-command-finished",
            "event.tab-closed",
            "event.tab-opened",
            "event.terminal-exit",
            "type.saved-command",
            "type.tab",
            "value.active-tab",
            "value.output",
            "value.saved-commands",
            "value.tabs",
        ]);
        const schema = (entry: string) => entries.find((b) => b.entry === entry)!.schema;
        expect(schema("command.new-tab")).toMatchObject({ output: `${PANEL_ID}:tab`, category: "Tabs" });
        expect(schema("value.tabs")).toMatchObject({ type: `list<${PANEL_ID}:tab>`, changes: true });
        expect(schema("value.active-tab")).toMatchObject({ type: `${PANEL_ID}:tab`, changes: true });
        expect(schema("event.tab-closed")).toMatchObject({ filters: { tab: "tab" }, values: { tab: { type: `${PANEL_ID}:tab` }, name: { type: "text" } } });
        expect(schema("event.terminal-exit")).toMatchObject({ filters: { tab: "tab" }, values: { tab: { type: `${PANEL_ID}:tab` } } });
        expect(await read("tabs")).toEqual(["tab1", "tab2"]);
        expect(await blocksApi.property(`${PANEL_ID}:tab`, "name", "tab2")).toBe("Two");
    });

    test("a tab says the program in front, its folder and each command; it opens in a folder and splits", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const folder = fs.mkdtempSync(path.join(work, "here "));
        await expect(run("new-tab", { name: "Nowhere", folder: path.join(work, "missing") })).rejects.toThrow("is not a folder on this computer");
        await expect(call("create-tab", { label: "Odd", shell: "/bin/not-a-shell" })).rejects.toThrow("/bin/not-a-shell is not a shell on this computer");
        // an installed program that isn't one of the computer's shells is refused too
        await expect(call("create-tab", { label: "Odd", shell: process.execPath })).rejects.toThrow(`${process.execPath} is not a shell on this computer`);
        // the test daemon's shell is a plain sh, which marks nothing: bash does
        const tab = await call<string>("create-tab", { label: "Here", cwd: folder, shell: "/bin/bash" });
        const property = (field: string) => blocksApi.property(`${PANEL_ID}:tab`, field, tab);
        const until = async (field: string, accept: (v: unknown) => boolean) => {
            const deadline = Date.now() + 20_000;
            for (;;) {
                const value = await property(field);
                if (accept(value)) return value;
                if (Date.now() > deadline) throw new Error(`Timed out waiting for the tab's ${field}; last: ${JSON.stringify(value)}`);
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        };
        expect(await until("folder", (v) => v === folder)).toBe(folder);
        await within("bash to say its folder", (async () => {
            while ((await serviceState()).live?.[tab]?.cwd !== folder) await new Promise((resolve) => setTimeout(resolve, 50));
        })());
        const shell = await until("program", (v) => typeof v === "string" && v.length > 0);

        const failed = nextEvent("command-finished", (p) => p.tab === tab && p.command === "sh -c 'exit 4'");
        await settle();
        await run("run-in-tab", { command: "sh -c 'exit 4'", tab });
        expect(await failed.fired).toEqual({ tab, command: "sh -c 'exit 4'", succeeded: false, "exit-code": 4, result: "Exit 4" });

        await run("run-in-tab", { command: "sleep 3", tab });
        await until("program", (v) => v === "sleep");
        await until("program", (v) => v === shell);

        expect(await property("split")).toBe(false);
        await expect(run("unsplit-tab", { tab })).rejects.toThrow("Here is not split");
        await run("split-tab", { tab, direction: "down" });
        expect(await property("split")).toBe(true);
        await expect(run("split-tab", { tab, direction: "right" })).rejects.toThrow("Here is split already");
        const split = (await serviceState()).tabs.find((t: any) => t.id === tab).split;
        expect(split).toMatchObject({ direction: "down", session: { cwd: folder } });
        // the second shell is a shell of its own, in the first one's folder
        await within("the split's shell", (async () => {
            while (!(await serviceState()).live?.[split.session.id]?.cwd) await new Promise((resolve) => setTimeout(resolve, 50));
        })());
        expect((await serviceState()).live[split.session.id].cwd).toBe(folder);
        await run("unsplit-tab", { tab });
        expect(await property("split")).toBe(false);
        expect(fs.existsSync(path.join(work, "missing"))).toBe(false);
        await run("close-tab", { tab });
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

    test("a tab opening and closing fires its event with the tab and its name", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const opened = nextEvent("tab-opened");
        let tab: string;
        try {
            await settle();
            tab = await run<string>("new-tab", { name: "Logs" });
            expect(await opened.fired).toEqual({ tab, name: "Logs" });
        } finally {
            opened.off();
        }
        const closed = nextEvent("tab-closed", (p) => p.tab === tab);
        try {
            await settle();
            await run("close-tab", { tab });
            expect(await closed.fired).toEqual({ tab, name: "Logs" });
        } finally {
            closed.off();
        }
    });

    test("Show Tab makes a tab the Active Tab and asks the windows to show it; Move Tab puts it in its place", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        expect(await read("active-tab")).toBe("tab1");
        let activeChanged = 0;
        const off = blocksApi.onChange(PANEL_ID, "active-tab", () => activeChanged++);
        try {
            await settle();
            await run("show-tab", { tab: "tab2" });
            expect(await read("active-tab")).toBe("tab2");
            const first = (await serviceState()).showTab;
            expect(first.id).toBe("tab2");
            expect(first.request).not.toBe("");
            // showing it again is a new request, which every window follows again
            await run("show-tab", { tab: "tab2" });
            expect((await serviceState()).showTab.request).not.toBe(first.request);
            await within("the Active Tab to announce the change", (async () => {
                while (activeChanged === 0) await new Promise((resolve) => setTimeout(resolve, 20));
            })());
            await expect(run("show-tab", { tab: "nope" })).rejects.toThrow("Unknown terminal tab: nope");
            expect(await read("active-tab")).toBe("tab2");
        } finally {
            off();
        }

        const third = await run<string>("new-tab", { name: "Three" });
        await run("move-tab", { tab: third, position: 1 });
        expect(await read("tabs")).toEqual([third, "tab1", "tab2"]);
        await run("move-tab", { tab: third, position: 3 });
        expect(await read("tabs")).toEqual(["tab1", "tab2", third]);
        await expect(run("move-tab", { tab: "tab1", position: 4 })).rejects.toThrow("Position 4 is past the last tab; there are 3 tabs");
        await expect(run("move-tab", { tab: "tab1", position: 0 })).rejects.toThrow('"Position" must be at least 1');
        await expect(run("move-tab", { tab: "nope", position: 1 })).rejects.toThrow("Unknown terminal tab: nope");
        expect(await read("tabs")).toEqual(["tab1", "tab2", third]);

        // the order and the Active Tab are kept for the next service
        await stopServices();
        await startService();
        expect(await read("tabs")).toEqual(["tab1", "tab2", third]);
        expect(await read("active-tab")).toBe(third);
    });

    test("a shell that exits fires When a Tab's Shell Ends with how it ended", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        const ended = nextEvent("terminal-exit", (p) => p.tab === "tab2");
        try {
            await settle();
            await run("run-in-tab", { command: "exit 3", tab: "tab2" });
            expect(await ended.fired).toEqual({ tab: "tab2", succeeded: false, "exit-code": 3, result: "Exit 3" });
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
        expect(await blocksApi.property(type, "last-result", command)).toBe("Not run yet");
        expect(await blocksApi.property(type, "last-exit-code", command)).toBeNull();

        const finished = nextEvent("saved-command-finished");
        try {
            await settle();
            expect(await run("run-saved-command", { command })).toBeNull();
            expect(await finished.fired).toEqual({ command, succeeded: true, "exit-code": 0, result: "Exit 0" });
        } finally {
            finished.off();
        }
        expect(await blocksApi.property(type, "running", command)).toBe(false);
        expect(await blocksApi.property(type, "last-result", command)).toBe("Exit 0");
        expect(await blocksApi.property(type, "last-exit-code", command)).toBe(0);
        await expect(run("stop-saved-command", { command })).rejects.toThrow('"Check" is not running');

        await run("remove-saved-command", { command });
        expect(await read("saved-commands")).toEqual([]);
        await expect(blocksApi.property(type, "name", command)).rejects.toThrow(`No saved command "${command}"`);
        await expect(run("run-saved-command", { command })).rejects.toThrow(`No saved command "${command}"`);
    });

    test("Stop Saved Command ends a run, which reads as Stopped and stays that way", async () => {
        await panelFiles({ "tabs.json": TABS });
        await startService();
        // runs until the test lets it go; the stop must end it first
        const gate = path.join(work, "held.go");
        const command = await run<string>("save-command", { command: `while [ ! -e '${gate}' ]; do sleep 0.05; done; exit 0`, name: "Held" });
        const type = `${PANEL_ID}:saved-command`;
        await run("run-saved-command", { command });
        expect(await blocksApi.property(type, "running", command)).toBe(true);
        expect(await blocksApi.property(type, "last-result", command)).toBe("Running");
        expect(await blocksApi.property(type, "last-exit-code", command)).toBeNull();

        const finished = nextEvent("saved-command-finished", (p) => p.command === command);
        try {
            await settle();
            expect(await run("stop-saved-command", { command })).toBeNull();
            // it waited for the end: the run is over when the block is done
            expect(await blocksApi.property(type, "running", command)).toBe(false);
            expect(await blocksApi.property(type, "last-result", command)).toBe("Stopped");
            expect(await finished.fired).toEqual({ command, succeeded: false, "exit-code": null, result: "Stopped" });
        } finally {
            finished.off();
            fs.writeFileSync(gate, "");
        }
        await expect(run("stop-saved-command", { command })).rejects.toThrow('"Held" is not running');
        await expect(run("stop-saved-command", { command: "cmd_nope" })).rejects.toThrow('No saved command "cmd_nope"');

        await stopServices();
        await startService();
        expect(await blocksApi.property(type, "last-result", command)).toBe("Stopped");
        expect(await blocksApi.property(type, "last-exit-code", command)).toBeNull();
    });

    test("Run Shell Command gives back what the command printed to stdout, and nothing it printed to stderr", async () => {
        await panelFiles({});
        await startService();
        expect(await run<string>("run-shell-command", { command: "echo shell-$((6*7))" })).toBe("shell-42");
        expect(await run<string>("run-shell-command", { command: "printf 'one\\ntwo\\n'; echo warned >&2" })).toBe("one\ntwo");
        // a successful command that only writes to stderr gives back nothing, not its stderr
        expect(await run<string>("run-shell-command", { command: "echo progress >&2" })).toBe("");
        expect(await run<string>("run-shell-command", { command: "(echo folded >&2) 2>&1" })).toBe("folded");
        await expect(run("run-shell-command", {})).rejects.toThrow('"Command" is required');
    });

    test("Run Shell Command fails on a non-zero exit with the code and the tail of what it printed", async () => {
        await panelFiles({});
        await startService();
        // stderr is the reason; stdout is left out of it
        await expect(run("run-shell-command", { command: "echo partial; echo boom >&2; exit 3" })).rejects.toThrow(
            '"echo partial; echo boom >&2; exit 3" failed with exit code 3:\nboom',
        );
        // with nothing on stderr, stdout is the reason
        await expect(run("run-shell-command", { command: "echo only-stdout; exit 1" })).rejects.toThrow("failed with exit code 1:\nonly-stdout");
        await expect(run("run-shell-command", { command: "exit 7" })).rejects.toThrow('"exit 7" failed with exit code 7 and printed nothing');
        // only the last lines of a long failure
        const err = await run("run-shell-command", { command: "for i in $(seq 1 50); do echo line-$i >&2; done; exit 2" }).then(
            () => null,
            (e: Error) => e,
        );
        expect(err?.message).toContain("failed with exit code 2:\nline-41\n");
        expect(err?.message).toContain("line-50");
        expect(err?.message).not.toContain("line-40\n");
    });

    test("Run Shell Command stops a command that runs past its timeout and fails saying so", async () => {
        await panelFiles({});
        await testDaemon();
        await expect(runShellCommand("sleep 30", 500)).rejects.toThrow('"sleep 30" was still running after 0.5 seconds, so it was stopped');
    });
});
