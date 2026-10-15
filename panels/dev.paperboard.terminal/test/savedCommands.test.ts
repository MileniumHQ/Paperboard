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
    alive: Set<string>;
}

const live: SavedCommands[] = [];

function harness(opts: {
    load?: () => Promise<unknown>;
    startFails?: boolean;
    timeoutMs?: number;
    graceMs?: number;
    /** children the daemon already has (a restarted service finds them) */
    alive?: Set<string>;
    now?: () => number;
    /** runs before each save; may delay or reject it */
    beforeSave?: (doc: SavedCommandsDoc) => Promise<void>;
} = {}): Harness {
    const alive = opts.alive ?? new Set<string>();
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
            await opts.beforeSave?.(doc);
            if (failSave.on) throw new Error("disk full");
            saved.push(structuredClone(doc));
        },
        start: async (procId, command) => {
            if (opts.startFails) throw new Error("spawn refused");
            started.push({ procId, command });
            alive.add(procId);
        },
        onExit: (procId, cb) => {
            exitListeners.set(procId, cb);
            return () => exitListeners.delete(procId);
        },
        kill: async (procId) => {
            killed.push(procId);
            alive.delete(procId);
        },
        exists: async (procId) => alive.has(procId),
        publish: (view) => views.push(view),
        newId: () => `cmd_t${++n}`,
        now: opts.now,
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
        alive,
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

describe("concurrent changes to the list", () => {
    it("a failed add does not take a concurrent add down with it", async () => {
        let release!: () => void;
        const firstSave = new Promise<void>((resolve) => { release = resolve; });
        let saves = 0;
        const h = harness({
            beforeSave: async () => {
                // the first save (add A) hangs, then fails; the second must wait its turn
                if (saves++ === 0) {
                    await firstSave;
                    throw new Error("disk full");
                }
            },
        });
        await h.store.init();
        const a = h.store.add("A", "echo a");
        const b = h.store.add("B", "echo b");
        release();
        await expect(a).rejects.toThrow("not saved");
        const idB = await b;
        expect(h.store.choices()).toEqual([{ value: idB, label: "B" }]);
        expect(h.saved.at(-1)?.commands.map((c) => c.id)).toEqual([idB]);
    });

    it("a failed remove keeps the run that settled meanwhile", async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        let hold = false;
        const h = harness({
            beforeSave: async () => {
                if (hold) {
                    hold = false;
                    await held;
                    throw new Error("disk full");
                }
            },
        });
        await h.store.init();
        const keep = await h.store.add("Keep", "echo keep");
        const drop = await h.store.add("Drop", "echo drop");
        await h.store.run(keep);
        hold = true;
        const removing = h.store.remove(drop);
        h.exit(h.started[0].procId, 0);
        release();
        await expect(removing).rejects.toThrow("not removed");
        expect(h.store.view().commandRuns[keep]).toMatchObject({ state: "exited", exitCode: 0 });
        expect(h.store.view().savedCommands.map((c) => c.id)).toEqual([keep, drop]);
    });
});

describe("runs across a service restart", () => {
    const record = { commandId: "cmd_a1", procId: "pinned_cmd_a1_xyz", startedAt: 1_000 };
    const doc = () => ({
        version: 1,
        commands: [{ id: "cmd_a1", label: "Build", command: "make" }],
        lastRuns: {},
        running: [record],
    });

    it("records an accepted run in the file and drops it once the run ends", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("Build", "make");
        await h.store.run(id);
        expect(h.saved.at(-1)?.running).toEqual([{ commandId: id, procId: h.started[0].procId, startedAt: expect.any(Number) }]);
        h.exit(h.started[0].procId, 0);
        await new Promise((r) => setTimeout(r, 5));
        expect(h.saved.at(-1)?.running).toEqual([]);
    });

    it("stops a run it cannot record instead of leaving it unwatched", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("Build", "make");
        h.failSave.on = true;
        await expect(h.store.run(id)).rejects.toThrow("could not be recorded");
        expect(h.killed).toEqual([h.started[0].procId]);
        expect(h.store.liveCount()).toBe(0);
        expect(h.store.view().commandRuns[id]).toBeUndefined();
    });

    it("takes back a child the daemon still has and reports its real exit", async () => {
        const h = harness({ load: async () => doc(), alive: new Set([record.procId]), now: () => 2_000, timeoutMs: 60_000 });
        await h.store.init();
        expect(h.store.view().commandRuns.cmd_a1).toEqual({ state: "running", startedAt: 1_000 });
        expect(h.store.liveCount()).toBe(1);
        h.exit(record.procId, 7);
        expect(h.store.view().commandRuns.cmd_a1).toMatchObject({ state: "exited", exitCode: 7 });
        expect(h.store.liveCount()).toBe(0);
    });

    it("keeps the deadline the run had left, not a fresh one", async () => {
        // started 1 s ago of a 100 ms allowance: due immediately
        const h = harness({ load: async () => doc(), alive: new Set([record.procId]), now: () => 2_000, timeoutMs: 100, graceMs: 5_000 });
        await h.store.init();
        await new Promise((r) => setTimeout(r, 30));
        expect(h.killed).toEqual([record.procId]);
        h.exit(record.procId, 0);
        expect(h.store.view().commandRuns.cmd_a1).toMatchObject({ state: "timed-out" });
    });

    it("says a run that ended unseen is unknown, not a success", async () => {
        const h = harness({ load: async () => doc(), alive: new Set(), now: () => 2_000 });
        await h.store.init();
        const run = h.store.view().commandRuns.cmd_a1;
        expect(run).toMatchObject({ state: "failed" });
        expect((run as { error: string }).error).toContain("did not see");
        expect(h.store.liveCount()).toBe(0);
        expect(h.saved.at(-1)?.running).toEqual([]);
    });

    it("stops a leftover child whose command was removed", async () => {
        const gone = { ...doc(), commands: [], running: [record] };
        const h = harness({ load: async () => gone, alive: new Set([record.procId]) });
        await h.store.init();
        expect(h.killed).toEqual([record.procId]);
        expect(h.store.liveCount()).toBe(0);
    });

    it("dispose ends every run it owns, waits for the kill and records it", async () => {
        const h = harness();
        await h.store.init();
        const id = await h.store.add("Build", "make");
        await h.store.run(id);
        const procId = h.started[0].procId;
        await h.store.dispose();
        expect(h.killed).toEqual([procId]);
        expect(h.alive.has(procId)).toBe(false);
        expect(h.saved.at(-1)?.running).toEqual([]);
        expect(h.saved.at(-1)?.lastRuns[id]).toMatchObject({ state: "failed", error: "Stopped when the service stopped" });
    });

    it("the service stops its runs when the daemon sends SIGTERM", async () => {
        await import("../src/service");
        // only its source can be inspected: delivering the signal would exit the test runner
        expect(process.listeners("SIGTERM").some((listener) => String(listener).includes("savedCommands.dispose()"))).toBe(true);
    });
});
