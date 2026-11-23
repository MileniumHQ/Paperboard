import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { getSupervisorMetadataPath, getSupervisorSocketPath } from "../../src/workloads/supervisor";
import { supervisorLaunch } from "../../src/workloads/supervisorLaunch";
import { PaperCraneAuth } from "../../src/security/auth";
import { PanelServicesManager } from "../../src/panels/panelServices";
import { WorkloadRegistry } from "../../src/engine/workloads";
import { killWorkloads, startCrane, workloadRecords, type CraneProcess, type StartCraneOptions } from "testkit/crane";
import { dataDir, restoreEnv } from "testkit/fs";
import { installPanelFiles, serviceCall, serviceSource, stateRead } from "testkit/panels";
import { Rpc } from "testkit/rpc";
import { isAlive, TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const dirs: string[] = [];
const cranes: CraneProcess[] = [];
afterAll(async () => {
	for (const crane of cranes) await crane.stop();
	for (const dir of dirs) await killWorkloads(dir);
});

async function crane(dir = dataDir(), options: Omit<StartCraneOptions, "dataDir"> = {}): Promise<CraneProcess> {
	if (!dirs.includes(dir)) dirs.push(dir);
	const started = await startCrane({ dataDir: dir, ...options });
	cranes.push(started);
	return started;
}

async function stopped(c: CraneProcess) {
	cranes.splice(cranes.indexOf(c), 1);
	return c.stop();
}

const js = (code: string) => ({ command: process.execPath, args: ["-e", code] });
const forever = js("process.stdin.resume(); setInterval(() => {}, 1000)");
const dataOf = (rpc: Rpc, id: string, stream?: string) =>
	rpc.frames
		.filter((f) => f.type === "event" && f.event === "process:data" && f.payload.id === id && (!stream || f.payload.stream === stream))
		.map((f) => f.payload.data)
		.join("");
const exitOf = (rpc: Rpc, id: string) =>
	rpc.next((f) => f.type === "event" && f.event === "process:exit" && f.payload.id === id, 20_000, `${id}'s exit`).then((f) => f.payload.exitCode);

// Stopping the daemon or crashing the app never stops supervised workloads.
describe("stopping the daemon never stops its workloads", () => {
	test("after the daemon stops the workload keeps running, and the next daemon adopts it and can kill it", async () => {
		for (const headless of [true, false]) {
			const dir = dataDir();
			const first = await crane(dir, { headless });
			const rpc = await first.rpc();
			await rpc.ok("process:run", { id: "survivor", ...forever });
			const [record] = await waitFor("the workload's metadata", () => workloadRecords(dir).length === 1 && workloadRecords(dir));
			await rpc.close();
			const exit = await stopped(first);
			if (process.platform !== "win32") expect(exit.code).toBe(0);
			expect(isAlive(record!.childPid)).toBe(true);

			const next = await crane(dir);
			const adopter = await next.rpc();
			expect((await adopter.ok("process:exists", { id: "survivor" })).running).toBe(true);
			await adopter.ok("process:attach", { id: "survivor" });
			await adopter.ok("process:kill", { id: "survivor" });
			await waitFor("the adopted workload to exit", () => !isAlive(record!.childPid));
			await adopter.close();
		}
	});

	test("restarting a panel service keeps its workloads running", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.keeper", service: serviceSource() });
		const c = await crane(dir);
		const rpc = await c.rpc();
		const token = (await rpc.ok("auth:panel-token", { panelId: "test.keeper" })).token;
		const owner = await Rpc.authed(c.url, token);
		await owner.ok("process:run", { id: "kept", ...forever });
		await waitFor("the service to be ready", async () => (await rpc.call("panel:restartService", { panelId: "test.keeper" })).result?.restarted === true);
		expect((await rpc.ok("panel:restartService", { panelId: "test.keeper" })).restarted).toBe(true);
		expect((await owner.ok("process:exists", { id: "kept" })).running).toBe(true);
		await owner.ok("process:kill", { id: "kept" });
		await owner.close();
		await rpc.close();
	});

	test("every host starts the supervisor from its own copy in the data directory, and a copy that was changed is replaced", async () => {
		expect(supervisorLaunch("w1", "/data/local/bin/paperboard-supervisor-0123456789abcdef", "/data", { A: "1" })).toEqual({
			command: "/data/local/bin/paperboard-supervisor-0123456789abcdef",
			args: ["--data-dir", "/data", "--supervise", "w1"],
			env: { A: "1" },
		});

		const dir = dataDir();
		const bin = path.join(dir, "local", "bin");
		const copies = () => (fs.existsSync(bin) ? fs.readdirSync(bin).filter((name) => /^paperboard-supervisor-[0-9a-f]{16}(\.exe)?$/.test(name)) : []);
		const first = await crane(dir);
		const rpc = await first.rpc();
		// nothing is copied until a workload needs it
		expect(copies()).toEqual([]);
		await rpc.ok("process:run", { id: "copied", ...forever });
		expect(copies()).toHaveLength(1);
		const copy = path.join(bin, copies()[0]!);
		const shipped = fs.readFileSync(copy);
		if (process.platform !== "win32") expect(fs.statSync(copy).mode & 0o111).not.toBe(0);
		await rpc.ok("process:kill", { id: "copied" });
		await exitOf(rpc, "copied");
		await rpc.close();
		await stopped(first);

		// a copy someone changed is not what this build ships: it is replaced
		// before anything runs from it, and an older build's copy is cleared
		// (swapped in by rename: a program that is still exiting cannot be written to)
		fs.writeFileSync(`${copy}.swap`, "not the supervisor");
		await waitFor("the first workload's supervisor to let go of its file", () => {
			try { fs.renameSync(`${copy}.swap`, copy); return true; }
			catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") throw err; return false; }
		});
		const older = path.join(bin, `paperboard-supervisor-0000000000000000${process.platform === "win32" ? ".exe" : ""}`);
		fs.writeFileSync(older, "an older build's supervisor");
		const next = await crane(dir);
		const again = await next.rpc();
		await again.ok("process:run", { id: "restored", ...js("console.log('ran')") });
		expect(await exitOf(again, "restored")).toBe(0);
		expect(dataOf(again, "restored")).toContain("ran");
		expect(fs.readFileSync(copy).equals(shipped)).toBe(true);
		expect(fs.existsSync(older)).toBe(false);
		await again.close();
	});
});

