import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { processApi, resolveOneShotShell } from "@mileniumhq/paperapi";
import type { CommandRun } from "../src/lib/contract";
import { SavedCommands, type SavedCommandsDoc, type SavedCommandsView } from "../src/lib/savedCommands";
import { describeRun } from "../src/lib/runStatus";
import { clearWorkloads, testDaemon, untilGone } from "./helpers/crane";
import { call, panelFiles, PANEL_ID, startService, stopServices } from "./helpers/service";
import { stateWhere, until, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const FILE = "saved-commands.json";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-runs-"));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));
afterEach(async () => {
    await stopServices();
    await clearWorkloads();
});

// a command that runs until the test lets it go, then exits with `code`
function heldCommand(name: string, code: number): { command: string; release: () => void } {
    const gate = path.join(work, `${name}.go`);
    return {
        command: `while [ ! -e '${gate}' ]; do sleep 0.05; done; exit ${code}`,
        release: () => fs.writeFileSync(gate, ""),
    };
}

const runOf = (id: string) => (state: { commandRuns: Record<string, CommandRun> }) => state.commandRuns[id];
const fileOf = (dir: string): SavedCommandsDoc => JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));

/** Resolves once the saved-commands file says what `accept` wants. Read again and again: a folder's watcher (fs.watch) misses writes under Bun. */
function fileWhere(dir: string, accept: (doc: SavedCommandsDoc) => boolean, what: string): Promise<SavedCommandsDoc> {
    // the daemon replaces the file atomically: it is always whole
    return until(what, () => fileOf(dir), accept);
}

/** Resolves once the daemon no longer supervises `procId`. */
async function untilProcessGone(procId: string): Promise<void> {
    if (!(await processApi.exists(procId))) return;
    const daemon = await testDaemon();
    const records = path.join(daemon.dataDir, "sockets");
    const record = fs.readdirSync(records).find((name) => name.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(records, name), "utf8")).id === procId);
    if (record) await untilGone(path.join(records, record), `${procId} to end`);
    // the supervisor removes its record before it closes its socket, so the
    // daemon can still report it connected for a moment after the record is
    // gone: ask again, one round trip at a time, until it sees the close
    const deadline = Date.now() + 20_000;
    while (await processApi.exists(procId)) {
        if (Date.now() > deadline) throw new Error(`Timed out after 20000 ms waiting for the daemon to stop supervising ${procId}`);
    }
}

// Run outcome is only the exit the daemon reported.
describe("run outcome is only the exit the daemon reported", () => {
    test("a run is running until the daemon reports its exit, and only exit 0 is success", async () => {
        const dir = await panelFiles();
        await startService();
        const pass = heldCommand("pass", 0);
        const fail = heldCommand("fail", 3);
        const passId = await call.saveCommand({ label: "Pass", command: pass.command });
        const failId = await call.saveCommand({ label: "Fail", command: fail.command });

        const started = await call.runSavedCommand({ id: passId });
        await call.runSavedCommand({ id: failId });
        const running = await stateWhere<any>(PANEL_ID, (s) => runOf(passId)(s)?.state === "running" && runOf(failId)(s)?.state === "running", "both runs to show running");
        expect(runOf(passId)(running)).toEqual({ state: "running", startedAt: started.startedAt });
        expect(describeRun(runOf(passId)(running), Date.now()).tone).toBe("running");
        await expect(call.runSavedCommand({ id: passId })).rejects.toThrow('"Pass" is already running');

        pass.release();
        fail.release();
        const done = await stateWhere<any>(PANEL_ID, (s) => runOf(passId)(s)?.state === "exited" && runOf(failId)(s)?.state === "exited", "both exits to be reported");
        expect(runOf(passId)(done)).toMatchObject({ state: "exited", exitCode: 0 });
        expect(runOf(failId)(done)).toMatchObject({ state: "exited", exitCode: 3 });
        expect(describeRun(runOf(passId)(done), Date.now()).tone).toBe("success");
        expect(describeRun(runOf(failId)(done), Date.now())).toMatchObject({ tone: "danger", value: "Exit 3" });
        const recorded = await fileWhere(dir, (doc) => Boolean(doc.lastRuns[passId]) && Boolean(doc.lastRuns[failId]), "the finished runs to be recorded");
        expect(recorded.lastRuns[passId]).toMatchObject({ state: "exited", exitCode: 0 });
        expect(recorded.lastRuns[failId]).toMatchObject({ state: "exited", exitCode: 3 });
    });

    test("a run killed at its deadline is timed out even when the killed child exits 0", async () => {
        await testDaemon();
        let settled!: (view: SavedCommandsView) => void;
        const outcome = new Promise<SavedCommandsView>((resolve) => (settled = resolve));
        let doc: unknown = { version: 1, commands: [{ id: "cmd_deadline", label: "Slow", command: "trap 'exit 0' TERM; while :; do sleep 0.05; done" }], lastRuns: {} };
        const reported: number[] = [];
        // wired to the real daemon exactly as src/service.ts wires it, with a short deadline
        const saved = new SavedCommands({
            load: async () => doc,
            save: async (next) => {
                doc = next;
            },
            start: async (procId, command) => {
                const shell = resolveOneShotShell();
                processApi.onExit(procId, (code) => reported.push(code ?? -1));
                const res = await processApi.start({ id: procId, command: shell.command, args: [...shell.baseArgs, command] });
                if (!res?.success) throw new Error("the daemon did not start the process");
            },
            onExit: (procId, callback) => processApi.onExit(procId, callback),
            onOutput: (procId, callback) => processApi.onData(procId, callback),
            kill: (procId) => processApi.kill(procId),
            publish: (view) => {
                const run = view.commandRuns.cmd_deadline;
                if (run && run.state !== "running") settled(view);
            },
            problem: (title, message) => {
                throw new Error(`${title}: ${message}`);
            },
            timeoutMs: 300,
        });
        await saved.init();
        await saved.run("cmd_deadline");
        const run = (await within("the timed-out run to settle", outcome)).commandRuns.cmd_deadline;
        expect(reported).toEqual([0]);
        expect(run.state).toBe("timed-out");
        expect(describeRun(run, Date.now())).toMatchObject({ tone: "warning", value: "Timed out" });
        expect((doc as SavedCommandsDoc).lastRuns.cmd_deadline.state).toBe("timed-out");
    });

    test("a service the daemon stops ends its runs and records that they were stopped", async () => {
        const dir = await panelFiles();
        const service = await startService();
        const held = heldCommand("stopped", 0);
        const id = await call.saveCommand({ label: "Stopped", command: held.command });
        const { startedAt } = await call.runSavedCommand({ id });
        const procId = `pinned_${id}_${startedAt.toString(36)}`;
        await service.stop();
        await untilProcessGone(procId);
        const doc = await fileWhere(dir, (d) => d.lastRuns[id]?.state === "failed", "the stopped run to be recorded");
        expect(doc.lastRuns[id]).toMatchObject({ state: "failed", error: "Stopped when the service stopped" });
    });
});
