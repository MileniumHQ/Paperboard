import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { killWorkloads, startCrane, type CraneProcess } from "./support/crane";
import { dataDir } from "./support/fs";
import { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

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

// Workloads belong to the panel that created them.
describe("workloads belong to the panel that created them", () => {
	test("ownership is reserved before startup and another panel can't touch or re-create the id", async () => {
		const a = await panel("test.owner");
		const b = await panel("test.thief");
		const started = a.call("process:run", { id: "owned-proc", command: process.execPath, args: forever });
		await waitFor("the reservation to be recorded", () => owners()["owned-proc"] === "test.owner");
		for (const [action, params] of [
			["process:kill", { id: "owned-proc" }],
			["process:write", { id: "owned-proc", data: "x" }],
			["process:attach", { id: "owned-proc" }],
			["process:run", { id: "owned-proc", command: process.execPath, args: forever }],
		] as const) {
			expect({ action, code: (await b.fail(action, params)).code }).toEqual({ action, code: "FORBIDDEN" });
		}
		expect((await started).error).toBeUndefined();

		await a.ok("term:create", { id: "owned-term" });
		for (const [action, params] of [
			["term:write", { id: "owned-term", data: "x" }],
			["term:resize", { id: "owned-term", cols: 10, rows: 10 }],
			["term:attach", { id: "owned-term" }],
			["term:destroy", { id: "owned-term" }],
			["term:create", { id: "owned-term" }],
		] as const) {
			expect({ action, code: (await b.fail(action, params)).code }).toEqual({ action, code: "FORBIDDEN" });
		}
		await a.ok("term:destroy", { id: "owned-term" });
	});

	test("a failed start restores the previous owner and a killed workload's entry goes", async () => {
		const a = await panel("test.restore");
		await a.ok("process:run", { id: "restore-proc", command: process.execPath, args: forever });
		expect((await a.fail("process:run", { id: "restore-proc", command: process.execPath, args: forever })).error).toContain("already running");
		expect(owners()["restore-proc"]).toBe("test.restore");
		const b = await panel("test.later");
		expect((await b.fail("process:kill", { id: "restore-proc" })).code).toBe("FORBIDDEN");

		expect((await a.fail("process:run", { id: "never-starts", command: process.execPath, cwd: path.join(crane.dataDir, "missing") })).error).toBeTruthy();
		expect("never-starts" in owners()).toBe(false);

		await a.ok("process:kill", { id: "restore-proc" });
		await waitFor("the killed workload's ownership entry to go", () => !("restore-proc" in owners()));
	});

	test("no caller, the host included, may put PAPERCRANE_TOKEN in a child's env", async () => {
		const a = await panel("test.env");
		for (const rpc of [host, a]) {
			for (const key of ["PAPERCRANE_TOKEN", "PAPERCRANE_PANEL_TOKEN", "PAPERBOARD_PANEL_ID"]) {
				expect((await rpc.fail("process:run", { id: `env-${key}`, command: process.execPath, args: ["-e", "1"], env: { [key]: "x" } })).code).toBe("FORBIDDEN");
				expect((await rpc.fail("term:create", { id: `envterm-${key}`, env: { [key]: "x" } })).code).toBe("FORBIDDEN");
			}
		}
	});
});
