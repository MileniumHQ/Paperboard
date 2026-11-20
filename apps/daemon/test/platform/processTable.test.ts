import { expect, setDefaultTimeout, test } from "bun:test";
import { spawn } from "node:child_process";
import { TEST_TIMEOUT_MS } from "testkit/wait";
import { processTree, readProcessTable } from "../../src/system/usage";

setDefaultTimeout(TEST_TIMEOUT_MS);

// The probe each OS answers (/proc, ps, PowerShell's Win32_Process) gives a
// start time a child sorts after its parent by, so the walk follows it.
test("this system's process table names each start time, and a child's tree is found under its parent", async () => {
	const before = Date.now();
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
	try {
		await new Promise<void>((resolve, reject) => {
			child.once("spawn", resolve);
			child.once("error", reject);
		});
		const table = await readProcessTable();
		const self = table.get(process.pid);
		const started = table.get(child.pid!);
		expect(self).toBeDefined();
		expect(started).toMatchObject({ ppid: process.pid });
		// ps reports whole seconds
		expect(started!.startedAt).toBeGreaterThan(before - 2_000);
		expect(started!.startedAt).toBeLessThan(Date.now() + 2_000);
		expect(started!.startedAt).toBeGreaterThanOrEqual(self!.startedAt);
		expect(processTree(table, [process.pid])).toContain(child.pid!);
	} finally {
		child.kill();
	}
});
