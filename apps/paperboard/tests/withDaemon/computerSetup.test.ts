import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConnectionPool } from "../../src/main/communication/papercrane/ConnectionPool";
import { ComputerSetupJob, type ComputerSetupDeps } from "../../src/main/computerSetup/setup";
import { openSsh } from "../../src/main/computerSetup/ssh";
import { readTlsCert } from "daemon/security/tlsIdentity";
import { certFingerprint } from "daemon/security/pinnedTls";
import { memberIdOf } from "daemon/network/memberId";
import type { ComputerSetupState } from "../../src/shared/shellContract";
import { craneBinary, startCrane, type CraneProcess } from "testkit/crane";
import { dataDir, listTree, restoreEnv, tempDir } from "testkit/fs";
import { FIXTURE_PUBLIC_KEY, serve, sha256, signCrane } from "testkit/release";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";
import { closeServers, PASSWORD, startServer, USER, type TestServer } from "../app/sshServer";

setDefaultTimeout(TEST_TIMEOUT_MS);

// The computer being set up is an in-process SSH server that runs each
// command with sh in a home folder of its own, with a PATH that has the
// papercrane the test puts there. This computer's side is a real pool.
describe("setting a computer up over SSH", () => {
	let appDir: string | undefined;
	let releaseKey: string | undefined;
	const cranes: CraneProcess[] = [];
	const pools: ConnectionPool[] = [];
	beforeAll(() => {
		appDir = process.env.PAPERBOARD_DIR;
		releaseKey = process.env.PAPERBOARD_RELEASE_PUBLIC_KEY;
		process.env.PAPERBOARD_DIR = dataDir();
		process.env.PAPERBOARD_RELEASE_PUBLIC_KEY = FIXTURE_PUBLIC_KEY;
	});
	afterAll(() => {
		restoreEnv("PAPERBOARD_DIR", appDir);
		restoreEnv("PAPERBOARD_RELEASE_PUBLIC_KEY", releaseKey);
	});
	afterEach(async () => {
		for (const pool of pools.splice(0)) pool.dispose();
		for (const crane of cranes.splice(0)) await crane.stop();
		await closeServers();
	});

	// the computer: its home, a bin folder on its PATH, and its daemon's data
	const computer = () => {
		const home = tempDir("pb-ssh-home-");
		const bin = path.join(home, "bin");
		fs.mkdirSync(bin);
		const data = dataDir();
		return { home, bin, data, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, PAPERBOARD_DIR: data } };
	};

	const run = async (server: TestServer, deps: Partial<ComputerSetupDeps> = {}, again?: ConnectionPool) => {
		// this computer starts with nothing paired, unless it sets up again
		if (!again) process.env.PAPERBOARD_DIR = dataDir();
		const pool = again ?? new ConnectionPool();
		if (!again) pools.push(pool);
		const sshDir = path.join(tempDir("pb-ssh-local-"), ".ssh");
		const states: ComputerSetupState[] = [];
		const job = new ComputerSetupJob("job", "127.0.0.1", undefined, {
			openSsh: (o) => openSsh({ ...o, port: server.port, sshDir, localUser: USER, agent: null }),
			defaultUsername: () => USER,
			craneIndex: async () => {
				throw new Error("this test publishes no releases");
			},
			probe: async (host, port) => (await pool.probe(host, port)).reachable,
			pair: async (host, port, code, name, expect) => ({ id: (await pool.pairComputer(host, port, code, name, expect)).id }),
			tempDir: () => tempDir(),
			changed: (state) => {
				states.push(state);
				// keys don't sign in here: the password is typed once asked
				if (state.signIn) queueMicrotask(() => job.signIn(USER, PASSWORD));
			},
			...deps,
		});
		await job.run();
		return { pool, states, sshDir, result: job.current().result };
	};

	// Inventory: Security — over SSH, pairing pins the certificate the computer's server names, and the password is kept nowhere.
	test("a computer running Paperboard Server pairs pinned to the certificate it names over SSH, and the password is saved nowhere", async () => {
		const box = computer();
		fs.symlinkSync(await craneBinary(), path.join(box.bin, "papercrane"));
		const crane = await startCrane({ dataDir: box.data, host: "0.0.0.0" });
		cranes.push(crane);
		const server = await startServer({ env: box.env });

		const { pool, states, sshDir, result } = await run(server);
		expect(result).toEqual({ paired: { id: expect.any(String) } });
		// asked once, after the keys were refused
		expect(states.filter((s) => s.signIn).length).toBe(1);
		expect(states.at(-1)!.steps.map((s) => [s.id, s.status])).toEqual([["connect", "success"], ["signIn", "success"], ["check", "success"], ["install", "success"], ["pair", "success"]]);
		const paired = pool.listComputers().find((c) => c.id === (result as { paired: { id: string } }).paired.id)!;
		await waitFor("the paired computer to connect", () => pool.listComputers().find((c) => c.id === paired.id)?.status.connected);
		// the roster names it by its key, and pins the certificate its server named
		expect(paired.id).toBe(memberIdOf(readTlsCert(path.join(box.data, "local"))!));
		expect(certFingerprint(pool.getComputer(paired.id)!.cert!)).toBe(certFingerprint(readTlsCert(path.join(box.data, "local"))!));
		for (const dir of [process.env.PAPERBOARD_DIR!, sshDir, box.home, box.data]) {
			for (const file of listTree(dir)) {
				const full = path.join(dir, file);
				if (fs.statSync(full).isFile()) expect(fs.readFileSync(full).includes(PASSWORD)).toBe(false);
			}
		}
	});

	// Inventory: Security — pairing a computer again replaces its pairing and gives the old token back.
	test("setting up a computer paired before keeps one entry, under its id, and leaves it one token", async () => {
		const box = computer();
		fs.symlinkSync(await craneBinary(), path.join(box.bin, "papercrane"));
		const crane = await startCrane({ dataDir: box.data, host: "0.0.0.0" });
		cranes.push(crane);
		const server = await startServer({ env: box.env });
		const tokens = () => (JSON.parse(fs.readFileSync(path.join(box.data, "local", "authorized_tokens.json"), "utf8")) as unknown[]).length;

		const first = await run(server);
		const id = (first.result as { paired: { id: string } }).paired.id;
		await waitFor("the paired computer to connect", () => first.pool.listComputers().find((c) => c.id === id)?.status.connected);
		const issued = tokens();
		// the same pool sets it up again, as a second Add Computer would
		const again = await run(server, {}, first.pool);
		expect(again.result).toEqual({ paired: { id } });
		expect(first.pool.listComputers().filter((c) => c.id !== "local").map((c) => c.id)).toEqual([id]);
		await waitFor("the old token to be given back", () => tokens() === issued);
		await waitFor("the computer to connect on the new token", () => first.pool.listComputers().find((c) => c.id === id)?.status.connected);
	});

	// Inventory: Security — a setup that stops after opening pairing leaves no code open on the computer.
	test("a setup that stops once pairing is open closes pairing on the computer", async () => {
		const box = computer();
		fs.symlinkSync(await craneBinary(), path.join(box.bin, "papercrane"));
		const crane = await startCrane({ dataDir: box.data, host: "0.0.0.0" });
		cranes.push(crane);
		const server = await startServer({ env: box.env });
		const rpc = await crane.rpc();
		try {
			const { result } = await run(server, {
				pair: async () => {
					expect(((await rpc.ok("system:pairing-status", {})) as { active: boolean }).active).toBe(true);
					throw new Error("the pairing went wrong");
				},
			});
			expect(result).toEqual({ failed: "the pairing went wrong" });
			await waitFor("pairing to close on the computer", async () => !((await rpc.ok("system:pairing-status", {})) as { active: boolean }).active);
		} finally {
			await rpc.close();
		}
	});

	// Inventory: Security — an address answering with a certificate other than the one named over SSH never gets the code.
	test("a server answering with another certificate than the one named over SSH is refused before the code is sent", async () => {
		const box = computer();
		const real = await startCrane({ dataDir: box.data, host: "0.0.0.0" });
		const impostor = await startCrane({ dataDir: dataDir(), host: "0.0.0.0" });
		cranes.push(real, impostor);
		const named = certFingerprint(readTlsCert(path.join(box.data, "local"))!);
		// a papercrane that names the real certificate but the impostor's port
		fs.writeFileSync(path.join(box.bin, "papercrane"), `#!/bin/sh
case "$1" in
  status) echo '{"running":true}' ;;
  pair) echo '{"code":"123456","listen":{"host":"0.0.0.0","port":${impostor.port}},"fingerprint":"${named}"}'; sleep 30 ;;
esac
`, { mode: 0o755 });
		const server = await startServer({ env: box.env });

		const { pool, result } = await run(server);
		expect(result).toEqual({ failed: expect.stringContaining("so the code wasn't sent") });
		expect(pool.listComputers().filter((c) => c.id !== "local")).toEqual([]);
	});

	test("signed in as root, the server is installed as a system service running as root, and lingering is left alone", async () => {
		const box = computer();
		const calls = path.join(box.home, "calls");
		fs.writeFileSync(path.join(box.bin, "id"), `#!/bin/sh\n[ "$1" = "-u" ] && echo 0 || echo root\n`, { mode: 0o755 });
		fs.writeFileSync(path.join(box.bin, "loginctl"), `#!/bin/sh\necho "loginctl $*" >> "${calls}"\n`, { mode: 0o755 });
		// installed but stopped: setup starts it, and pairing is where this one ends
		fs.writeFileSync(path.join(box.bin, "papercrane"), `#!/bin/sh
case "$1" in
  status) exit 3 ;;
  install-service) echo "papercrane $*" >> "${calls}" ;;
  pair) echo "no pairing here" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
		const server = await startServer({ env: box.env });
		const { result } = await run(server);
		expect(result).toEqual({ failed: expect.stringContaining("no pairing here") });
		expect(fs.readFileSync(calls, "utf8")).toBe("papercrane install-service --system --run-as root\n");
	});

	// the release is checked here, before a byte of it goes to the computer
	const target = `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
	const release = (binary: Buffer) => {
		const dir = tempDir();
		fs.writeFileSync(path.join(dir, `papercrane-${target}`), binary, { mode: 0o755 });
		const archive = path.join(dir, "crane.tar.gz");
		const tar = spawnSync("tar", ["-czf", archive, "-C", dir, `papercrane-${target}`]);
		if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
		return fs.readFileSync(archive);
	};

	// Inventory: Security — a server release not signed by the release key is never copied to the computer.
	test("a release without Paperboard's signature is refused before anything is copied, and a signed one arrives byte for byte", async () => {
		const box = computer();
		const server = await startServer({ env: box.env });
		// it can't run as a service here: install-service says so, and setup stops there
		const binary = Buffer.from("#!/bin/sh\necho 'no service manager here' >&2\nexit 1\n");
		const archive = release(binary);
		const web = serve({ "/crane.tar.gz": archive });
		const index = (key: "fixture" | "other") => async () => ({
			entries: { [target]: { version: "9.9.9", sha256: sha256(archive), signature: signCrane("9.9.9", sha256(archive), key), downloadUrl: `${web.url}/crane.tar.gz` } },
			downloadUrl: () => `${web.url}/crane.tar.gz`,
		});
		try {
			const unsigned = await run(server, { craneIndex: index("other"), probe: async () => false });
			expect(unsigned.result).toEqual({ failed: expect.stringContaining("isn't signed by Paperboard's release key") });
			expect(web.hits).toEqual([]);
			expect(fs.existsSync(path.join(box.home, ".local", "bin"))).toBe(false);

			const signed = await run(server, { craneIndex: index("fixture"), probe: async () => false });
			expect(signed.result).toEqual({ failed: expect.stringContaining("no service manager here") });
			const installed = path.join(box.home, ".local", "bin", "papercrane");
			expect(fs.readFileSync(installed).equals(binary)).toBe(true);
			expect(fs.statSync(installed).mode & 0o777).toBe(0o755);
			expect(fs.existsSync(`${installed}.part`)).toBe(false);
		} finally {
			await web.close();
		}
	});
});
