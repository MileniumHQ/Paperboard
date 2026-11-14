import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { dataDir } from "./support/fs";
import { startDaemon, type InProcessDaemon } from "./support/inproc";
import { installPanelFiles, serviceSource } from "./support/panels";
import { TEST_TIMEOUT_MS } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

let daemon: InProcessDaemon | null = null;
afterAll(async () => {
	await daemon?.stop();
});

// A panel service that cannot start says why where its failures are read.
describe("a service that fails to start", () => {
	test("its exit reaches the monitor with the reason it wrote, not only its exit code", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, {
			id: "test.brokenstart",
			service: serviceSource({ options: `onInit: async () => { throw new Error("the config file is unreadable"); },` }),
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
		await host.close();
	});
});
