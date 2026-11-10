import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { TEST_TIMEOUT_MS } from "./support/wait";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { PaperCraneEngine } from "../../papercrane/engine";
import { PaperCraneAuth } from "../../papercrane/auth";
import { CredentialStore } from "../../papercrane/credentials";
import { readRemotes } from "../../papercrane/remotes";
import { parseBackupLocationRequest } from "../../src/renderer/src/lib/backupLocationRequest";
import { secretsApi } from "../../../../packages/paperapi/src/secrets";
import { CraneTransport } from "../../../../packages/paperapi/src/ws";
import { dataDir, listTree } from "./support/fs";
import { startDaemon, stopDaemon, type InProcessDaemon } from "./support/inproc";
import { installPanelFiles } from "./support/panels";
import type { Rpc } from "./support/rpc";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

async function withDaemon<T>(run: (daemon: InProcessDaemon) => Promise<T>, dir?: string): Promise<T> {
	const daemon = await startDaemon(dir ? { dataDir: dir } : {});
	try {
		return await run(daemon);
	} finally {
		await daemon.stop();
	}
}

// Panel RPCs take their panel from the token claim.
describe("panel RPCs take their panel from the token claim", () => {
	test("a scoped caller naming another panel is refused before anything is touched", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.victim" });
		await withDaemon(async (daemon) => {
			const host = await daemon.rpc();
			await host.ok("secrets:set", { panelId: "test.victim", name: "k", value: "original" });
			await host.ok("config:set", { id: "test.victim", data: { v: "original" } });
			const filesBefore = listTree(path.join(dir, "files"));
			const panel = await daemon.panelRpc("test.attacker");

			const calls: Array<[string, Record<string, unknown>]> = [
				["file:write", { appId: "test.victim", targetPath: "x.txt", content: "pwned" }],
				["file:read", { appId: "test.victim", targetPath: "x.txt" }],
				["file:getPath", { appId: "test.victim", targetPath: "" }],
				["config:get", { id: "test.victim" }],
				["config:set", { id: "test.victim", data: { v: "pwned" } }],
				["config:get", { id: "app-settings" }],
				["secrets:set", { panelId: "test.victim", name: "k", value: "pwned" }],
				["secrets:get", { panelId: "test.victim", name: "k" }],
				["secrets:list", { panelId: "test.victim" }],
				["secrets:purge", { panelId: "test.victim" }],
				["backup:status", { panelId: "test.victim" }],
				["backup:create", { panelId: "test.victim" }],
				["panel:uninstall", { panelId: "test.victim" }],
				["panel:restartService", { panelId: "test.victim" }],
				["system:usage", {}],
				["backup:destinations", {}],
				["backup:destination-add", { destination: { kind: "local", name: "x", path: dir } }],
				["backup:destination-reconnect", { destinationId: "d1" }],
				["backup:destination-remove", { destinationId: "d1" }],
				["backup:destinations-recover", {}],
				["backup:panel-destination-set", { panelId: "test.attacker", destinationId: null }],
			];
			for (const [action, params] of calls) {
				const refusal = await panel.fail(action, params);
				expect({ action, code: refusal.code }).toEqual({ action, code: "FORBIDDEN" });
			}
			expect((await host.ok("secrets:get", { panelId: "test.victim", name: "k" })).value).toBe("original");
			expect((await host.ok("config:get", { id: "test.victim" })).data).toEqual({ v: "original" });
			expect(listTree(path.join(dir, "files"))).toEqual(filesBefore);
			expect(fs.existsSync(path.join(dir, "panels", "test.victim", "manifest.json"))).toBe(true);
			await panel.close();
			await host.close();
		}, dir);
	});

	test("omitting appId lands in the caller's own panel, the host may name any panel, and malformed params are INVALID_PARAMS", async () => {
		await withDaemon(async (daemon) => {
			const panel = await daemon.panelRpc("test.self");
			await panel.ok("file:write", { targetPath: "note.txt", content: "mine" });
			expect(fs.readFileSync(path.join(daemon.dataDir, "files", "test.self", "note.txt"), "utf8")).toBe("mine");
			const host = await daemon.rpc();
			expect((await host.ok("file:read", { appId: "test.self", targetPath: "note.txt" })).content).toBe("mine");
			for (const [action, params] of [
				["file:read", { targetPath: 42 }],
				["config:get", { id: "../etc" }],
				["secrets:get", { name: "k" }],
				["actions:call", { panelId: "Not A Panel", action: "x" }],
			] as const) {
				expect((await panel.fail(action, params)).code).toBe("INVALID_PARAMS");
			}
			await panel.close();
			await host.close();
		});
	});

	test("a backup location request needs a requestId and the frame's own panel id, and a path-shaped sourceId is ignored", () => {
		const ok = parseBackupLocationRequest({ type: "paperboard:backup-location", requestId: "r1", panelId: "test.a" }, "test.a", false);
		expect(ok).toEqual({ requestId: "r1", refused: null });
		expect(parseBackupLocationRequest({ type: "paperboard:backup-location", panelId: "test.a" }, "test.a", false)).toBeNull();
		expect(parseBackupLocationRequest({ type: "paperboard:backup-location", requestId: "r1", panelId: "test.b" }, "test.a", false)?.refused).toContain("does not match");
		expect(parseBackupLocationRequest({ type: "paperboard:backup-location", requestId: "r1", panelId: "test.a", sourceId: "../../etc" }, "test.a", false)).toBeNull();
	});
});

