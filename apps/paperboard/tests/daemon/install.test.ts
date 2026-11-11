import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { PaperCraneEngine } from "../../papercrane/engine";
import { semverGt, resolveRegistryUrl } from "../../papercrane/util";
import { fetchRegistryJson } from "../../../../packages/paperapi/src/config";
import { planUpdateTasks, withInstalledRecords, type ComputerUpdateState } from "../../src/main/updatePlan";
import { killWorkloads, startCrane } from "./support/crane";
import { dataDir, listTree } from "./support/fs";
import { type InProcessDaemon, startDaemon, stopDaemon } from "./support/inproc";
import { release, startOrigami } from "./support/origami";
import { serviceSource } from "./support/panels";
import { FIXTURE_PUBLIC_KEY, serve, sha256, signPanel } from "./support/release";
import { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const origami = startOrigami();
afterAll(() => origami.close());
afterEach(stopDaemon);

const engineFor = (dir: string) => new PaperCraneEngine(dir, undefined, origami.url, FIXTURE_PUBLIC_KEY);
const downloads = (id: string) => origami.hits.filter((p) => p === `/panel/${id}/download`).length;
const panelEntries = (dir: string, id: string) => fs.readdirSync(path.join(dir, "panels")).filter((n) => n.includes(id));

// the in-process daemon's engine, pointed at the loopback registry and fixture key
// (what the engine constructor takes in tests; the daemon builds its engine itself)
function useFixtureRegistry(daemon: InProcessDaemon) {
	Object.assign(daemon.instance.engine as unknown as Record<string, unknown>, { registryUrl: origami.url, releaseKey: FIXTURE_PUBLIC_KEY });
}

// a service that records each start and answers `version`
const versionService = (version: string, startsLog: string) =>
	serviceSource({
		extra: `import * as fs from "node:fs"; fs.appendFileSync(${JSON.stringify(startsLog)}, ${JSON.stringify(version)} + "\\n");`,
		actions: `{ version: async () => ${JSON.stringify(version)} }`,
	});

// The daemon installs only what its signed registry lists.
describe("signed registry installs", () => {
	test("a packed, signed and published release installs with its files", async () => {
		await release(origami, { id: "test.good", version: "1.0.0", files: { "app.js": "console.log(1)" } });
		const dir = dataDir();
		const manifest = await engineFor(dir).installPanel("test.good");
		expect(manifest.version).toBe("1.0.0");
		expect(fs.readFileSync(path.join(dir, "panels", "test.good", "dist", "app.js"), "utf8")).toBe("console.log(1)");
		expect(panelEntries(dir, "test.good")).toEqual(["test.good"]);
	});

	test("every unverifiable record or archive is refused and leaves nothing; record defects are refused before any download", async () => {
		const { record } = await release(origami, { id: "test.base", version: "1.0.0" });
		const defects: Array<{ id: string; record: unknown; message: RegExp; downloads: number }> = [
			{ id: "test.missing", record: undefined, message: /registry record unavailable/, downloads: 0 },
			{ id: "test.unsigned", record: { ...record, id: "test.unsigned", signature: undefined }, message: /sign/i, downloads: 0 },
			{ id: "test.otherkey", record: { ...record, id: "test.otherkey", signature: signPanel("test.otherkey", "1.0.0", record.sha256, "other") }, message: /sign/i, downloads: 0 },
			{ id: "test.otherversion", record: { ...record, id: "test.otherversion", version: "1.0.1", signature: signPanel("test.otherversion", "1.0.0", record.sha256) }, message: /sign/i, downloads: 0 },
			{ id: "test.nosha", record: { ...record, id: "test.nosha", sha256: undefined }, message: /sha256/, downloads: 0 },
			{ id: "test.namedother", record: { ...record, id: "test.someone" }, message: /different panel/, downloads: 0 },
		];
		for (const defect of defects) {
			if (defect.record) origami.setRecord(defect.id, defect.record);
			const dir = dataDir();
			await expect(engineFor(dir).installPanel(defect.id)).rejects.toThrow(defect.message);
			expect({ id: defect.id, downloads: downloads(defect.id), left: panelEntries(dir, defect.id) }).toEqual({ id: defect.id, downloads: 0, left: [] });
		}

		// signed facts that the archive then contradicts
		const other = await release(origami, { id: "test.other-bytes", version: "1.0.0", files: { "x.txt": "other" } });
		origami.setRecord("test.badbytes", { ...record, id: "test.badbytes", sha256: other.record.sha256, signature: signPanel("test.badbytes", "1.0.0", other.record.sha256) });
		await release(origami, { id: "test.inner", version: "1.0.0" }, { id: "test.wrongid" });
		await release(origami, { id: "test.wrongversion", version: "2.0.0" }, { version: "1.0.0" });
		for (const [id, message] of [
			["test.badbytes", /sha256|checksum/i],
			["test.wrongid", /manifest names/],
			["test.wrongversion", /archive is version/],
		] as const) {
			const dir = dataDir();
			await expect(engineFor(dir).installPanel(id)).rejects.toThrow(message);
			expect({ id, left: panelEntries(dir, id) }).toEqual({ id, left: [] });
		}
	});

	test("a production engine checks the compiled-in release key", async () => {
		await release(origami, { id: "test.prodkey", version: "1.0.0" });
		const dir = dataDir();
		await expect(new PaperCraneEngine(dir, undefined, origami.url).installPanel("test.prodkey")).rejects.toThrow(/sign/i);
		expect(downloads("test.prodkey")).toBe(0);
	});

	test("panel:install is host-only, the URL is never the caller's, and deleteData is honoured only when exactly true", async () => {
		await release(origami, { id: "test.rpc", version: "1.0.0" });
		const daemon = await startDaemon();
		useFixtureRegistry(daemon);
		const panel = await daemon.panelRpc("test.rpc");
		expect((await panel.fail("panel:install", { panelId: "test.rpc" })).code).toBe("FORBIDDEN");
		const elsewhere = serve({ "/evil.tar.gz": Buffer.from("evil") });
		const host = await daemon.rpc();
		await host.ok("panel:install", { panelId: "test.rpc", downloadUrl: `${elsewhere.url}/evil.tar.gz` });
		expect(elsewhere.hits).toEqual([]);
		await elsewhere.close();
		expect(fs.existsSync(path.join(daemon.dataDir, "panels", "test.rpc", "manifest.json"))).toBe(true);

		const files = path.join(daemon.dataDir, "files", "test.rpc");
		for (const deleteData of ["true", 1, "yes"]) {
			fs.mkdirSync(files, { recursive: true });
			fs.writeFileSync(path.join(files, "save.txt"), "keep");
			await host.ok("panel:install", { panelId: "test.rpc" });
			await host.ok("panel:uninstall", { panelId: "test.rpc", deleteData });
			expect({ deleteData, kept: fs.existsSync(path.join(files, "save.txt")) }).toEqual({ deleteData, kept: true });
		}
		await host.ok("panel:install", { panelId: "test.rpc" });
		await host.ok("panel:uninstall", { panelId: "test.rpc", deleteData: true });
		expect(fs.existsSync(files)).toBe(false);
	});
});

// Signed rollbacks are refused by default.
describe("panel rollbacks", () => {
	test("an older validly signed record is refused and the installed bytes stay; allowDowngrade installs it", async () => {
		const v1 = await release(origami, { id: "test.roll", version: "1.0.0" });
		await release(origami, { id: "test.roll", version: "2.0.0" });
		const dir = dataDir();
		const engine = engineFor(dir);
		await engine.installPanel("test.roll");
		const installed = listTree(path.join(dir, "panels", "test.roll"));
		const bytes = fs.readFileSync(path.join(dir, "panels", "test.roll", "dist", "index.html"));

		origami.setRecord("test.roll", v1.record);
		await expect(engine.installPanel("test.roll")).rejects.toThrow(/rollback/i);
		expect(listTree(path.join(dir, "panels", "test.roll"))).toEqual(installed);
		expect(fs.readFileSync(path.join(dir, "panels", "test.roll", "dist", "index.html")).equals(bytes)).toBe(true);

		origami.setRecord("test.roll", v1.record);
		expect((await engine.installPanel("test.roll", { allowDowngrade: true })).version).toBe("1.0.0");
	});
});

// Pack, publish and install agree on one identity.
describe("pack, publish and install", () => {
	test("Origami serves the packed archive under its dotted id with the packed sha256, and the daemon installs it intact", async () => {
		const { packed, record } = await release(origami, { id: "test.identity.panel", version: "3.1.4", files: { "nested/deep.txt": "deep" } });
		expect(record.sha256).toBe(packed.sha256);
		const served = await (await fetch(`${origami.url}/panel/test.identity.panel.json`)).json();
		expect({ id: served.id, version: served.version, sha256: served.sha256 }).toEqual({ id: "test.identity.panel", version: "3.1.4", sha256: packed.sha256 });
		const archive = Buffer.from(await (await fetch(`${origami.url}/panel/test.identity.panel/download`)).arrayBuffer());
		expect(sha256(archive)).toBe(packed.sha256);
		const dir = dataDir();
		await engineFor(dir).installPanel("test.identity.panel", { version: "3.1.4", sha256: packed.sha256 });
		expect(fs.readFileSync(path.join(dir, "panels", "test.identity.panel", "dist", "nested", "deep.txt"), "utf8")).toBe("deep");
		expect(JSON.parse(fs.readFileSync(path.join(dir, "panels", "test.identity.panel", "manifest.json"), "utf8")).id).toBe("test.identity.panel");
	});
});

// The updater never stops a panel's processes behind someone's back: it holds
// the update, and Stop and update lets the panel stop and start them itself.
describe("updates held by running processes", () => {
	const hooked = (log: string, version: string) =>
		serviceSource({
			extra: 'import * as fs from "node:fs";',
			options: `beforeUpdate: async (_ctx, o) => { fs.appendFileSync(${JSON.stringify(log)}, "${version} before " + o.processes.join(",") + "\\n"); },
	afterUpdate: async (_ctx, e) => { fs.appendFileSync(${JSON.stringify(log)}, "${version} after " + e.processes.join(",") + " " + e.ok + "\\n"); },`,
		});

	// a panel at 1.0.0 owning a workload the compiled server started (it
	// stays running once that server stops) and 2.0.0 released
	async function panelWithWorkload(panelId: string, log: string, run: Record<string, unknown>) {
		await release(origami, { id: panelId, version: "1.0.0", service: hooked(log, "1.0.0") });
		const dir = dataDir();
		const crane = await startCrane({ dataDir: dir });
		const craneRpc = await crane.rpc();
		await craneRpc.ok("process:run", { id: `${panelId}-server`, command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], ...run });
		await craneRpc.close();
		expect((await crane.stop()).code).toBe(0);
		const daemon = await startDaemon({ dataDir: dir });
		useFixtureRegistry(daemon);
		const engine = daemon.instance.engine;
		await engine.recoverRunningSupervisors();
		const host = await daemon.rpc();
		await host.ok("panel:install", { panelId });
		engine.setClientOwner(`${panelId}-server`, panelId);
		await release(origami, { id: panelId, version: "2.0.0", service: hooked(log, "2.0.0") });
		return { dir, daemon, host, manifest: path.join(daemon.dataDir, "panels", panelId, "manifest.json") };
	}

	test("an important process holds its panel's update, and Stop and update stops it, installs, and tells the new release", async () => {
		const log = path.join(dataDir(), "update.log");
		const { dir, host, manifest } = await panelWithWorkload("test.held", log, { important: true });
		try {
			const before = downloads("test.held");
			// important survives the server restart: it is in the workload's metadata
			const held = await host.ok("panel:install", { panelId: "test.held", ifUnused: true });
			expect(held).toEqual({ held: { processes: ["test.held-server"] } });
			// held before any download: the running release is untouched
			expect(downloads("test.held")).toBe(before);
			expect((await host.ok("process:exists", { id: "test.held-server" })).running).toBe(true);
			expect(JSON.parse(fs.readFileSync(manifest, "utf8")).version).toBe("1.0.0");

			const updated = await host.ok("update:inUse", { panels: [{ id: "test.held", version: "2.0.0" }] });
			expect(updated.failures).toEqual({});
			expect(updated.panels.map((p: { version: string }) => p.version)).toEqual(["2.0.0"]);
			expect((await host.ok("process:exists", { id: "test.held-server" })).running).toBe(false);
			await waitFor("the new release to hear the update end", () => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("2.0.0 after"));
			expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual(["1.0.0 before test.held-server", "2.0.0 after test.held-server true"]);
		} finally {
			await killWorkloads(dir);
		}
	});

	test("a process that just started doesn't hold: the update stops it, installs, and the panel starts it again", async () => {
		const log = path.join(dataDir(), "update.log");
		const { dir, host, manifest } = await panelWithWorkload("test.unheld", log, {});
		try {
			const installed = await host.ok("panel:install", { panelId: "test.unheld", ifUnused: true });
			expect(installed.panel.version).toBe("2.0.0");
			expect(JSON.parse(fs.readFileSync(manifest, "utf8")).version).toBe("2.0.0");
			expect((await host.ok("process:exists", { id: "test.unheld-server" })).running).toBe(false);
			await waitFor("the new release to hear the update end", () => fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("2.0.0 after"));
			expect(fs.readFileSync(log, "utf8").trim().split("\n")).toEqual(["1.0.0 before test.unheld-server", "2.0.0 after test.unheld-server true"]);
		} finally {
			await killWorkloads(dir);
		}
	});

	test("Stop and update is host-only", async () => {
		await release(origami, { id: "test.heldscope", version: "1.0.0" });
		const daemon = await startDaemon();
		useFixtureRegistry(daemon);
		const panel = await daemon.panelRpc("test.heldscope");
		expect((await panel.fail("update:inUse", { panels: [{ id: "test.heldscope" }] })).code).toBe("FORBIDDEN");
		expect((await panel.fail("update:inUse", { packages: ["rt"] })).code).toBe("FORBIDDEN");
	});
});

