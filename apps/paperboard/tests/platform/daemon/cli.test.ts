import { describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { APP_DIR, childEnv, craneBinary, runCrane, spawnChild, startCrane } from "../../daemon/support/crane";
import { dataDir, tempDir } from "../../daemon/support/fs";
import { Rpc } from "../../daemon/support/rpc";
import { TEST_TIMEOUT_MS, waitFor, within } from "../../daemon/support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

// The daemon CLI and service install work headless.
describe("the daemon command line works headless", () => {
	test("wrong command lines exit 2 and start nothing", async () => {
		const dir = dataDir();
		for (const args of [
			["--bogus"],
			["frobnicate"],
			["--port", "abc", "--headless"],
			["--port", "70000", "--headless"],
			["--start-pairing", "--headless"],
			["--local", "--headless"],
		]) {
			const run = await runCrane(args, childEnv(dir));
			expect({ args, code: run.code }).toEqual({ args, code: 2 });
		}
		expect(fs.existsSync(path.join(dir, "local", "crane.json"))).toBe(false);
	});

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

	if (process.platform !== "win32") {
		test("install-service needs the compiled binary", async () => {
			const src = spawnChild(process.execPath, [path.join(APP_DIR, "papercrane/main.ts"), "install-service", "--dry-run"], childEnv(dataDir()));
			const exit = await within("install-service to exit", src.exited);
			expect(exit.code).toBe(1);
			expect(src.output()).toContain("needs the compiled papercrane binary");
		});
	}

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

	if (process.platform === "darwin") {
		test("the launchd plist runs --headless and abandons its process group", async () => {
			const run = await runCrane(["install-service", "--dry-run", "--name", "pb-test", "--data-dir", dataDir()], childEnv(dataDir()));
			expect(run.code).toBe(0);
			expect(run.output).toContain("<string>--headless</string>");
			expect(run.output).toMatch(/<key>AbandonProcessGroup<\/key>\s*<true\/>/);
		});
	}
});