// Supervised workloads are adopted, reported and stopped faithfully.
describe("supervised workloads are reported faithfully", () => {
	// an attach can reach a supervisor before adoption does: it is then the
	// same live workload, and its exit frees what it ran from
	test("a workload an attach reconnects to before adoption ends here when it exits", async () => {
		const dir = dataDir();
		const first = await crane(dir);
		const rpc = await first.rpc();
		await rpc.ok("process:run", { id: "early", ...forever });
		const [record] = await waitFor("the workload's metadata", () => workloadRecords(dir).length === 1 && workloadRecords(dir));
		await rpc.close();
		await stopped(first);

		const previous = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = dir;
		try {
			let ended = 0;
			const registry = new WorkloadRegistry(path.join(dir, "local"), { beforeStart: () => Promise.resolve(), requireNotReplacing: () => undefined, ended: () => { ended++; } });
			const changes: Array<{ id: string; state: string }> = [];
			registry.onLifecycle((change) => { if (change.type === "workload") changes.push(change); });
			const attaches = [registry.attachProcess("early", {}), registry.attachProcess("early", {})];
			expect(await Promise.all(attaches)).toEqual([true, true]);
			await registry.recoverRunningSupervisors();
			expect(registry.workloadRoots()).toHaveLength(1);
			expect(registry.users(() => true).map((use) => use.processId)).toEqual(["early"]);

			process.kill(record!.childPid, "SIGKILL");
			await waitFor("the workload's exit", () => changes.some((change) => change.id === "early" && change.state === "exited"));
			expect(registry.users(() => true)).toEqual([]);
			expect(ended).toBe(1);
		} finally {
			restoreEnv("PAPERBOARD_DIR", previous);
		}
	});

	// what a workload is (its supervisor's pid, for usage) is known the moment
	// it is taken on, never a frame later
	test("an attach resolves once the supervisor has said its status, with the workload's pid known", async () => {
		const dir = dataDir();
		const previous = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = dir;
		const server = net.createServer();
		const registry = new WorkloadRegistry(path.join(dir, "local"), { beforeStart: () => Promise.resolve(), requireNotReplacing: () => undefined, ended: () => undefined });
		try {
			fs.writeFileSync(getSupervisorMetadataPath("told"), JSON.stringify({ id: "told", config: { command: "x" }, startedAt: new Date().toISOString() }));
			// a supervisor that says its status only once the test has seen it attach
			const attached = new Promise<net.Socket>((resolve) => {
				server.on("connection", (conn) => {
					conn.setEncoding("utf8");
					conn.on("data", (chunk: string) => { if (chunk.includes('"attach"')) resolve(conn); });
				});
			});
			await new Promise<void>((resolve, reject) => server.once("error", reject).listen(getSupervisorSocketPath("told"), resolve));
			const attach = registry.attachProcess("told", {}).then((running) => ({ running, roots: registry.workloadRoots() }));
			(await attached).write(JSON.stringify({ type: "status", pid: 4242, childPid: 4243 }) + "\n");
			expect(await attach).toEqual({ running: true, roots: [{ owner: null, pid: 4242 }] });
		} finally {
			registry.releaseAllClients();
			await new Promise((resolve) => server.close(resolve));
			restoreEnv("PAPERBOARD_DIR", previous);
		}
	});
});

