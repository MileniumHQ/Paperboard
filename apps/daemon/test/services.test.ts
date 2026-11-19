import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { dataDir, tempDir } from "testkit/fs";
import { startDaemon, type InProcessDaemon } from "testkit/inproc";
import { installPanelFiles, serviceSource } from "testkit/panels";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

let daemon: InProcessDaemon | null = null;
afterAll(async () => {
	await daemon?.stop();
});

// A panel service that cannot start says why where its failures are read.
describe("a service that fails to start", () => {
	test("its exit reaches the monitor and the panel list with the reason it wrote, until it starts", async () => {
		const dir = dataDir();
		const broken = path.join(tempDir(), "config-unreadable");
		fs.writeFileSync(broken, "");
		await installPanelFiles(dir, {
			id: "test.brokenstart",
			service: serviceSource({
				extra: 'import * as fs from "node:fs";',
				options: `onInit: async () => { if (fs.existsSync(${JSON.stringify(broken)})) throw new Error("the config file is unreadable"); },`,
			}),
		});
		daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		await host.ok("monitor:subscribe");
		// it restarts on a backoff, so an exit after the subscription is certain
		const exited = await host.next(
			(f) => f.type === "monitor" && f.record.type === "service" && f.record.panel === "test.brokenstart" && f.record.state === "exited",
			TEST_TIMEOUT_MS,
			"the broken service's exit record",
		);
		expect(exited.record.code).toBe(1);
		expect(exited.record.error).toContain("the config file is unreadable");
		// the shell reads it from the panel list: the thrown message, not
		// the bundle's source lines Bun prints around the throw
		const listed = (await host.ok("panel:list")).panels.find((p: { id: string }) => p.id === "test.brokenstart");
		expect(listed.serviceError).toBe("the config file is unreadable");

		// once it starts, the panel list stops saying it failed
		fs.rmSync(broken);
		await host.next(
			(f) => f.type === "monitor" && f.record.type === "service" && f.record.panel === "test.brokenstart" && f.record.state === "ready",
			TEST_TIMEOUT_MS,
			"the fixed service's ready record",
		);
		const fixed = (await host.ok("panel:list")).panels.find((p: { id: string }) => p.id === "test.brokenstart");
		expect(fixed.serviceError).toBeUndefined();
		await host.close();
	});
});

// A crashed service that cannot be started again says why, not only how it
// last exited.
describe("a service whose restart fails", () => {
	test("the panel list carries the restart's failure", async () => {
		const dir = dataDir();
		// it exits after removing its own entry, so the restart finds nothing to run
		await installPanelFiles(dir, {
			id: "test.norestart",
			service: 'import * as fs from "node:fs"; fs.rmSync("service.js"); process.exit(1);',
		});
		await daemon?.stop();
		daemon = await startDaemon({ dataDir: dir });
		const host = await daemon.rpc();
		const listed = await waitFor("the failed restart in the panel list", async () => {
			const panel = (await host.ok("panel:list")).panels.find((p: { id: string }) => p.id === "test.norestart");
			return panel?.serviceError?.includes("service.js") ? panel : null;
		});
		expect(listed.serviceError).toContain("no such file");
		await host.close();
	});
});
