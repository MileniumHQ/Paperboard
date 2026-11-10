import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { processApi, resolveOneShotShell } from "@mileniumhq/paperapi";
import { SavedCommands, type CommandRun, type SavedCommandsDoc, type SavedCommandsView } from "../src/lib/savedCommands";
import { describeRun } from "../src/lib/runStatus";
import { clearWorkloads, testDaemon, untilGone } from "./helpers/crane";
import { call, panelFiles, PANEL_ID, startService, stopServices } from "./helpers/service";
import { stateWhere, within } from "./helpers/wait";

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

/** Resolves once the saved-commands file says what `accept` wants, checked on every change to its folder. */
function fileWhere(dir: string, accept: (doc: SavedCommandsDoc) => boolean, what: string): Promise<SavedCommandsDoc> {
    let watcher: fs.FSWatcher | undefined;
    const found = new Promise<SavedCommandsDoc>((resolve) => {
        const check = () => {
            // the daemon replaces the file atomically: it is always whole
            const doc = fileOf(dir);
            if (accept(doc)) resolve(doc);
        };
        watcher = fs.watch(dir, check);
        check();
    });
    return within(what, found, 20_000, () => fs.readFileSync(path.join(dir, FILE), "utf8")).finally(() => watcher?.close());
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

// Run outcome is only the exit the daemon reported, across restarts.
describe("run outcome is only the exit the daemon reported, across restarts", () => {
    test("a run is running until the daemon reports its exit, and only exit 0 is success", async () => {
        const dir = await panelFiles();
        await startService();
        const pass = heldCommand("pass", 0);
        const fail = heldCommand("fail", 3);
        const passId = await call<string>("save-command", { label: "Pass", command: pass.command });
        const failId = await call<string>("save-command", { label: "Fail", command: fail.command });

        const started = await call<{ startedAt: number }>("run-saved-command", { id: passId });
        await call("run-saved-command", { id: failId });
        const running = await stateWhere<any>(PANEL_ID, (s) => runOf(passId)(s)?.state === "running" && runOf(failId)(s)?.state === "running", "both runs to show running");
        expect(runOf(passId)(running)).toEqual({ state: "running", startedAt: started.startedAt });
        expect(describeRun(runOf(passId)(running), Date.now()).tone).toBe("running");
        // accepted runs are on record, so a restarted service can take them back
        expect(fileOf(dir).running.map((r) => r.commandId).sort()).toEqual([passId, failId].sort());
        await expect(call("run-saved-command", { id: passId })).rejects.toThrow('"Pass" is already running');

        pass.release();
        fail.release();
        const done = await stateWhere<any>(PANEL_ID, (s) => runOf(passId)(s)?.state === "exited" && runOf(failId)(s)?.state === "exited", "both exits to be reported");
        expect(runOf(passId)(done)).toMatchObject({ state: "exited", exitCode: 0 });
        expect(runOf(failId)(done)).toMatchObject({ state: "exited", exitCode: 3 });
        expect(describeRun(runOf(passId)(done), Date.now()).tone).toBe("success");
        expect(describeRun(runOf(failId)(done), Date.now())).toMatchObject({ tone: "danger", value: "Exit 3" });
        const recorded = await fileWhere(dir, (doc) => doc.running.length === 0 && Boolean(doc.lastRuns[failId]), "the finished runs to leave the record");
        expect(recorded.lastRuns[passId]).toMatchObject({ state: "exited", exitCode: 0 });
        expect(recorded.lastRuns[failId]).toMatchObject({ state: "exited", exitCode: 3 });
    });

    test("a run killed at its deadline is timed out even when the killed child exits 0", async () => {
        await testDaemon();
        let settled!: (view: SavedCommandsView) => void;
        const outcome = new Promise<SavedCommandsView>((resolve) => (settled = resolve));
        let doc: unknown = { version: 1, commands: [{ id: "cmd_deadline", label: "Slow", command: "trap 'exit 0' TERM; while :; do sleep 0.05; done" }], lastRuns: {}, running: [] };
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
            kill: (procId) => processApi.kill(procId),
            exists: (procId) => processApi.exists(procId),
            publish: (view) => {
                const run = view.commandRuns.cmd_deadline;
                if (run && run.state !== "running") settled(view);
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

    test("a run that can't be put on record is stopped and never counts as started", async () => {
        const dir = await panelFiles();
        await startService();
        const held = heldCommand("unrecorded", 0);
        const id = await call<string>("save-command", { label: "Unrecorded", command: held.command });
        const before = fs.readFileSync(path.join(dir, FILE), "utf8");
        fs.chmodSync(dir, 0o555);
        try {
            await expect(call("run-saved-command", { id })).rejects.toThrow(/"Unrecorded" was stopped: its run could not be recorded \(.*(EACCES|permission denied)/i);
        } finally {
            fs.chmodSync(dir, 0o755);
        }
        expect(fs.readFileSync(path.join(dir, FILE), "utf8")).toBe(before);
        const state = await stateWhere<any>(PANEL_ID, (s) => runOf(id)(s) === undefined, "the refused run to leave no outcome");
        expect(state.commandRuns).toEqual({});
        const daemon = await testDaemon();
        const sockets = path.join(daemon.dataDir, "sockets");
        const left = fs.existsSync(sockets) ? fs.readdirSync(sockets).filter((n) => n.endsWith(".json")).map((n) => JSON.parse(fs.readFileSync(path.join(sockets, n), "utf8")).id) : [];
        for (const procId of left.filter((p: string) => p.startsWith(`pinned_${id}_`))) await untilProcessGone(procId);
    });

    test("a restarted service takes back a run the daemon still has and reports its real exit", async () => {
        const dir = await panelFiles();
        const first = await startService();
        const held = heldCommand("reclaimed", 0);
        const id = await call<string>("save-command", { label: "Reclaimed", command: held.command });
        const { startedAt } = await call<{ startedAt: number }>("run-saved-command", { id });
        const [record] = fileOf(dir).running;
        expect(record).toMatchObject({ commandId: id, startedAt });
        await first.crash();
        expect(await processApi.exists(record.procId)).toBe(true);

        await startService();
        const reclaimed = await stateWhere<any>(PANEL_ID, (s) => runOf(id)(s) !== undefined, "the run to be taken back");
        expect(runOf(id)(reclaimed)).toEqual({ state: "running", startedAt });
        held.release();
        const done = await stateWhere<any>(PANEL_ID, (s) => runOf(id)(s)?.state === "exited", "the reclaimed run's exit");
        expect(runOf(id)(done)).toMatchObject({ state: "exited", startedAt, exitCode: 0 });
    });

    test("a run that ended while no service watched is reported failed, never success", async () => {
        const dir = await panelFiles();
        const first = await startService();
        const held = heldCommand("vanished", 0);
        const id = await call<string>("save-command", { label: "Vanished", command: held.command });
        await call("run-saved-command", { id });
        const [record] = fileOf(dir).running;
        await first.crash();
        // the child exits 0 while nobody watches
        held.release();
        await untilProcessGone(record.procId);

        await startService();
        const state = await stateWhere<any>(PANEL_ID, (s) => runOf(id)(s) !== undefined, "the vanished run's outcome");
        expect(runOf(id)(state)).toMatchObject({ state: "failed", error: "The service restarted and did not see how this run ended" });
        expect(describeRun(runOf(id)(state), Date.now()).tone).toBe("danger");
        expect(fileOf(dir).running).toEqual([]);
    });

    test("a service the daemon stops ends its runs and records that they were stopped", async () => {
        const dir = await panelFiles();
        const service = await startService();
        const held = heldCommand("stopped", 0);
        const id = await call<string>("save-command", { label: "Stopped", command: held.command });
        await call("run-saved-command", { id });
        const [record] = fileOf(dir).running;
        await service.stop();
        await untilProcessGone(record.procId);
        const doc = await fileWhere(dir, (d) => d.running.length === 0, "the stopped run to leave the record");
        expect(doc.lastRuns[id]).toMatchObject({ state: "failed", error: "Stopped when the service stopped" });
    });
});