// Panel services start and hydrate.
describe("panel services start and hydrate", () => {
	test("a compiled crane on a network address runs services, reading a service's state waits for onInit, and a failed onInit ends the service with its error", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, {
			id: "test.hydrate",
			service: serviceSource({
				extra: "let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; });",
				calls: "{ ping: () => true, open: async () => { release(); return true; } }",
				options: "state: { phase: 'initial' }, onInit: async (ctx) => { await gate; ctx.setState({ phase: 'ready' }); },",
			}),
		});
		await installPanelFiles(dir, {
			id: "test.broken",
			service: serviceSource({ calls: "{ ping: () => true }", options: "onInit: async () => { throw new Error('init exploded'); }," }),
		});
		const started = await startCrane({ dataDir: dir, host: "0.0.0.0" });
		cranes.push(started);
		dirs.push(dir);
		const rpc = await started.rpc();
		await rpc.ok("monitor:subscribe");
		await waitFor("the hydrate service to register", async () => !(await rpc.call("blocks:call", serviceCall("test.hydrate", "ping"))).error);
		const state = rpc.call("blocks:call", stateRead("test.hydrate"));
		await rpc.ok("blocks:call", serviceCall("test.hydrate", "open"));
		expect((await state).result).toEqual({ result: { phase: "ready" } });

		// it exits on the failure (and restarts on a backoff), naming it
		const exited = await rpc.next((f) => f.type === "monitor" && f.record.type === "service" && f.record.panel === "test.broken" && f.record.state === "exited", TEST_TIMEOUT_MS, "the broken service's exit");
		expect(exited.record.error).toContain("init exploded");
		await rpc.close();
	});

	// a signal is how a service manager stops or restarts the daemon, and
	// Windows has none to give a service time with
	if (process.platform !== "win32") {
		test("a daemon stopped by a signal gives its panel services their grace to finish", async () => {
			const dir = dataDir();
			const marker = path.join(dir, "finished-on-stop");
			await installPanelFiles(dir, {
				id: "test.graceful",
				service: serviceSource({
					extra: `process.on("SIGTERM", () => setTimeout(() => { require("fs").writeFileSync(${JSON.stringify(marker)}, "done"); process.exit(0); }, 200));`,
					calls: "{ ping: () => true }",
				}),
			});
			const c = await crane(dir);
			const rpc = await c.rpc();
			await waitFor("the service to register", async () => !(await rpc.call("blocks:call", serviceCall("test.graceful", "ping"))).error);
			await rpc.close();
			expect((await stopped(c)).code).toBe(0);
			expect(fs.readFileSync(marker, "utf8")).toBe("done");
		});
	}

	test("stopService resolves only once the service process has exited", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.stopper", service: serviceSource({ extra: "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300));" }) });
		const auth = new PaperCraneAuth(false, path.join(dir, "local"));
		const services = new PanelServicesManager(dir);
		services.setAuth(auth);
		expect(services.startService("test.stopper")).toBe(true);
		const [root] = services.processRoots();
		expect(root?.panelId).toBe("test.stopper");
		await services.stopService("test.stopper");
		expect(isAlive(root!.pid)).toBe(false);
		expect(services.runningCount()).toBe(0);
		auth.dispose();
	});
});
