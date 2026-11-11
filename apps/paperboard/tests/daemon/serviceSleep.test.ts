import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { dataDir } from "./support/fs";
import { startDaemon, type InProcessDaemon } from "./support/inproc";
import { installPanelFiles, PAPERAPI, serviceSource } from "./support/panels";
import { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const SLEEP_AFTER_MS = 400;
const SLEEPER = "test.sleeper";
const WORKER = "test.worker";

// A service that says it is idle. Everything it knows is on disk: how many
// times it has started.
const sleeper = `import * as fs from "node:fs";
import { actionsApi, definePanelService } from ${JSON.stringify(PAPERAPI)};
let starts = 0;
definePanelService({
	onInit: async (ctx) => {
		starts = (fs.existsSync("starts.txt") ? Number(fs.readFileSync("starts.txt", "utf8")) : 0) + 1;
		fs.writeFileSync("starts.txt", String(starts));
		await actionsApi.defineProject({ id: "garden", name: "Garden" }, ${JSON.stringify(SLEEPER)});
		await actionsApi.register("garden/water", async () => "watered", ${JSON.stringify(SLEEPER)});
		ctx.setIdle(true);
	},
	actions: {
		starts: async () => starts,
		slow: async () => { await new Promise((resolve) => setTimeout(resolve, ${SLEEP_AFTER_MS * 4})); return "done"; },
		work: async (ctx) => { ctx.setIdle(false); return starts; },
		rest: async (ctx) => { ctx.setIdle(true); return starts; },
	},
});
`;

let daemon: InProcessDaemon;
let host: Rpc;

beforeAll(async () => {
	const dir = dataDir();
	await installPanelFiles(dir, { id: SLEEPER, service: sleeper });
	// never says it is idle
	await installPanelFiles(dir, { id: WORKER, service: serviceSource({ actions: "{ ping: async () => 'pong' }" }) });
	daemon = await startDaemon({ dataDir: dir, serviceSleepAfterMs: SLEEP_AFTER_MS });
	host = await daemon.rpc();
	await waitFor("both services to register", async () =>
		(await host.ok("actions:list", { panelId: SLEEPER })).actions.length >= 5 && (await host.ok("actions:list", { panelId: WORKER })).actions.length >= 2);
});
afterAll(async () => {
	await host.close();
	await daemon.stop();
});

const sleeping = async (): Promise<string[]> => (await host.ok("system:usage", {})).sleeping;
const asleep = (panelId = SLEEPER) => waitFor(`${panelId} to fall asleep`, async () => (await sleeping()).includes(panelId));
const call = async (action: string, panelId = SLEEPER) => (await host.ok("actions:call", { panelId, action, args: [] })).result;
const names = async (panelId: string) => (await host.ok("actions:list", { panelId })).actions.map((a: { action: string }) => a.action).sort();

// A sleeping service is still there for whoever needs it.
describe("idle panel services sleep", () => {
	test("an idle service is stopped, its actions and projects stay listed, and the call that needs it starts it again", async () => {
		await asleep();
		expect(await names(SLEEPER)).toEqual(["__getState", "garden/water", "rest", "slow", "starts", "work"]);
		expect((await host.ok("actions:projects", { panelId: SLEEPER })).projects).toEqual([{ panelId: SLEEPER, id: "garden", name: "Garden" }]);

		// it started from nothing: the count came from disk
		expect(await call("starts")).toBe(2);
		expect(await sleeping()).not.toContain(SLEEPER);
		expect(await call("garden/water")).toBe("watered");

		// several calls at once share the one start
		await asleep();
		expect(await Promise.all([call("starts"), call("starts"), call("garden/water")])).toEqual([3, 3, "watered"]);
	});

	test("a call still running keeps an idle service awake, and so does a service with something to do", async () => {
		// longer than the idle time: the service must not be stopped under it
		expect(await call("slow")).toBe("done");

		const started = await call("work");
		await Bun.sleep(SLEEP_AFTER_MS * 4);
		expect(await sleeping()).toEqual([]);
		expect(await call("starts")).toBe(started);

		await call("rest");
		await asleep();
		// the one that never said it was idle ran through all of it
		expect(await sleeping()).toEqual([SLEEPER]);
		expect(await call("ping", WORKER)).toBe("pong");
	});

	test("a caller that may not make a call does not get to start the service", async () => {
		await asleep();
		const other = await daemon.panelRpc("test.other");
		const refused = await other.fail("actions:call", { panelId: SLEEPER, action: "__getState", args: [] });
		expect(refused.code).toBe("FORBIDDEN");
		await other.close();
		expect(await sleeping()).toContain(SLEEPER);
	});

	test("restarting a sleeping service starts it, and it sleeps again", async () => {
		await asleep();
		const before = await call("starts");
		await asleep();
		expect((await host.ok("panel:restartService", { panelId: SLEEPER })).restarted).toBe(true);
		expect(await sleeping()).not.toContain(SLEEPER);
		expect(await call("starts")).toBe(before + 1);
		await asleep();
	});
});
