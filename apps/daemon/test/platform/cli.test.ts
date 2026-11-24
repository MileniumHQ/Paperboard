import { describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { childEnv, craneBinary, killWorkloads, runCrane, spawnChild, startCrane, workloadRecords } from "testkit/crane";
import { dataDir, tempDir } from "testkit/fs";
import { Rpc } from "testkit/rpc";
import { isAlive, TEST_TIMEOUT_MS, waitFor, within } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// The daemon CLI and service install work headless.
describe("the daemon command line works headless", () => {

	test("status --json exits 3 with nothing running and 0 with pid, port and version, and --data-dir wins over PAPERBOARD_DIR", async () => {
		const live = dataDir();
		const empty = dataDir();
		const none = await runCrane(["status", "--json"], childEnv(empty));
		expect(none.code).toBe(3);
		expect(JSON.parse(none.output).running).toBe(false);

		const crane = await startCrane({ dataDir: live });
		const byEnv = await runCrane(["status", "--json"], childEnv(live));
		expect(byEnv.code).toBe(0);
		const status = JSON.parse(byEnv.output);
		expect(status.running).toBe(true);
		expect(status.pid).toBe(crane.proc.pid);
		expect(status.listen.port).toBe(crane.port);
		expect(typeof status.version).toBe("string");

		const byFlag = await runCrane(["status", "--json", "--data-dir", live], childEnv(empty));
		expect(byFlag.code).toBe(0);
		expect(JSON.parse(byFlag.output).dataDir).toBe(path.resolve(live));
		await crane.stop();
	});

	// a pidfile a crash left behind names a PID the system may have handed
	// to another program since: a busy port never ends that program
	test("a busy port is not reclaimed from a recorded PID that now runs another program", async () => {
		const dir = dataDir();
		const other = spawnChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], process.env);
		const holder = net.createServer();
		await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
		const port = (holder.address() as net.AddressInfo).port;
		try {
			fs.writeFileSync(path.join(dir, "papercrane.pid"), JSON.stringify({ pid: other.proc.pid, startedAt: new Date().toISOString(), execPath: await craneBinary() }));
			const run = await runCrane(["--headless", "--host", "127.0.0.1", "--port", String(port)], childEnv(dir));
			expect(run.code).not.toBe(0);
			expect(run.output).toContain("already in use");
			expect(isAlive(other.proc.pid!)).toBe(true);
		} finally {
			holder.close();
			other.proc.kill("SIGKILL");
			await other.exited;
		}
	});

	test("pair prints a code and exits 0 once a client pairs", async () => {
		const dir = dataDir();
		const crane = await startCrane({ dataDir: dir });
		const pair = spawnChild(await craneBinary(), ["pair", "--data-dir", dir], childEnv(dataDir()));
		const code = await waitFor("a pairing code", () => /Pairing code: (\d{3}) (\d{3})/.exec(pair.output()), { timeoutMs: 20_000 });
		const client = await Rpc.open(crane.url);
		expect((await client.ok("auth:pair", { code: `${code[1]}${code[2]}`, clientName: "CI" })).token).toMatch(/^pc_/);
		const exit = await within("pair to exit", pair.exited, 20_000);
		expect(exit.code).toBe(0);
		expect(pair.output()).toContain("Paired with CI");
		await client.close();
		await crane.stop();
	});

	if (process.platform === "linux") {
		test("the systemd unit runs --headless with a quoted --data-dir, KillMode=process and OOMPolicy=continue", async () => {
			const data = path.join(tempDir(), "with space");
			const run = await runCrane(["install-service", "--dry-run", "--name", "pb-test", "--data-dir", data], childEnv(dataDir(), { XDG_CONFIG_HOME: tempDir() }));
			expect(run.code).toBe(0);
			const exec = /ExecStart=(.*)/.exec(run.output)![1]!;
			expect(exec).toContain("--headless");
			expect(exec).toContain(`--data-dir "${data}"`);
			expect(run.output).toContain("KillMode=process");
			expect(run.output).toContain("OOMPolicy=continue");
		});

		test("uninstall keeps the data directory", async () => {
			const config = tempDir();
			const data = dataDir();
			const unitDir = path.join(config, "systemd", "user");
			fs.mkdirSync(unitDir, { recursive: true });
			fs.writeFileSync(path.join(unitDir, "pb-test.service"), `# Paperboard data: ${data}\n[Service]\n`);
			const run = await runCrane(["uninstall-service", "--dry-run", "--name", "pb-test"], childEnv(dataDir(), { XDG_CONFIG_HOME: config }));
			expect(run.code).toBe(0);
			expect(run.output).toContain(`Your data in ${data} would be kept`);
			expect(run.output).not.toContain(`rm ${data}`);
			expect(fs.existsSync(path.join(data, "local"))).toBe(true);
		});
	}

	if (process.platform === "win32") {
		test("the scheduled task runs --headless with a quoted --data-dir, no time limit and normal priority", async () => {
			const data = path.join(tempDir(), "with space");
			const run = await runCrane(["install-service", "--dry-run", "--system", "--name", "pb-test", "--data-dir", data], childEnv(dataDir()));
			expect(run.code).toBe(0);
			expect(run.output).toContain("<BootTrigger>");
			expect(run.output).toContain("<LogonType>S4U</LogonType>");
			expect(run.output).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
			expect(run.output).toContain("<Priority>5</Priority>");
			// Task Scheduler restarts nothing on its own: an every-minute trigger brings back a crashed daemon
			expect(run.output).toMatch(/<TimeTrigger>\s*<Repetition>\s*<Interval>PT1M<\/Interval>/);
			expect(run.output).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
			expect(run.output).toContain(`--headless --data-dir &quot;${data}&quot;`);
			// no console window: conhost hosts the daemon headless
			expect(run.output).toMatch(/conhost\.exe<\/Command>/i);
			expect(run.output).toContain("netsh advfirewall firewall add rule");
		});

		// a user task signs in with the user, sits in their own folder, and leaves the firewall alone
		test("a user task starts at sign-in in the account's own task folder, with no firewall rule", async () => {
			const run = await runCrane(["install-service", "--dry-run", "--name", "pb-test", "--data-dir", dataDir()], childEnv(dataDir()));
			expect(run.code).toBe(0);
			expect(run.output).toContain("<LogonTrigger>");
			expect(run.output).toContain("<LogonType>InteractiveToken</LogonType>");
			expect(run.output).toContain(`\\Paperboard\\${os.userInfo().username.replace(/[\\/:*?"<>|]/g, "_")}\\pb-test`);
			expect(run.output).not.toContain("netsh");
		});

		// A real task: only on CI's throwaway Windows runner, which is an administrator
		if (process.env.CI) {
			test("a --system task starts the daemon at once, starts it again after a crash, and removing it leaves its workloads running and its data in place", async () => {
				const data = path.join(tempDir(), "with space");
				const name = `pb-ci-${process.pid}`;
				const free = net.createServer();
				await new Promise<void>((resolve) => free.listen(0, "127.0.0.1", resolve));
				const port = (free.address() as net.AddressInfo).port;
				await new Promise<void>((resolve) => free.close(() => resolve()));
				const install = await runCrane(["install-service", "--system", "--name", name, "--data-dir", data, "--host", "127.0.0.1", "--port", String(port)], childEnv(dataDir()), 60_000);
				let removed = false;
				try {
					expect(install.code).toBe(0);
					expect(install.output).toContain("It is running");
					const handshake = JSON.parse(fs.readFileSync(path.join(data, "local", "crane.json"), "utf8")) as { port: number; token: string; pid: number };
					const rpc = await Rpc.authed(`ws://127.0.0.1:${handshake.port}`, handshake.token);
					await rpc.ok("process:run", { id: "survivor", command: process.execPath, args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"] });
					const [record] = await waitFor("the workload's metadata", () => workloadRecords(data).length === 1 && workloadRecords(data));
					await rpc.close();

					// Task Scheduler starts a daemon that crashed again
					const crashed = handshake.pid;
					process.kill(crashed, "SIGKILL");
					const restarted = await waitFor("the task to start the daemon again", () => {
						const now = JSON.parse(fs.readFileSync(path.join(data, "local", "crane.json"), "utf8")) as { pid: number };
						return now.pid !== crashed && isAlive(now.pid) && now.pid;
					}, { timeoutMs: 150_000, intervalMs: 1000 });
					expect(isAlive(record!.childPid)).toBe(true);
					expect(restarted).toBeGreaterThan(0);

					const uninstall = await runCrane(["uninstall-service", "--system", "--name", name], childEnv(dataDir()), 60_000);
					removed = uninstall.code === 0;
					expect(uninstall.code).toBe(0);
					await waitFor("the daemon to stop", () => !isAlive(JSON.parse(fs.readFileSync(path.join(data, "local", "crane.json"), "utf8")).pid));
					expect(isAlive(record!.childPid)).toBe(true);
					expect(fs.existsSync(path.join(data, "local"))).toBe(true);
				} finally {
					if (!removed) await runCrane(["uninstall-service", "--system", "--name", name], childEnv(dataDir()), 60_000);
					await killWorkloads(data);
				}
			// Task Scheduler waits a minute before a restart
			}, 240_000);
		}
	}

	if (process.platform === "darwin") {
		test("the launchd plist runs --headless and abandons its process group", async () => {
			const run = await runCrane(["install-service", "--dry-run", "--name", "pb-test", "--data-dir", dataDir()], childEnv(dataDir()));
			expect(run.code).toBe(0);
			expect(run.output).toContain("<string>--headless</string>");
			expect(run.output).toMatch(/<key>AbandonProcessGroup<\/key>\s*<true\/>/);
		});
	}
});