// Config storage layout is stable and never overwrites what it can't read.
describe("config storage layout", () => {
	test("globals go in local/, panel configs in configs/, explicit paths in files/<panel>/, and data.json is never touched", async () => {
		const dir = dataDir();
		const legacy = path.join(dir, "files", "test.cfg", "data.json");
		fs.mkdirSync(path.dirname(legacy), { recursive: true });
		fs.writeFileSync(legacy, '{"legacy":true}');
		const engine = new PaperCraneEngine(dir);
		expect(await engine.getConfig("test.cfg")).toBeNull();
		await engine.setConfig("app-settings", { theme: "dark" });
		await engine.setConfig("shell-layout", { tabs: 1 });
		await engine.setConfig("test.cfg", { a: 1 });
		await engine.setConfig("test.cfg", { b: 2 }, "tabs.json");
		await engine.setConfig("test.cfg", { c: 3 }, "sub/other.json");
		expect(JSON.parse(fs.readFileSync(path.join(dir, "local", "app-settings.json"), "utf8"))).toEqual({ theme: "dark" });
		expect(JSON.parse(fs.readFileSync(path.join(dir, "local", "shell-layout.json"), "utf8"))).toEqual({ tabs: 1 });
		expect(JSON.parse(fs.readFileSync(path.join(dir, "configs", "test.cfg.json"), "utf8"))).toEqual({ a: 1 });
		expect(await engine.getConfig("test.cfg", "tabs.json")).toEqual({ b: 2 });
		expect(await engine.getConfig("test.cfg", "sub/other.json")).toEqual({ c: 3 });
		expect(await engine.getConfig("test.cfg")).toEqual({ a: 1 });
		expect(fs.readFileSync(legacy, "utf8")).toBe('{"legacy":true}');
	});

	test("a corrupt config throws and keeps its bytes", async () => {
		const dir = dataDir();
		const file = path.join(dir, "configs", "test.bad.json");
		fs.writeFileSync(file, "{not json");
		const engine = new PaperCraneEngine(dir);
		await expect(engine.getConfig("test.bad")).rejects.toThrow();
		expect(fs.readFileSync(file, "utf8")).toBe("{not json");
	});
});

