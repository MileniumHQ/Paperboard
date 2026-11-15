import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { dataDir } from "./support/fs";
import { startDaemon, type InProcessDaemon } from "./support/inproc";
import { installPanelFiles, PAPERAPI, serviceCall, serviceSource } from "./support/panels";
import type { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const PANEL = "test.problems";
let daemon: InProcessDaemon;
let host: Rpc;

// a real service, reporting and clearing through PaperAPI as a panel does
beforeAll(async () => {
	const dir = dataDir();
	await installPanelFiles(dir, {
		id: PANEL,
		service: serviceSource({
			extra: `import { problemsApi } from ${JSON.stringify(PAPERAPI)};`,
			calls: `{
				report: (_ctx, input) => { problemsApi.report(${JSON.stringify(PANEL)}, input); },
				reportMany: (_ctx, input) => { for (let i = 0; i < input.count; i++) problemsApi.report(${JSON.stringify(PANEL)}, { title: "Problem " + i, message: "it failed" }); },
				clear: (_ctx, input) => { problemsApi.clear(${JSON.stringify(PANEL)}, input?.key); },
			}`,
		}),
	});
	daemon = await startDaemon({ dataDir: dir });
	host = await daemon.rpc();
	await host.ok("events:subscribe", { events: ["problems:changed"] });
	await waitFor("the service to answer", async () => !(await host.call("blocks:call", serviceCall(PANEL, "clear"))).error);
});

afterAll(async () => {
	await host?.close();
	await daemon?.stop();
});

const call = (name: string, input?: unknown) => host.ok("blocks:call", serviceCall(PANEL, name, input));
const listed = async () => ((await host.ok("problems:every")).panels[PANEL] ?? []) as Array<{ key: string; title: string; message: string }>;
const until = (what: string, check: (problems: Awaited<ReturnType<typeof listed>>) => boolean) =>
	waitFor(what, async () => {
		const problems = await listed();
		return check(problems) ? problems : null;
	});

describe("a panel's problems", () => {
	test("a service's report reaches the host as an event and in the list, and the same key replaces it", async () => {
		const heard = host.next((f) => f.type === "event" && f.event === "problems:changed" && f.payload.panelId === PANEL && f.payload.problems.length === 1, 15_000, "the problem's event");
		await call("report", { key: "poll", title: "The weather couldn't be read", message: "ECONNRESET" });
		expect((await heard).payload.problems[0]).toMatchObject({ key: "poll", title: "The weather couldn't be read", message: "ECONNRESET" });

		await call("report", { key: "poll", title: "The weather couldn't be read", message: "timed out" });
		const replaced = await until("the repeat to replace it", (p) => p[0]?.message === "timed out");
		expect(replaced).toHaveLength(1);

		await call("clear", { key: "poll" });
		await until("the clear to take it away", (p) => p.length === 0);
	});

	test("a panel keeps only its newest problems", async () => {
		await call("reportMany", { count: 25 });
		const kept = await until("the newest of 25", (p) => p.at(-1)?.title === "Problem 24");
		expect(kept.map((p) => p.title)).toEqual(Array.from({ length: 20 }, (_, i) => `Problem ${i + 5}`));
		await call("clear");
		await until("clearing them all", (p) => p.length === 0);
	});

	test("a panel reads and changes only its own problems; the shell dismisses any", async () => {
		await call("report", { key: "a", title: "A failed", message: "why" });
		await until("the report", (p) => p.length === 1);
		const other = await daemon.panelRpc("test.other");
		try {
			expect((await other.fail("problems:list", { panelId: PANEL })).code).toBe("FORBIDDEN");
			expect((await other.fail("problems:clear", { panelId: PANEL, key: "a" })).code).toBe("FORBIDDEN");
			expect((await other.fail("problems:every")).code).toBe("FORBIDDEN");
			expect((await other.fail("problems:report", { panelId: "test.other", title: "", message: "x", key: "k" })).code).toBe("INVALID_PARAMS");
		} finally {
			await other.close();
		}
		await host.ok("problems:clear", { panelId: PANEL, key: "a" });
		expect(await listed()).toEqual([]);
	});
});
