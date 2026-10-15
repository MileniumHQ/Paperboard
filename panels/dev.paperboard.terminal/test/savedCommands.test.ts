// Saved commands (Home's Pinned command widget): the service owns the list,
// refuses what it does not hold, and reports a run's outcome only from the
// exit the daemon reported.
import { describe, it, expect, afterEach } from "bun:test";
import {
    SavedCommands,
    MAX_SAVED_COMMANDS,
    MAX_CONCURRENT_RUNS,
    MAX_COMMAND_LENGTH,
    parseSavedCommandsDoc,
    type SavedCommandsDoc,
    type SavedCommandsView,
} from "../src/lib/savedCommands";
import { describeRun, runErrorStands } from "../src/lib/runStatus";

interface Harness {
    store: SavedCommands;
    saved: SavedCommandsDoc[];
    started: { procId: string; command: string }[];
    killed: string[];
    views: SavedCommandsView[];
    exit(procId: string, code?: number): void;
    exitListeners: Map<string, (code?: number) => void>;
    failSave: { on: boolean };
}

const live: SavedCommands[] = [];

function harness(opts: {
    load?: () => Promise<unknown>;
    startFails?: boolean;
    timeoutMs?: number;
    graceMs?: number;
} = {}): Harness {
    const saved: SavedCommandsDoc[] = [];
    const started: { procId: string; command: string }[] = [];
    const killed: string[] = [];
    const views: SavedCommandsView[] = [];
    const exitListeners = new Map<string, (code?: number) => void>();
    const failSave = { on: false };
    let n = 0;
    const store = new SavedCommands({
        load: opts.load ?? (async () => null),
        save: async (doc) => {
            if (failSave.on) throw new Error("disk full");
            saved.push(structuredClone(doc));
        },
        start: async (procId, command) => {
            if (opts.startFails) throw new Error("spawn refused");
            started.push({ procId, command });
        },
        onExit: (procId, cb) => {
            exitListeners.set(procId, cb);
            return () => exitListeners.delete(procId);
        },
        kill: async (procId) => {
            killed.push(procId);
        },
        publish: (view) => views.push(view),
        newId: () => `cmd_t${++n}`,
        timeoutMs: opts.timeoutMs,
        graceMs: opts.graceMs,
    });
    live.push(store);
    return {
        store,
        saved,
        started,
        killed,
        views,
        exitListeners,
        failSave,
        exit: (procId, code) => exitListeners.get(procId)?.(code),
    };
}

afterEach(async () => {
    for (const store of live.splice(0)) await store.dispose();
});

const lastView = (h: Harness) => h.views[h.views.length - 1];

describe("saved commands list", () => {
    it("offers saved commands as the widget's choices and persists them", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("Pull", "git pull --rebase");
        expect(h.store.choices()).toEqual([{ value: id, label: "Pull" }]);
        expect(h.saved.at(-1)?.commands).toEqual([{ id, label: "Pull", command: "git pull --rebase" }]);
        expect(lastView(h).savedCommands.map((c) => c.id)).toEqual([id]);
    });

    it("treats an unreadable file as unknown, never empty: no choices, no writes", async () => {
        const h = harness({ load: async () => { throw new Error("EIO"); } });
        await h.store.init();
        expect(lastView(h).savedCommandsError).toContain("EIO");
        expect(() => h.store.choices()).toThrow(/could not be read/);
        await expect(h.store.add("x", "true")).rejects.toThrow(/could not be read/);
        expect(h.saved).toEqual([]);
    });

    it("refuses a document it did not write instead of overwriting it", () => {
        expect(() => parseSavedCommandsDoc({ version: 99, commands: [] })).toThrow(/version/);
        expect(() => parseSavedCommandsDoc({ version: 1, commands: "nope" })).toThrow();
    });

    it("is bounded in count and length", async () => {
        const h = harness();
        await h.store.init();
        await expect(h.store.add("big", "x".repeat(MAX_COMMAND_LENGTH + 1))).rejects.toThrow(/at most/);
        await expect(h.store.add("blank", "   ")).rejects.toThrow(/required/);
        for (let i = 0; i < MAX_SAVED_COMMANDS; i++) await h.store.add(`c${i}`, "true");
        await expect(h.store.add("one too many", "true")).rejects.toThrow(/at most/);
    });

    it("rolls back an add whose save failed", async () => {
        const h = harness();
        await h.store.init();
        h.failSave.on = true;
        await expect(h.store.add("Pull", "git pull")).rejects.toThrow(/not saved/);
        expect(h.store.choices()).toEqual([]);
    });
});