// Unreadable state is quarantined, never read as empty or overwritten.
describe("unreadable state is quarantined", () => {
	const corruptCopies = (dir: string, name: string) => fs.readdirSync(dir).filter((f) => f.startsWith(`${name}.corrupt-`));

	test("token store, vault and paired computers: missing is default, corrupt is set aside with its bytes, unreadable throws", () => {
		const local = path.join(dataDir(), "local");
		const tokens = path.join(local, "authorized_tokens.json");
		const vault = path.join(local, "secrets.json");
		const remotes = path.join(local, "paired_computers.json");

		expect(new PaperCraneAuth(false, local).getAuthorizedClients()).toEqual([]);
		expect(readRemotes(remotes)).toEqual([]);

		for (const file of [tokens, vault, remotes]) fs.writeFileSync(file, "{broken");
		expect(new PaperCraneAuth(false, local).getAuthorizedClients()).toEqual([]);
		new CredentialStore(path.dirname(local));
		expect(readRemotes(remotes)).toEqual([]);
		for (const name of ["authorized_tokens.json", "secrets.json", "paired_computers.json"]) {
			const [copy] = corruptCopies(local, name);
			expect(fs.readFileSync(path.join(local, copy!), "utf8")).toBe("{broken");
		}

		// a path that exists but cannot be read as a file
		for (const file of [tokens, vault, remotes]) fs.mkdirSync(file);
		expect(() => new PaperCraneAuth(false, local)).toThrow();
		expect(() => new CredentialStore(path.dirname(local))).toThrow();
		expect(() => readRemotes(remotes)).toThrow();
	});

	test("a daemon that cannot write crane.json does not start, and atomic writes leave no temp files", async () => {
		const dir = dataDir();
		fs.mkdirSync(path.join(dir, "local", "crane.json", "occupied"), { recursive: true });
		await expect(startDaemon({ dataDir: dir })).rejects.toThrow();
		fs.rmSync(path.join(dir, "local", "crane.json"), { recursive: true });

		await withDaemon(async (daemon) => {
			const host = await daemon.rpc();
			await host.ok("config:set", { id: "test.atomic", data: { n: 1 } });
			await host.ok("secrets:set", { panelId: "test.atomic", name: "k", value: "v" });
			await host.close();
		}, dir);
		expect(listTree(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
	});

	test("only the daemon that owns the data dir sweeps temp downloads, and an interrupted swap is put back", async () => {
		const dir = dataDir();
		const packages = path.join(dir, "packages");
		const crane = await startDaemon({ dataDir: dir });
		// a download the running daemon has in flight
		fs.writeFileSync(path.join(packages, "java.tmp-123"), "partial");
		fs.mkdirSync(path.join(packages, ".replaced-1-node", "bin"), { recursive: true });
		fs.writeFileSync(path.join(packages, ".replaced-1-node", "bin", "node"), "old release");
		// a second daemon racing for the same data dir is refused before it sweeps
		const previous = process.env.PAPERBOARD_DIR;
		const { startPaperCraneServer } = await import("../../papercrane/index");
		await expect(startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false })).rejects.toThrow("already running");
		process.env.PAPERBOARD_DIR = previous;
		expect(fs.existsSync(path.join(packages, "java.tmp-123"))).toBe(true);
		await crane.stop();

		await withDaemon(async () => {
			expect(fs.existsSync(path.join(packages, "java.tmp-123"))).toBe(false);
			expect(fs.readFileSync(path.join(packages, "node", "bin", "node"), "utf8")).toBe("old release");
			expect(fs.existsSync(path.join(packages, ".replaced-1-node"))).toBe(false);
		}, dir);
	});
});

