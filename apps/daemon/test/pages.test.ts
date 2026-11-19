import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { dataDir } from "testkit/fs";
import { startDaemon, type InProcessDaemon } from "testkit/inproc";
import { installPanelFiles, serviceCall, serviceSource } from "testkit/panels";
import type { Rpc } from "testkit/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const PANEL = "test.pages";
let daemon: InProcessDaemon;
let host: Rpc;

// a real service that keeps every count of open pages it heard
beforeAll(async () => {
	const dir = dataDir();
	await installPanelFiles(dir, {
		id: PANEL,
		service: serviceSource({
			extra: "const heard: number[] = [];",
			calls: "{ heard: () => heard }",
			options: "onPagesChanged: (_ctx, open) => { heard.push(open); },",
		}),
	});
	daemon = await startDaemon({ dataDir: dir });
	host = await daemon.rpc();
});

afterAll(async () => {
	await host?.close();
	await daemon?.stop();
});

const heard = async () => (await host.ok("blocks:call", serviceCall(PANEL, "heard"))).result as number[];
// a service that is restarting answers a failure, and is asked again
const until = (what: string, want: number[]) =>
	waitFor(what, async () => JSON.stringify(await heard()) === JSON.stringify(want));

describe("a panel's open pages", () => {
	test("its service hears how many are open as each opens and closes, and a restarted one hears how many are open now", async () => {
		await until("the service to hear no page is open", [0]);

		// each page says so on its own connection, once or again after a reconnect
		const first = await daemon.panelRpc(PANEL);
		await first.ok("pages:open", { panelId: PANEL });
		await first.ok("pages:open", { panelId: PANEL });
		await until("one page open", [0, 1]);
		const second = await daemon.panelRpc(PANEL);
		await second.ok("pages:open", { panelId: PANEL });
		await until("two pages open", [0, 1, 2]);

		await first.close();
		await until("one page closed", [0, 1, 2, 1]);

		await host.ok("panel:restartService", { panelId: PANEL });
		await until("the restarted service to hear the page still open", [1]);

		await second.close();
		await until("the last page closed", [1, 0]);
	});

	test("a page counts only for its own panel", async () => {
		const other = await daemon.panelRpc("test.other");
		try {
			expect((await other.fail("pages:open", { panelId: PANEL })).code).toBe("FORBIDDEN");
		} finally {
			await other.close();
		}
	});
});