describe("running a saved command", () => {
    it("reports running until the observed exit, then that exit code", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("Fails", "exit 3");
        await h.store.run(id);
        // the user's text is handed to the spawner as is, as one value
        expect(h.started).toEqual([{ procId: expect.stringContaining(id), command: "exit 3" }]);
        expect(lastView(h).commandRuns[id]?.state).toBe("running");
        h.exit(h.started[0].procId, 3);
        const run = lastView(h).commandRuns[id];
        expect(run).toMatchObject({ state: "exited", exitCode: 3 });
        expect(describeRun(run, Date.now()).tone).toBe("danger");
        await Bun.sleep(1); // the outcome is written after it is shown
        expect(h.saved.at(-1)?.lastRuns[id]).toMatchObject({ state: "exited", exitCode: 3 });
        expect(h.store.liveCount()).toBe(0);
    });

    it("refuses an unknown or removed command", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("Gone", "true");
        await h.store.remove(id);
        await expect(h.store.run(id)).rejects.toThrow(/No saved command/);
        expect(h.started).toEqual([]);
        expect(lastView(h).savedCommands).toEqual([]);
        expect(() => h.store.choices()).not.toThrow();
        expect(h.store.choices()).toEqual([]);
    });

    it("leaves no running state when the daemon refuses the spawn", async () => {
        const h = harness({ startFails: true });
        await h.store.init();
        const id = await h.store.add("x", "true");
        await expect(h.store.run(id)).rejects.toThrow(/could not start: spawn refused/);
        expect(lastView(h).commandRuns[id]).toBeUndefined();
        expect(h.store.liveCount()).toBe(0);
        expect(h.exitListeners.size).toBe(0);
    });

    it("runs one copy per command and a bounded number at once", async () => {
        const h = harness();
        await h.store.init();
        const ids: string[] = [];
        for (let i = 0; i <= MAX_CONCURRENT_RUNS; i++) ids.push(await h.store.add(`c${i}`, "sleep 5"));
        await h.store.run(ids[0]);
        await expect(h.store.run(ids[0])).rejects.toThrow(/already running/);
        for (let i = 1; i < MAX_CONCURRENT_RUNS; i++) await h.store.run(ids[i]);
        await expect(h.store.run(ids[MAX_CONCURRENT_RUNS])).rejects.toThrow(/at once/);
    });

    it("kills a run past its timeout and never reports the kill as an exit code", async () => {
        const h = harness({ timeoutMs: 5, graceMs: 1000 });
        await h.store.init();
        const id = await h.store.add("slow", "sleep 100");
        await h.store.run(id);
        await Bun.sleep(20);
        expect(h.killed).toEqual([h.started[0].procId]);
        expect(lastView(h).commandRuns[id]?.state).toBe("running");
        // a signalled child can come back as code 0; it is still a timeout
        h.exit(h.started[0].procId, 0);
        const run = lastView(h).commandRuns[id];
        expect(run?.state).toBe("timed-out");
        expect(describeRun(run, Date.now()).tone).not.toBe("success");
    });

    it("says it lost the run when no exit arrives after the kill", async () => {
        const h = harness({ timeoutMs: 5, graceMs: 5 });
        await h.store.init();
        const id = await h.store.add("stuck", "sleep 100");
        await h.store.run(id);
        await Bun.sleep(40);
        expect(lastView(h).commandRuns[id]).toMatchObject({ state: "failed" });
        expect(h.store.liveCount()).toBe(0);
    });
});

describe("describeRun", () => {
    it("shows success only for an observed exit 0", () => {
        const now = 1_000_000;
        expect(describeRun(undefined, now).tone).toBe("idle");
        expect(describeRun({ state: "running", startedAt: now }, now).text).toBe("Running…");
        expect(describeRun({ state: "exited", startedAt: 0, endedAt: now, exitCode: 0 }, now)).toMatchObject({
            tone: "success",
            text: "Exit 0 · just now",
            value: "Exit 0",
            caption: "just now",
        });
        expect(describeRun({ state: "timed-out", startedAt: 0, endedAt: now }, now).value).toBe("Timed out");
    });
});

// the Pinned command widget keeps a failed press's error while the command's
// run is still the one the press started from (runErrorStands)
describe("a failed press's error", () => {
    it("survives the refused spawn's publishes and unrelated state", async () => {
        const h = harness({ startFails: true });
        await h.store.init();
        const id = await h.store.add("x", "true");
        const pressedFrom = lastView(h).commandRuns[id];
        await expect(h.store.run(id)).rejects.toThrow(/could not start/);
        await h.store.add("other", "true");
        expect(runErrorStands(pressedFrom, lastView(h).commandRuns[id])).toBe(true);
    });

    it("clears once the run that blocked it settles", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("x", "sleep 5");
        await h.store.run(id);
        const pressedFrom = lastView(h).commandRuns[id];
        await expect(h.store.run(id)).rejects.toThrow(/already running/);
        expect(runErrorStands(pressedFrom, lastView(h).commandRuns[id])).toBe(true);
        h.exit(h.started[0].procId, 0);
        expect(runErrorStands(pressedFrom, lastView(h).commandRuns[id])).toBe(false);
    });
});