// Vault behaviour.
describe("the secret vault", () => {
	test("round-trips, lists sorted names per panel, refuses bad ids and names, persists, survives uninstall and purges only one panel", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.vault" });
		await withDaemon(async (daemon) => {
			const host = await daemon.rpc();
			await host.ok("secrets:set", { panelId: "test.vault", name: "zeta", value: "z" });
			await host.ok("secrets:set", { panelId: "test.vault", name: "alpha", value: "a" });
			await host.ok("secrets:set", { panelId: "test.other", name: "keep", value: "k" });
			expect(await host.ok("secrets:get", { panelId: "test.vault", name: "alpha" })).toEqual({ found: true, value: "a" });
			expect(await host.ok("secrets:get", { panelId: "test.vault", name: "nope" })).toEqual({ found: false, value: null });
			expect((await host.ok("secrets:list", { panelId: "test.vault" })).keys).toEqual(["alpha", "zeta"]);
			expect((await host.fail("secrets:set", { panelId: "../x", name: "a", value: "b" })).code).toBe("INVALID_PARAMS");
			expect((await host.fail("secrets:set", { panelId: "test.vault", name: "../a", value: "b" })).code).toBe("INVALID_PARAMS");

			const transport = new CraneTransport({ port: daemon.instance.localPort, token: daemon.instance.auth.issuePanelToken("test.vault"), computerId: "local" });
			expect(await secretsApi.list("test.vault", transport)).toEqual(["alpha", "zeta"]);
			transport.close();

			await host.ok("panel:uninstall", { panelId: "test.vault" });
			await host.close();
		}, dir);

		const store = new CredentialStore(dir);
		expect(store.get("zeta", "test.vault")).toEqual({ found: true, value: "z" });
		expect(store.purge("test.vault")).toBe(2);
		expect(store.list("test.vault")).toEqual([]);
		expect(new CredentialStore(dir).get("keep", "test.other").value).toBe("k");
		expect(fs.readFileSync(path.join(dir, "local", "secrets.json"), "utf8")).not.toContain('"z"');
		expect(fs.readdirSync(path.join(dir, "local")).filter((f) => f.startsWith("secrets.json") && f !== "secrets.json")).toEqual([]);
	});
});

// The port registry never hands one port to two claimants.
describe("the port registry", () => {
	async function holdPort(): Promise<{ port: number; close: () => Promise<void> }> {
		const server = net.createServer();
		await new Promise<void>((resolve) => server.listen({ port: 0, host: "0.0.0.0" }, () => resolve()));
		return { port: (server.address() as net.AddressInfo).port, close: () => new Promise((resolve) => server.close(() => resolve())) };
	}

	test("a port another program holds is refused or moved by policy, a held number is never given twice, and grants persist", async () => {
		const dir = dataDir();
		const busy = await holdPort();
		let granted = 0;
		await withDaemon(async (daemon) => {
			const host = await daemon.rpc();
			const a = await daemon.panelRpc("test.porta");
			const b = await daemon.panelRpc("test.portb");
			const claim = (rpc: Rpc, name: string, preferred: number) =>
				rpc.call("ports:claim", { panelId: rpc === a ? "test.porta" : "test.portb", name, label: `Server ${name}`, protocol: "tcp", preferred });

			expect((await a.fail("ports:policy-set", { policy: "refuse" })).code).toBe("FORBIDDEN");
			expect((await a.fail("ports:claim", { panelId: "test.portb", name: "x", label: "X", protocol: "tcp", preferred: 30000 })).code).toBe("FORBIDDEN");

			await host.ok("ports:policy-set", { policy: "refuse" });
			const refused = await claim(a, "java", busy.port);
			expect(refused.code).toBe("CONFLICT");
			expect(refused.error).toContain("another program on this computer is using it");

			await host.ok("ports:policy-set", { policy: "next-free" });
			const moved = (await claim(a, "java", busy.port)).result;
			expect(moved.port).toBeGreaterThan(busy.port);
			expect(moved.port).toBeLessThanOrEqual(busy.port + 100);
			granted = moved.port;

			const second = (await claim(b, "game", granted)).result;
			expect(second.port).not.toBe(granted);
			await host.ok("ports:policy-set", { policy: "refuse" });
			const named = await claim(b, "other", granted);
			expect(named.code).toBe("CONFLICT");
			expect(named.error).toContain("Server java has it");
			for (const s of [host, a, b]) await s.close();
		}, dir);
		await busy.close();

		await withDaemon(async (daemon) => {
			const a = await daemon.panelRpc("test.porta");
			expect((await a.ok("ports:list", { panelId: "test.porta" })).claims.map((c: any) => c.port)).toEqual([granted]);
			await a.close();
		}, dir);
	});
});
