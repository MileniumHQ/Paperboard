import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { PaperCraneClient } from "../../src/main/communication/papercrane/PaperCraneClient";
import { CraneTransport } from "../../../../packages/paperapi/src/ws";
import { PROTOCOL_VERSION as SDK_PROTOCOL_VERSION } from "../../../../packages/paperapi/src/protocol";
import { PROTOCOL_VERSION } from "../../papercrane/protocol";
import { DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE, daemonProof } from "../../papercrane/handshake";
import { childEnv, readHandshake, runCrane, startCrane } from "./support/crane";
import { dataDir } from "./support/fs";
import { startDaemon, stopDaemon } from "./support/inproc";
import { installPanelFiles } from "./support/panels";
import { Rpc } from "./support/rpc";
import { TEST_TIMEOUT_MS, within } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

// A loopback WebSocket listener that records every frame it receives.
async function fakeListener(onConnection: (ws: ServerSocket, challenge: string | undefined) => void) {
	const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
	const received: string[] = [];
	wss.on("connection", (ws, req) => {
		ws.on("message", (data) => received.push(String(data)));
		onConnection(ws, req.headers[DAEMON_CHALLENGE_HEADER] as string | undefined);
	});
	const port = (wss.address() as { port: number }).port;
	return {
		port,
		received,
		close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
	};
}

function withDataDir<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const previous = process.env.PAPERBOARD_DIR;
	process.env.PAPERBOARD_DIR = dir;
	return run().finally(() => {
		process.env.PAPERBOARD_DIR = previous;
	});
}

