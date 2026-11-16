import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { clearWorkloads } from "./helpers/crane";
import { call, panelFiles, PANEL_ID, serviceState, startService, stopServices } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const FILE = "saved-commands.json";

afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

function savedFile(dir: string): any {
    return JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
}

// The saved-commands file is never overwritten blindly.
describe("the saved-commands file is never overwritten blindly", () => {
    const unreadable: [string, string, string][] = [
        ["a file that isn't JSON", "{ not json", "Saved commands could not be read"],
        ["a document that isn't an object", JSON.stringify(["ls"]), "the saved commands file is not an object"],
        ["an unknown version", JSON.stringify({ version: 2, commands: [], lastRuns: {}, running: [] }), "the saved commands file has version 2, expected 1"],
        ["a list that isn't a list", JSON.stringify({ version: 1, commands: "ls", lastRuns: {} }), "the saved commands file has no command list"],
        ["an entry without a valid id", JSON.stringify({ version: 1, commands: [{ id: "../x", label: "x", command: "ls" }] }), "the saved commands file has an entry without a valid id"],
        ["a malformed run record", JSON.stringify({ version: 1, commands: [], running: [{ commandId: "cmd_a" }] }), "the saved commands file has a malformed run record"],
    ];
    for (const [what, content, reason] of unreadable) {
        test(`${what} is reported, Add is refused, and the file is left as it was`, async () => {
            const dir = await panelFiles({ [FILE]: content });
            await startService();
            const state = await serviceState();
            expect(state.savedCommandsError).toContain(reason);
            // unknown is not empty: nothing is offered as the list
            expect(state.savedCommands).toEqual([]);
            await expect(call.saveCommand({ label: "Build", command: "make" })).rejects.toThrow(reason);
            await expect(call.removeSavedCommand({ id: "cmd_a" })).rejects.toThrow(reason);
            await expect(call.runSavedCommand({ id: "cmd_a" })).rejects.toThrow(reason);
            expect(fs.readFileSync(path.join(dir, FILE), "utf8")).toBe(content);
        });
    }

    test("reading again keeps the error and says why while the file is still damaged, and recovers the list once it is mended", async () => {
        const dir = await panelFiles({ [FILE]: "{ not json" });
        await startService();
        expect((await serviceState()).savedCommandsError).toContain("Saved commands could not be read");

        await expect(call.reloadSavedCommands()).rejects.toThrow("Saved commands could not be read");
        expect((await serviceState()).savedCommandsError).toContain("Saved commands could not be read");
        expect(fs.readFileSync(path.join(dir, FILE), "utf8")).toBe("{ not json");

        fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ version: 1, commands: [{ id: "cmd_a", label: "Build", command: "make" }], lastRuns: {}, running: [] }));
        await call.reloadSavedCommands();
        const state = await stateWhere(PANEL_ID, (s: any) => s.savedCommands.length === 1 && s.savedCommandsError === "", "the list read again");
        expect(state.savedCommands.map((c: any) => c.label)).toEqual(["Build"]);
        // writes work again, and reading again once it is read is nothing to do
        await call.reloadSavedCommands();
        await call.saveCommand({ label: "Test", command: "make test" });
        expect(savedFile(dir).commands.map((c: any) => c.label)).toEqual(["Build", "Test"]);
    });

    test("adds and removes sent at once are applied one after another, each saved before it shows", async () => {
        const dir = await panelFiles();
        await startService();
        const ids = await Promise.all(["one", "two", "three", "four"].map((name) => call.saveCommand({ label: name, command: `echo ${name}` })));
        expect(new Set(ids).size).toBe(4);
        expect(savedFile(dir).commands.map((c: any) => c.label)).toEqual(["one", "two", "three", "four"]);
        await Promise.all([call.removeSavedCommand({ id: ids[1] }), call.saveCommand({ label: "five", command: "echo five" }), call.removeSavedCommand({ id: ids[3] })]);
        const labels = savedFile(dir).commands.map((c: any) => c.label);
        expect(labels).toEqual(["one", "three", "five"]);
        const state = await stateWhere<any>(PANEL_ID, (s) => s.savedCommands.length === 3, "the list to show three commands");
        expect(state.savedCommands.map((c: any) => c.label)).toEqual(labels);
    });

    test("a save that fails leaves the list and the file as they were", async () => {
        const dir = await panelFiles();
        await startService();
        const kept = await call.saveCommand({ label: "Keep", command: "echo keep" });
        const before = fs.readFileSync(path.join(dir, FILE), "utf8");
        // the daemon writes the file atomically beside itself: a folder it
        // can't write to fails the save
        fs.chmodSync(dir, 0o555);
        try {
            await expect(call.saveCommand({ label: "New", command: "echo new" })).rejects.toThrow(/The command was not saved: .*(EACCES|permission denied)/i);
            await expect(call.removeSavedCommand({ id: kept })).rejects.toThrow(/The command was not removed: .*(EACCES|permission denied)/i);
        } finally {
            fs.chmodSync(dir, 0o755);
        }
        expect(fs.readFileSync(path.join(dir, FILE), "utf8")).toBe(before);
        expect((await serviceState()).savedCommands.map((c: any) => c.label)).toEqual(["Keep"]);
        expect((await serviceState<{ savedCommands: any[] }>()).savedCommands.map((c) => c.id)).toEqual([kept]);
    });
});