// A failed upgrade keeps the running release, and uninstall keeps user data.
describe("upgrades and uninstall", () => {
	test("a release whose service fails to start is rolled back to the running one; a good upgrade leaves no parked copies", async () => {
		const daemon = await startDaemon();
		useFixtureRegistry(daemon);
		const starts = path.join(dataDir(), "starts.log");
		await release(origami, { id: "test.upgrade", version: "1.0.0", service: versionService("1.0.0", starts) });
		const host = await daemon.rpc();
		await host.ok("panel:install", { panelId: "test.upgrade" });
		expect((await host.ok("actions:call", { panelId: "test.upgrade", action: "version", args: [] })).result).toBe("1.0.0");

		await release(origami, { id: "test.upgrade", version: "2.0.0", service: serviceSource({ extra: "process.exit(3);" }) });
		expect((await host.fail("panel:install", { panelId: "test.upgrade" })).error).toBeTruthy();
		await waitFor("the previous release to answer again", async () => {
			const answer = await host.call("actions:call", { panelId: "test.upgrade", action: "version", args: [] });
			return answer.result?.result === "1.0.0";
		});
		expect(JSON.parse(fs.readFileSync(path.join(daemon.dataDir, "panels", "test.upgrade", "manifest.json"), "utf8")).version).toBe("1.0.0");

		await release(origami, { id: "test.upgrade", version: "3.0.0", service: versionService("3.0.0", starts) });
		await host.ok("panel:install", { panelId: "test.upgrade" });
		expect((await host.ok("actions:call", { panelId: "test.upgrade", action: "version", args: [] })).result).toBe("3.0.0");
		expect(fs.readdirSync(path.join(daemon.dataDir, "panels")).filter((n) => /\.replaced-|\.trash-|\.staging-|\.tmp-/.test(n))).toEqual([]);
		expect(fs.readFileSync(starts, "utf8").trim().split("\n")).toEqual(["1.0.0", "1.0.0", "3.0.0"]);
	});

	test("uninstall waits for the panel's workloads to exit before removing code, and keeps config, files and secrets", async () => {
		const crane = await startCrane({ dataDir: dataDir() });
		try {
			const host = await crane.rpc();
			fs.mkdirSync(path.join(crane.dataDir, "panels", "test.leaving"), { recursive: true });
			fs.writeFileSync(path.join(crane.dataDir, "panels", "test.leaving", "manifest.json"), JSON.stringify({ id: "test.leaving", name: "Leaving", version: "1.0.0", base: "./index.html" }));
			fs.writeFileSync(path.join(crane.dataDir, "panels", "test.leaving", "index.html"), "x");
			const token = (await host.ok("auth:panel-token", { panelId: "test.leaving" })).token as string;
			const panel = await Rpc.authed(crane.url, token);
			await panel.ok("config:set", { id: "test.leaving", data: { kept: true } });
			await panel.ok("file:write", { targetPath: "save.txt", content: "kept" });
			await panel.ok("secrets:set", { name: "api", value: "kept", panelId: "test.leaving" });

			const marker = path.join(dataDir(), "code-present-at-exit.txt");
			const codeDir = path.join(crane.dataDir, "panels", "test.leaving");
			const workload = `const fs = require("fs"); process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(marker)}, String(fs.existsSync(${JSON.stringify(codeDir)}))); process.exit(0); }); fs.writeFileSync(${JSON.stringify(`${marker}.ready`)}, "1"); setInterval(() => {}, 1000);`;
			await panel.ok("process:run", { id: "leaving-proc", command: process.execPath, args: ["-e", workload] });
			await waitFor("the workload to install its SIGTERM handler", () => fs.existsSync(`${marker}.ready`));
			await panel.close();

			await host.ok("panel:uninstall", { panelId: "test.leaving" });
			expect(fs.readFileSync(marker, "utf8")).toBe("true");
			expect(fs.existsSync(codeDir)).toBe(false);
			expect(JSON.parse(fs.readFileSync(path.join(crane.dataDir, "configs", "test.leaving.json"), "utf8"))).toEqual({ kept: true });
			expect(fs.readFileSync(path.join(crane.dataDir, "files", "test.leaving", "save.txt"), "utf8")).toBe("kept");
			expect((await host.ok("secrets:get", { name: "api", panelId: "test.leaving" })).value).toBe("kept");
			await host.close();
		} finally {
			await crane.stop();
		}
	});
});