// The app sends the master token only to a daemon that proves itself.
describe("the master token goes only to a daemon that proves itself", () => {
	const master = `pc_${"ab".repeat(24)}`;
	const impostors: Record<string, (ws: ServerSocket, challenge: string | undefined) => void> = {
		"no proof": () => undefined,
		"a bad proof": (ws) => ws.send(JSON.stringify({ type: DAEMON_PROOF_TYPE, proof: "0".repeat(64) })),
		"a replayed proof": (ws) =>
			ws.send(JSON.stringify({ type: DAEMON_PROOF_TYPE, proof: daemonProof(master, crypto.randomBytes(32).toString("hex")) })),
	};
	for (const [kind, behave] of Object.entries(impostors)) {
		test(`an impostor answering with ${kind} never gets the token, and the app starts its own daemon`, async () => {
			const dir = dataDir();
			const impostor = await fakeListener(behave);
			fs.writeFileSync(path.join(dir, "local", "crane.json"), JSON.stringify({ port: impostor.port, token: master, startId: "old" }));
			const client = new PaperCraneClient();
			await withDataDir(dir, async () => {
				expect(client.getLocalCredentials()).toBeNull();
				await client.connect();
				const embedded = client.getEmbeddedServer();
				expect(embedded).not.toBeNull();
				expect(client.getToken()).not.toBe(master);
				expect(client.getPort()).not.toBe(impostor.port);
				expect(client.getLocalCredentials()?.token).toBe(client.getToken());
				client.disconnect();
				const closed = new Promise<void>((resolve) => embedded!.server.once("close", () => resolve()));
				client.stopEmbeddedServer();
				await within("the embedded daemon to stop", closed);
			});
			expect(impostor.received.some((frame) => frame.includes(master))).toBe(false);
			await impostor.close();
		});
	}

	test("a restarted daemon refuses the previous daemon's token", async () => {
		const dir = dataDir();
		const first = await startDaemon({ dataDir: dir, staticToken: "pc_first_session_token" });
		await first.stop();
		const second = await startDaemon({ dataDir: dir, staticToken: "pc_second_session_token" });
		const socket = await Rpc.open(second.url);
		expect((await socket.fail("auth:verify", { token: "pc_first_session_token" })).code).toBe("AUTH_REQUIRED");
		await socket.ok("auth:verify", { token: "pc_second_session_token" });
		await socket.close();
	});

	test("panel documents get a scoped panel token, never the master, and credentials only once verified", async () => {
		const dir = dataDir();
		await installPanelFiles(dir, { id: "test.page" });
		await withDataDir(dir, async () => {
			const { default: connectionPool } = await import("../../src/main/communication/papercrane/ConnectionPool");
			const { servePanelAsset } = await import("../../src/main/panelServe");
			const local = connectionPool.getClient("local");
			expect(local.getLocalCredentials()).toBeNull();
			await local.connect();
			const html = await (await servePanelAsset("local", "test.page", "/index.html")).text();
			const payload = JSON.parse(/window\.__PAPERBOARD_CRANE=(\{.*?\});<\/script>/.exec(html)![1]!);
			expect(payload.token).not.toBe(local.getToken());
			expect(payload.panelId).toBe("test.page");
			const embedded = local.getEmbeddedServer()!;
			expect(embedded.auth.resolveToken(payload.token)?.panelId).toBe("test.page");
			local.disconnect();
			const closed = new Promise<void>((resolve) => embedded.server.once("close", () => resolve()));
			local.stopEmbeddedServer();
			await within("the embedded daemon to stop", closed);
		});
	});

	test("both clients put their own token last and send the shared protocol version", async () => {
		expect(SDK_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
		const token = "pc_real_token";
		const listener = await fakeListener((ws, challenge) => {
			if (challenge) ws.send(JSON.stringify({ type: DAEMON_PROOF_TYPE, proof: daemonProof(token, challenge) }));
			ws.on("message", (data) => {
				const frame = JSON.parse(String(data));
				ws.send(JSON.stringify({ type: "response", id: frame.id, result: { success: true } }));
			});
		});
		const dir = dataDir();
		fs.writeFileSync(path.join(dir, "local", "crane.json"), JSON.stringify({ port: listener.port, token }));
		const client = new PaperCraneClient();
		await withDataDir(dir, async () => {
			await client.connect();
			await client.call("system:info", { token: "pc_smuggled", v: 99 });
			client.disconnect();
		});
		const transport = new CraneTransport({ port: listener.port, token, computerId: "local" });
		await transport.call("system:info", { token: "pc_smuggled", v: 99 });
		transport.close();

		const calls = listener.received.map((f) => JSON.parse(f)).filter((f) => f.action === "system:info");
		expect(calls).toHaveLength(2);
		for (const call of calls) {
			expect(call.params.token).toBe(token);
			expect(call.params.v).toBe(PROTOCOL_VERSION);
		}
		await listener.close();
	});
});

// The app sends the master token only to a daemon that proves itself (one daemon per data directory).
describe("one daemon per data directory", () => {
	test("a second daemon on a live data dir exits 1 without listening and leaves crane.json alone", async () => {
		const dir = dataDir();
		const first = await startCrane({ dataDir: dir });
		const before = fs.readFileSync(path.join(dir, "local", "crane.json"));
		const second = await runCrane(["--headless", "--host", "127.0.0.1", "--port", "0"], childEnv(dir));
		expect(second.code).toBe(1);
		expect(second.output).toContain("already running");
		expect(fs.readFileSync(path.join(dir, "local", "crane.json")).equals(before)).toBe(true);
		const { code } = await first.stop();
		expect(code).toBe(0);
		// SIGTERM removed its own handshake
		expect(readHandshake(dir)).toBeNull();
	});

	test("a stale crane.json does not block a start, and stop() leaves another start's crane.json alone", async () => {
		const dir = dataDir();
		fs.writeFileSync(path.join(dir, "local", "crane.json"), JSON.stringify({ port: 1, token: "pc_stale", startId: "gone", pid: 999999 }));
		const daemon = await startDaemon({ dataDir: dir });
		expect(readHandshake(dir)?.startId).not.toBe("gone");
		const foreign = JSON.stringify({ port: 2, token: "pc_other", startId: "someone-else" });
		fs.writeFileSync(path.join(dir, "local", "crane.json"), foreign);
		await daemon.stop();
		expect(fs.readFileSync(path.join(dir, "local", "crane.json"), "utf8")).toBe(foreign);
	});
});
