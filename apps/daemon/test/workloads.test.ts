import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { supervisorEndpointName } from "../src/workloads/supervisor";
import { killWorkloads, startCrane, workloadRecords, type CraneProcess } from "testkit/crane";
import { dataDir } from "testkit/fs";
import { Rpc } from "testkit/rpc";
import { isAlive, TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

let crane: CraneProcess;
let host: Rpc;
const opened: Rpc[] = [];

beforeAll(async () => {
	crane = await startCrane({ dataDir: dataDir() });
	host = await crane.rpc();
});
afterAll(async () => {
	for (const socket of opened) await socket.close();
	await host.close();
	await crane.stop();
	await killWorkloads(crane.dataDir);
});

async function panel(id: string): Promise<Rpc> {
	const token = (await host.ok("auth:panel-token", { panelId: id })).token;
	const rpc = await Rpc.authed(crane.url, token);
	opened.push(rpc);
	return rpc;
}

const owners = (): Record<string, string | null> => {
	const file = path.join(crane.dataDir, "local", "process-owners.json");
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
};
const forever = ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"];

// The ownership ledger tracks which panel started each live workload.
describe("workload ownership ledger", () => {
	test("ownership is recorded on start, preserved on duplicate start failure, omitted on failed start, and removed on kill", async () => {
		const a = await panel("test.restore");
		await a.ok("process:run", { id: "restore-proc", command: process.execPath, args: forever });
		expect(owners()["restore-proc"]).toBe("test.restore");
		expect((await a.fail("process:run", { id: "restore-proc", command: process.execPath, args: forever })).error).toContain("already running");
		expect(owners()["restore-proc"]).toBe("test.restore");

		expect((await a.fail("process:run", { id: "never-starts", command: process.execPath, cwd: path.join(crane.dataDir, "missing") })).error).toBeTruthy();
		expect("never-starts" in owners()).toBe(false);

		await a.ok("process:kill", { id: "restore-proc" });
		await waitFor("the killed workload's ownership entry to go", () => !("restore-proc" in owners()));
	});
});

// A stop that arrives while its workload is still starting stops it once it has.
describe("stopping a workload the moment it is created", () => {
	test("a terminal destroyed or a process killed while starting leaves no supervisor running", async () => {
		const a = await panel("test.hasty");
		for (const [create, stop, id, params] of [
			["term:create", "term:destroy", "hasty-term", {}],
			["process:run", "process:kill", "hasty-proc", { command: process.execPath, args: forever }],
		] as const) {
			const file = path.join(crane.dataDir, "sockets", `${supervisorEndpointName(id)}.json`);
			// sent back to back: the stop reaches the daemon while the create is still starting
			const created = a.call(create, { id, ...params });
			const stopped = a.call(stop, { id });
			expect((await created).error).toBeUndefined();
			expect((await stopped).error).toBeUndefined();
			await waitFor(`${id}'s supervisor to be gone`, () => workloadRecords(crane.dataDir).every((r) => r.file !== file || !isAlive(r.pid)));
		}
	});
});

// A workload whose supervisor dies without announcing an exit never reads as a clean one.
describe("a supervisor killed outright", () => {
	test("its workload's exit is reported with no code, not 0", async () => {
		const a = await panel("test.hangup");
		await a.ok("process:run", { id: "hangup-proc", command: process.execPath, args: forever });
		const file = path.join(crane.dataDir, "sockets", `${supervisorEndpointName("hangup-proc")}.json`);
		const record = await waitFor("the workload's metadata", () => workloadRecords(crane.dataDir).find((r) => r.file === file));
		const exit = a.next((f) => f.type === "event" && f.event === "process:exit" && f.payload.id === "hangup-proc", 20_000, "the exit");
		process.kill(record.pid, "SIGKILL");
		try {
			expect((await exit).payload.exitCode).toBeNull();
		} finally {
			// the workload outlives its supervisor; it is this test's to end
			if (isAlive(record.childPid)) process.kill(record.childPid, "SIGKILL");
		}
	});
});