// Update planning finds every update and refuses what it can't verify.
describe("update planning", () => {
	const sha = "a".repeat(64);
	const computer = (overrides: Partial<ComputerUpdateState>): ComputerUpdateState => ({ id: "c", name: "C", isLocal: true, panels: [], packages: {}, sysInfo: null, ...overrides });
	const plan = (computers: ComputerUpdateState[], panels: Record<string, any>, crane: Record<string, any> = {}, readCraneVersion = async () => null as string | null) =>
		planUpdateTasks(computers, panels, {}, crane, { registryUrl: origami.url, readCraneVersion });

	test("no task without a 64-hex sha256, a crane signature, or a known remote crane version", async () => {
		const panels = { "test.a": { version: "2.0.0", sha256: "abc" }, "test.b": { version: "2.0.0", sha256: sha } };
		const tasks = await plan([computer({ panels: [{ id: "test.a", version: "1.0.0" }, { id: "test.b", version: "1.0.0" }] })], panels);
		expect(tasks.map((t) => t.id)).toEqual(["test.b"]);

		const remote = (sysInfo: ComputerUpdateState["sysInfo"]) => computer({ id: "r", isLocal: false, sysInfo });
		const crane = { "linux-x64": { version: "9.0.0", sha256: sha } };
		expect(await plan([remote({ os: "linux", arch: "x64", version: "1.0.0" })], {}, crane)).toEqual([]);
		expect(await plan([remote({ os: "linux", arch: "x64" })], {}, { "linux-x64": { ...crane["linux-x64"], signature: "sig" } })).toEqual([]);
		const signed = await plan([remote({ os: "linux", arch: "x64", version: "1.0.0" })], {}, { "linux-x64": { ...crane["linux-x64"], signature: "sig" } });
		expect(signed.map((t) => t.type)).toEqual(["ext_crane"]);
	});

	test("unlisted panels update through their own registry record, and an unreadable record counts as a failure with its reason", async () => {
		await release(origami, { id: "test.unlisted", version: "5.0.0", manifest: { unlisted: true } });
		expect(JSON.parse(origami.kv.get("panels:index")!)["test.unlisted"]).toBeUndefined();
		// test.broken's record is damaged in the registry itself: Origami says so
		origami.kv.set("panel:test.broken", "{damaged");
		const computers = [computer({ panels: [{ id: "test.unlisted", version: "4.0.0" }, { id: "test.unreadable", version: "1.0.0" }, { id: "test.broken", version: "1.0.0" }] })];
		const index = await (await fetch(`${origami.url}/panels/index.json`)).json();
		// the updater's own record fetch; test.unreadable's record comes back as
		// bytes that are not JSON (a registry or proxy answering garbage)
		const garbage = serve({ "/panel/test.unreadable.json": "{not json" });
		const fetchRecord = async (id: string) => {
			const base = id === "test.unreadable" ? garbage.url : origami.url;
			try {
				return await fetchRegistryJson(`${base}/panel/${encodeURIComponent(id)}.json`, 10_000);
			} catch (err: any) {
				if (err?.status === 404) return null;
				throw err;
			}
		};
		const { panels, failures, reasons } = await withInstalledRecords(computers, index, fetchRecord);
		await garbage.close();
		expect(failures).toBe(2);
		// the updater shows the registry's own reason, not a bare status
		expect(reasons).toContain("test.broken: Registry returned HTTP 500: The registry record for test.broken could not be read");
		const tasks = await plan(computers, panels);
		expect(tasks.map((t) => [t.id, t.version])).toEqual([["test.unlisted", "5.0.0"]]);
	});

	test("versions compare across four segments and a v prefix; ORIGAMI_REGISTRY_URL is ignored in production unless allowed", () => {
		expect(semverGt("1.2.3.4", "1.2.3.3")).toBe(true);
		expect(semverGt("1.2.3.3", "1.2.3.4")).toBe(false);
		expect(semverGt("v1.10.0", "1.9.9")).toBe(true);
		expect(semverGt("1.0.0", "v1.0.0")).toBe(false);
		const env = { ORIGAMI_REGISTRY_URL: "http://127.0.0.1:1" };
		expect(resolveRegistryUrl({ env, argv: [], nodeEnv: "production" })).toBe("https://origami.ariapis.com");
		expect(resolveRegistryUrl({ env, argv: ["--allow-registry-override"], nodeEnv: "production" })).toBe("http://127.0.0.1:1");
		expect(resolveRegistryUrl({ env, argv: [], nodeEnv: "development" })).toBe("http://127.0.0.1:1");
	});
});
