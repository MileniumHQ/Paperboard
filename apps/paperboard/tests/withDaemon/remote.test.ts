import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as path from "node:path";
import * as tls from "node:tls";
import { WebSocketServer } from "ws";
import { PaperCraneAuth } from "daemon/security/auth";
import { PaperCraneEngine } from "daemon/engine/index";
import { pinnedTlsOptions } from "daemon/security/pinnedTls";
import { createTlsIdentity } from "daemon/security/tlsIdentity";
import { setupWebSocketServer } from "daemon/server/ws";
import { ConnectionPool } from "../../src/main/communication/papercrane/ConnectionPool";
import { PaperCraneClient } from "../../src/main/communication/papercrane/PaperCraneClient";
import { dataDir, modeOf, restoreEnv } from "testkit/fs";
import { type InProcessDaemon, request, startDaemon, stopDaemon } from "testkit/inproc";
import { Rpc } from "testkit/rpc";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const identityOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "local", "tls_identity.json"), "utf8")) as { key: string; cert: string };

function pinnedGet(port: number, cert: string, host = "127.0.0.1"): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = https.request({ host, port, path: "/health", agent: false, ...pinnedTlsOptions(cert) }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", reject);
		req.end();
	});
}

function connectError(host: string, port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(port, host);
		socket.once("connect", () => {
			socket.destroy();
			reject(new Error(`${host}:${port} accepted a connection`));
		});
		socket.once("error", (err) => resolve((err as NodeJS.ErrnoException).code ?? err.message));
	});
}

// A TCP hop that can stop forwarding in both directions while keeping the
// sockets open: a computer that went to sleep, as seen from the network.
async function freezableHop(target: number, bind = "127.0.0.1") {
	let frozen = false;
	let connections = 0;
	const held: net.Socket[] = [];
	const server = net.createServer((client) => {
		connections++;
		const upstream = net.connect(target, "127.0.0.1");
		held.push(client, upstream);
		client.on("data", (chunk) => {
			if (!frozen) upstream.write(chunk);
		});
		upstream.on("data", (chunk) => {
			if (!frozen) client.write(chunk);
		});
		const end = () => {
			client.destroy();
			upstream.destroy();
		};
		client.on("close", end);
		upstream.on("close", end);
		client.on("error", end);
		upstream.on("error", end);
	});
	await new Promise<void>((resolve) => server.listen(0, bind, resolve));
	return {
		port: (server.address() as net.AddressInfo).port,
		connections: () => connections,
		freeze: () => (frozen = true),
		thaw: () => (frozen = false),
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of held) socket.destroy();
				server.close(() => resolve());
			}),
	};
}

// The daemon's TLS identity is stable and the network port is TLS-only.
describe("TLS identity", () => {
	afterEach(stopDaemon);

	test("the first start creates a P-256 certificate (0600) that every later start reuses", async () => {
		const dir = dataDir();
		const first = await startDaemon({ dataDir: dir, host: "0.0.0.0" });
		const identity = identityOf(dir);
		expect(modeOf(path.join(dir, "local", "tls_identity.json"))).toBe(0o600);
		expect(new crypto.X509Certificate(identity.cert).publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
		expect(await pinnedGet(first.port, identity.cert)).toBe(200);
		await first.stop();
		const second = await startDaemon({ dataDir: dir, host: "0.0.0.0" });
		expect(identityOf(dir)).toEqual(identity);
		expect(await pinnedGet(second.port, identity.cert)).toBe(200);
	});

	test("an unreadable or mismatched identity refuses to start and is never replaced", async () => {
		for (const bytes of ["{not json", JSON.stringify({ key: createTlsIdentity().key, cert: createTlsIdentity().cert })]) {
			const dir = dataDir();
			fs.mkdirSync(path.join(dir, "local"), { recursive: true });
			fs.writeFileSync(path.join(dir, "local", "tls_identity.json"), bytes, { mode: 0o600 });
			await expect(startDaemon({ dataDir: dir, host: "0.0.0.0" })).rejects.toThrow();
			expect(fs.readFileSync(path.join(dir, "local", "tls_identity.json"), "utf8")).toBe(bytes);
		}
	});

	test("a network bind serves TLS on port and plaintext only on the loopback localPort; --no-auth off loopback refuses to start", async () => {
		const daemon = await startDaemon({ host: "0.0.0.0" });
		expect(daemon.port).not.toBe(daemon.instance.localPort);
		// plaintext HTTP on the network port gets no HTTP answer
		await expect(request(daemon.port, { path: "/health" })).rejects.toThrow();
		expect((await request(daemon.instance.localPort, { path: "/health" })).status).toBe(200);
		// the plaintext port is bound to 127.0.0.1 only
		expect(await connectError("127.0.0.2", daemon.instance.localPort)).toBe("ECONNREFUSED");
		await daemon.stop();
		await expect(startDaemon({ host: "0.0.0.0", noAuth: true })).rejects.toThrow();
	});
});

// Paired computers are pinned and stay connected.
describe("paired computers", () => {
	let remote: InProcessDaemon;
	let remoteDir: string;
	let cert: string;
	let pairedToken: string;
	beforeAll(async () => {
		remoteDir = dataDir();
		remote = await startDaemon({ dataDir: remoteDir, host: "0.0.0.0" });
		cert = identityOf(remoteDir).cert;
	});
	afterAll(() => remote.stop());

	// 127.0.0.2 is not loopback to the client, so it dials pinned TLS
	const REMOTE_HOST = "127.0.0.2";

	test("pairing captures the certificate, and reconnects over RPC and HTTP are pinned to it", async () => {
		const pairer = new PaperCraneClient();
		await pairer.connectForPairing(REMOTE_HOST, remote.port);
		const code = remote.instance.auth.startPairing();
		pairedToken = (await pairer.pair(code, "CI laptop")).token;
		expect(pairedToken).toMatch(/^pc_/);
		expect(pairer.getCert()).toBe(cert);
		pairer.disconnect();

		const client = new PaperCraneClient();
		const status = await client.connect(REMOTE_HOST, remote.port, pairedToken, cert);
		expect(status.connected).toBe(true);
		expect((await client.request("/health")).status).toBe(200);
		client.disconnect();

		const impostor = new PaperCraneClient();
		await expect(impostor.connect(REMOTE_HOST, remote.port, pairedToken, createTlsIdentity().cert)).rejects.toThrow();
		expect(impostor.getStatus().connected).toBe(false);
		await expect(impostor.request("/health")).rejects.toThrow();
		impostor.disconnect();
	});

	test("a computer at an IPv6 address pairs, and its RPC and HTTP reach it", async () => {
		const hop = await freezableHop(remote.port, "::1");
		const pairer = new PaperCraneClient();
		const client = new PaperCraneClient();
		try {
			await pairer.connectForPairing("::1", hop.port);
			const token = (await pairer.pair(remote.instance.auth.startPairing(), "IPv6 laptop")).token;
			expect(pairer.getCert()).toBe(cert);
			expect((await client.connect("::1", hop.port, token, cert)).connected).toBe(true);
			expect((await client.request("/health")).status).toBe(200);
		} finally {
			pairer.disconnect();
			client.disconnect();
			await hop.close();
		}
	});

	test("a paired client reconnects after the daemon restarts, and its heartbeat reports a frozen path and recovers", async () => {
		const hop = await freezableHop(remote.port, REMOTE_HOST);
		const client = new PaperCraneClient({ heartbeatMs: 100, reconnectBaseMs: 20, reconnectMaxMs: 100 });
		try {
			expect((await client.connect(REMOTE_HOST, hop.port, pairedToken, cert)).connected).toBe(true);

			hop.freeze();
			await waitFor("the heartbeat to notice the frozen path", () => client.getStatus().error === "The computer stopped responding");
			hop.thaw();
			await waitFor("the client to reconnect once the path recovers", () => client.getStatus().connected);

			const port = remote.port;
			await remote.stop();
			await waitFor("the client to see the daemon go", () => !client.getStatus().connected);
			remote = await startDaemon({ dataDir: remoteDir, host: "0.0.0.0", port });
			await waitFor("the client to reconnect to the restarted daemon", () => client.getStatus().connected, { timeoutMs: 30_000 });
		} finally {
			client.disconnect();
			await hop.close();
		}
	});

	test("a computer that never answers fails its connect in time, and a disconnect settles an attempt under way", async () => {
		const silent = await freezableHop(remote.port, REMOTE_HOST);
		silent.freeze();
		const client = new PaperCraneClient({ connectTimeoutMs: 300, reconnectBaseMs: 60_000, reconnectMaxMs: 60_000 });
		try {
			await expect(client.connect(REMOTE_HOST, silent.port, pairedToken, cert)).rejects.toThrow("no answer within 0.3 s");
			expect(client.getStatus().error).toContain("no answer within 0.3 s");

			const attempt = client.connect(REMOTE_HOST, silent.port, pairedToken, cert);
			client.disconnect();
			await expect(attempt).rejects.toThrow("Connection attempt was superseded");
			// the next call dials afresh instead of waiting on the abandoned attempt
			await expect(client.connect(REMOTE_HOST, remote.port, pairedToken, cert)).resolves.toMatchObject({ connected: true });
		} finally {
			client.disconnect();
			await silent.close();
		}
	});

	test("a revoked pairing fails with 'pair it again' and is not retried", async () => {
		const code = remote.instance.auth.startPairing();
		const pairer = new PaperCraneClient();
		await pairer.connectForPairing(REMOTE_HOST, remote.port);
		const token = (await pairer.pair(code, "to revoke")).token;
		pairer.disconnect();

		const hop = await freezableHop(remote.port, REMOTE_HOST);
		const client = new PaperCraneClient({ heartbeatMs: 60_000, reconnectBaseMs: 0, reconnectMaxMs: 0 });
		try {
			expect((await client.connect(REMOTE_HOST, hop.port, token, cert)).connected).toBe(true);
			remote.instance.auth.revokeToken(token);
			// the daemon checks the credential on the socket's next frame
			await client.call("system:info", {}).then(
				() => {
					throw new Error("a revoked pairing answered a call");
				},
				(err: Error) => err,
			);
			await waitFor("the revocation to reach the client", () => client.getStatus().error?.includes("pair it again"));
			const dialed = hop.connections();
			client.wake();
			// a zero-delay retry would dial before this round trip through the same hop finishes
			expect(await pinnedGet(hop.port, cert, REMOTE_HOST)).toBe(200);
			expect(hop.connections()).toBe(dialed + 1);
			expect(client.getStatus().connected).toBe(false);
		} finally {
			client.disconnect();
			await hop.close();
		}
	});

	// While `remote` runs, PAPERBOARD_DIR is its data folder: to a pool opened
	// now it is this computer's own daemon. An ssh tunnel puts another
	// computer at 127.0.0.1 too, so the address tells neither apart.
	// Inventory: Security — pairing lands on the computer that answered, never on this one's own daemon.
	test("pairing at 127.0.0.1 pairs the tunnel's computer pinned, and refuses this computer's own daemon in words before the code is sent", async () => {
		const far = await scriptedRemote((frame, reply) => {
			if (frame.action === "auth:pair") {
				reply({ type: "response", id: frame.id, result: { success: true, token: "pc_far", hostname: "far", os: "linux", arch: "x64" } });
			}
		});
		const pool = new ConnectionPool();
		try {
			const paired = await pool.pairComputer("127.0.0.1", far.port, "123456");
			expect(paired.cert).toBe(far.cert);
			expect(far.frames.map((f) => JSON.parse(f).params?.code)).toContain("123456");

			const clientsBefore = remote.instance.auth.getAuthorizedClients().length;
			const code = remote.instance.auth.startPairing();
			await expect(pool.pairComputer("127.0.0.1", remote.port, code)).rejects.toThrow(
				"That's this computer's own Paperboard server, not another computer",
			);
			expect(remote.instance.auth.getAuthorizedClients()).toHaveLength(clientsBefore);
		} finally {
			pool.dispose();
			await far.close();
		}
	});

	// Inventory: Security — a credential never crosses an unencrypted socket, whatever the address.
	test("a computer with no pinned certificate is never sent its token or a pairing code, at a loopback address too", async () => {
		const frames: string[] = [];
		const server = http.createServer();
		const wss = new WebSocketServer({ server });
		wss.on("connection", (ws) => ws.on("message", (data) => frames.push(data.toString())));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as net.AddressInfo).port;
		const client = new PaperCraneClient({ reconnectBaseMs: 60_000, reconnectMaxMs: 60_000 });
		const pool = new ConnectionPool();
		try {
			await expect(client.connect("127.0.0.1", port, "pc_paired_secret")).rejects.toThrow("has no pinned certificate");
			await expect(client.request("/health")).rejects.toThrow("has no pinned certificate");
			await expect(pool.pairComputer("127.0.0.1", port, "654321")).rejects.toThrow();
			expect(frames).toEqual([]);
		} finally {
			client.disconnect();
			pool.dispose();
			for (const ws of wss.clients) ws.terminate();
			wss.close();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});

// A paired computer is its certificate, wherever it answers: it is kept at
// its .local name, dialed there and at its last address at once, and
// followed to a new address, each only once the pinned certificate answers.
describe("a paired computer found again", () => {
	let localDir: string | undefined;
	beforeAll(() => {
		// this computer has no daemon of its own here, so no remote is mistaken for it
		localDir = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = dataDir();
	});
	afterAll(() => restoreEnv("PAPERBOARD_DIR", localDir));

	// a daemon that takes frames and answers none
	const unanswering = () => {
		// says nothing: only what it was sent matters
	};

	// answers pairing with the name it says it answers to, and every sign-in
	const answering = (mdnsName: string) => (frame: any, reply: (frame: unknown) => void) => {
		const facts = { hostname: "far", os: "linux", arch: "x64", mdnsName };
		if (frame.action === "auth:pair") reply({ type: "response", id: frame.id, result: { success: true, token: "pc_far", ...facts } });
		if (frame.action === "auth:verify") reply({ type: "response", id: frame.id, result: { success: true, ...facts } });
	};

	// Inventory: Security — a name is kept for a paired computer only when its pinned certificate answers there.
	test("pairing by IP keeps the name the computer gives only when that name leads to its certificate", async () => {
		// the same computer at 127.0.0.2 and, by the name it gives, at 127.0.0.3
		const far = await scriptedRemote(answering("127.0.0.3"), { bind: "0.0.0.0" });
		// a computer that names 127.0.0.6, where another certificate answers on its port
		const misnamed = await scriptedRemote(answering("127.0.0.6"), { bind: "127.0.0.5" });
		const other = await scriptedRemote(unanswering, { bind: "127.0.0.6", port: misnamed.port });
		const pool = new ConnectionPool();
		try {
			const named = await pool.pairComputer("127.0.0.2", far.port, "123456");
			expect({ host: named.host, address: named.address }).toEqual({ host: "127.0.0.3", address: "127.0.0.2" });
			const unnamed = await pool.pairComputer("127.0.0.5", misnamed.port, "123456");
			expect({ host: unnamed.host, address: unnamed.address }).toEqual({ host: "127.0.0.5", address: undefined });
			expect(other.frames).toEqual([]);
		} finally {
			pool.dispose();
			await Promise.all([far.close(), misnamed.close(), other.close()]);
		}
	});

	// Inventory: Security — a copied fingerprint never moves a paired computer to another machine.
	test("a sighting is followed only where the pinned certificate answers, and the client reconnects there", async () => {
		const far = await scriptedRemote(answering("far.local"), { bind: "127.0.0.2" });
		// another machine advertising the paired computer's fingerprint, on its port
		const impostor = await scriptedRemote(unanswering, { bind: "127.0.0.4", port: far.port });
		const pool = new ConnectionPool();
		let moved: Awaited<ReturnType<typeof scriptedRemote>> | undefined;
		try {
			const { id } = await pool.pairComputer("127.0.0.2", far.port, "123456");
			const record = () => pool.listComputers().find((c) => c.id === id)!;
			await waitFor("the paired computer to connect", () => record().status.connected);
			const fingerprint = new crypto.X509Certificate(far.cert).fingerprint256;
			const sighting = (host: string, port: number) => [{ id: "seen", name: "far", host, port, fingerprint }];

			await pool.followDiscovered(sighting("127.0.0.4", far.port));
			expect({ host: record().host, port: record().port }).toEqual({ host: "127.0.0.2", port: far.port });
			expect(impostor.frames).toEqual([]);

			// the computer goes away and comes back at a new address and port
			await far.close();
			await waitFor("the paired computer to drop", () => !record().status.connected);
			moved = await scriptedRemote(answering("far.local"), { identity: far.identity, bind: "127.0.0.5" });
			await pool.followDiscovered(sighting("127.0.0.5", moved.port));
			expect({ host: record().host, port: record().port }).toEqual({ host: "127.0.0.5", port: moved.port });
			await waitFor("the client to reconnect at the new address", () => record().status.connected && record().status.host === "127.0.0.5");
			expect(impostor.frames).toEqual([]);
		} finally {
			pool.dispose();
			await Promise.all([impostor.close(), moved?.close()]);
		}
	});

	// Inventory: Security — a paired computer's credential goes only to the address its pinned certificate answers at.
	test("a computer known by two addresses is dialed at both, and only the one with its certificate is sent the token", async () => {
		const far = await scriptedRemote(answering("far.local"), { bind: "127.0.0.2" });
		const impostor = await scriptedRemote(unanswering, { bind: "127.0.0.4", port: far.port });
		const client = new PaperCraneClient({ reconnectBaseMs: 60_000, reconnectMaxMs: 60_000 });
		try {
			const status = await client.connect(["127.0.0.4", "127.0.0.2"], far.port, "pc_far", far.cert);
			expect({ connected: status.connected, host: status.host }).toEqual({ connected: true, host: "127.0.0.2" });
			expect(impostor.frames).toEqual([]);
		} finally {
			client.disconnect();
			await Promise.all([far.close(), impostor.close()]);
		}
	});
});

// The local daemon whose sockets open tunnels: the real WS server and auth,
// with the tunnel heartbeat shortened.
// `standalone` passes no remotesFile, as `papercrane serve` and the systemd
// service do: the daemon must find the file in its own data folder.
async function tunnelHost(remotes: unknown[], { standalone = false } = {}) {
	const dir = dataDir();
	const remotesFile = path.join(dir, "local", "paired_computers.json");
	fs.writeFileSync(remotesFile, JSON.stringify({ computers: remotes }));
	const engine = new PaperCraneEngine(dir);
	const auth = new PaperCraneAuth(false, path.join(dir, "local"));
	const hostToken = crypto.randomBytes(24).toString("hex");
	auth.injectToken(hostToken, "host");
	const server = http.createServer();
	const wss = new WebSocketServer({ server });
	setupWebSocketServer(wss, engine, auth, { ...(standalone ? {} : { remotesFile }), tunnelHeartbeatMs: 100 });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
	return {
		auth,
		url,
		remotesFile,
		host: () => Rpc.authed(url, hostToken),
		socket: (token: string) => Rpc.authed(url, token),
		close: async () => {
			for (const client of wss.clients) client.terminate();
			wss.close();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

// A remote computer that is not Paperboard: a pinned TLS WebSocket server
// whose answers the test scripts. Records every frame it receives.
// A daemon whose RPC answers are scripted. It serves /health like a daemon
// does, and can take another's identity (the same computer at a new address)
// and listen at any address and port.
async function scriptedRemote(
	script: (frame: any, reply: (frame: unknown) => void) => void,
	at: { identity?: { key: string; cert: string }; bind?: string; port?: number } = {},
) {
	const identity = at.identity ?? createTlsIdentity();
	const frames: string[] = [];
	const server = https.createServer({ key: identity.key, cert: identity.cert }, (req, res) => {
		res.writeHead(req.url === "/health" ? 200 : 404);
		res.end();
	});
	const wss = new WebSocketServer({ server });
	wss.on("connection", (ws) => {
		ws.on("message", (data) => {
			frames.push(data.toString());
			script(JSON.parse(data.toString()), (frame) => ws.send(JSON.stringify(frame)));
		});
	});
	await new Promise<void>((resolve) => server.listen(at.port ?? 0, at.bind ?? "127.0.0.1", resolve));
	return {
		identity,
		cert: identity.cert,
		port: (server.address() as net.AddressInfo).port,
		frames,
		close: async () => {
			for (const client of wss.clients) client.terminate();
			wss.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

// A TLS server with a certificate of its own, recording any bytes a client sends after the handshake.
async function impostorServer() {
	const identity = createTlsIdentity();
	let accepted = 0;
	let received = "";
	const server = tls.createServer({ key: identity.key, cert: identity.cert }, (socket) => {
		socket.on("data", (chunk) => (received += chunk.toString()));
		socket.on("error", () => socket.destroy());
	});
	server.on("connection", () => accepted++);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: (server.address() as net.AddressInfo).port,
		accepted: () => accepted,
		received: () => received,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const tunnelClosed = (rpc: Rpc, id: string) => rpc.next((f) => f.type === "tunnel-closed" && f.id === id, 15_000, `tunnel ${id} to close`);
const tunnelOpen = (rpc: Rpc, id: string) => rpc.next((f) => f.type === "tunnel-open" && f.id === id, 15_000, `tunnel ${id} to open`);

// Tunnels open only for authenticated sockets to the right pinned computer.
// Scoped and relay tokens can't escalate.
describe("tunnels and scoped credentials", () => {
	let remote: InProcessDaemon;
	let remoteCert: string;
	let remoteToken: string;
	beforeAll(async () => {
		const dir = dataDir();
		remote = await startDaemon({ dataDir: dir, host: "0.0.0.0" });
		remoteCert = identityOf(dir).cert;
		const code = remote.instance.auth.startPairing();
		remoteToken = remote.instance.auth.pair(code, "the local computer", "127.0.0.1").token!;
		await remote.instance.engine.setConfig("test.a", { mine: true });
		await remote.instance.engine.setConfig("test.b", { theirs: true });
	});
	afterAll(() => remote.stop());

	test("remote:open before auth gets AUTH_REQUIRED, and a pre-auth action_reply never reaches the registry", async () => {
		const local = await tunnelHost([{ id: "far", name: "Far", host: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken }]);
		try {
			const anonymous = await Rpc.open(local.url);
			anonymous.send({ type: "remote:open", tunnelId: "t0", computerId: "far" });
			expect((await tunnelClosed(anonymous, "t0")).code).toBe("AUTH_REQUIRED");

			const owner = await local.host();
			await owner.ok("actions:register", { panelId: "test.answerer", action: "ask" });
			const caller = await local.host();
			const answer = caller.call("actions:call", { panelId: "test.answerer", action: "ask", args: [] });
			const call = await owner.next((f) => f.type === "action_call");
			anonymous.send({ type: "action_reply", callId: call.callId, result: "forged" });
			// the anonymous socket's frames are handled in order: this answer comes after the forged reply was seen
			expect((await anonymous.call("auth:verify", { token: "wrong" })).code).toBe("AUTH_REQUIRED");
			owner.send({ type: "action_reply", callId: call.callId, result: "genuine" });
			expect((await answer).result).toEqual({ result: "genuine" });
		} finally {
			await local.close();
		}
	});

	test("a standalone daemon tunnels to the computers paired in its own data folder", async () => {
		const local = await tunnelHost([{ id: "far", name: "Far", host: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken }], { standalone: true });
		const previous = process.env.PAPERBOARD_DIR;
		process.env.PAPERBOARD_DIR = path.dirname(path.dirname(local.remotesFile));
		try {
			const host = await local.host();
			host.send({ type: "remote:open", tunnelId: "s1", computerId: "far" });
			await tunnelOpen(host, "s1");
		} finally {
			restoreEnv("PAPERBOARD_DIR", previous);
			await local.close();
		}
	});

	// Inventory: Core contract — panels reach a paired computer whose .local name doesn't resolve, at its last address.
	test("a tunnel reaches a computer at its last address when its name leads nowhere", async () => {
		// the computer listens on IPv4 only, so nothing answers at ::1; it is at 127.0.0.1
		const local = await tunnelHost([{ id: "far", name: "Far", host: "::1", address: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken }]);
		try {
			const host = await local.host();
			host.send({ type: "remote:open", tunnelId: "a1", computerId: "far" });
			await tunnelOpen(host, "a1");
		} finally {
			await local.close();
		}
	});

	test("a remote with a different certificate is unreachable and never receives the token; an uncertified entry is not dialed; an ambiguous name is refused", async () => {
		const impostor = await impostorServer();
		const local = await tunnelHost([
			{ id: "spoofed", name: "Spoofed", host: "127.0.0.1", port: impostor.port, cert: remoteCert, token: remoteToken },
			{ id: "nocert", name: "No cert", host: "127.0.0.1", port: impostor.port, token: remoteToken },
			{ id: "one", name: "Twin", host: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken },
			{ id: "two", name: "Twin", host: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken },
		]);
		try {
			const host = await local.host();
			host.send({ type: "remote:open", tunnelId: "t1", computerId: "spoofed" });
			expect((await tunnelClosed(host, "t1")).reason).toBe("unreachable");
			expect(impostor.accepted()).toBe(1);
			expect(impostor.received()).toBe("");

			host.send({ type: "remote:open", tunnelId: "t2", computerId: "nocert" });
			expect((await tunnelClosed(host, "t2")).reason).toBe("unknown-computer");
			expect(impostor.accepted()).toBe(1);

			host.send({ type: "remote:open", tunnelId: "t3", computerId: "Twin" });
			expect((await tunnelClosed(host, "t3")).reason).toBe("ambiguous-computer");
			host.send({ type: "remote:open", tunnelId: "t4", computerId: "one" });
			await tunnelOpen(host, "t4");
		} finally {
			await local.close();
			await impostor.close();
		}
	});

	test("handshakes are one-shot: early and replayed auth or scope replies open no premature or second tunnel", async () => {
		const log: string[] = [];
		let replyTo: ((frame: unknown) => void) | null = null;
		const fake = await scriptedRemote((frame, reply) => {
			if (frame.action === "auth:verify") {
				// a scope grant before authentication finished, then the real answer
				reply({ type: "response", id: "__tunnel-scope", result: { success: true } });
				reply({ type: "response", id: "__tunnel-auth", result: { success: true } });
			}
			if (frame.action === "auth:scope") {
				log.push("scope asked");
				replyTo = reply;
				reply({ type: "response", id: "__tunnel-scope", result: { success: true } });
			}
		});
		const local = await tunnelHost([{ id: "fake", name: "Fake", host: "127.0.0.1", port: fake.port, cert: fake.cert, token: "pc_remote" }]);
		try {
			const host = await local.host();
			const panelToken = (await host.ok("auth:panel-token", { panelId: "test.a" })).token as string;
			const panel = await local.socket(panelToken);
			panel.send({ type: "remote:open", tunnelId: "t5", computerId: "fake" });
			await tunnelOpen(panel, "t5");
			log.push("tunnel open");
			expect(log).toEqual(["scope asked", "tunnel open"]);

			replyTo!({ type: "response", id: "__tunnel-auth", result: { success: true } });
			replyTo!({ type: "response", id: "__tunnel-scope", result: { success: true } });
			replyTo!({ type: "marker" });
			const marker = await panel.next((f) => f.type === "tunnel" && f.id === "t5" && JSON.parse(f.payload).type === "marker");
			expect(marker).toBeTruthy();
			expect(panel.frames.filter((f) => f.type === "tunnel-open")).toHaveLength(1);
			// the replayed handshake answers were dropped, not forwarded as tunnel traffic
			expect(panel.frames.filter((f) => f.type === "tunnel").map((f) => JSON.parse(f.payload).type)).toEqual(["marker"]);
		} finally {
			await local.close();
			await fake.close();
		}
	});

	test("a frozen upstream closes the tunnel so the SDK can reopen it", async () => {
		const hop = await freezableHop(remote.port);
		const local = await tunnelHost([{ id: "far", name: "Far", host: "127.0.0.1", port: hop.port, cert: remoteCert, token: remoteToken }]);
		try {
			const host = await local.host();
			host.send({ type: "remote:open", tunnelId: "t6", computerId: "far" });
			await tunnelOpen(host, "t6");
			hop.freeze();
			expect((await tunnelClosed(host, "t6")).reason).toBe("The remote computer stopped responding");
			hop.thaw();
			host.send({ type: "remote:open", tunnelId: "t7", computerId: "far" });
			await tunnelOpen(host, "t7");
		} finally {
			await local.close();
			await hop.close();
		}
	});

	test("a scoped token can't read another panel directly or through a tunnel, rescope, or upgrade, and gets 401 over HTTP", async () => {
		const local = await tunnelHost([{ id: "far", name: "Far", host: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken }]);
		try {
			const host = await local.host();
			const panelToken = (await host.ok("auth:panel-token", { panelId: "test.a" })).token as string;
			const panel = await local.socket(panelToken);
			expect((await panel.fail("config:get", { id: "test.b" })).code).toBe("FORBIDDEN");
			expect((await panel.fail("auth:scope", { panelId: "test.b" })).code).toBe("FORBIDDEN");
			const hostToken = (local.auth.getAuthorizedClients().find((c) => c.clientName === "host")!).token as string;
			expect((await panel.fail("auth:verify", { token: hostToken })).code).toBe("FORBIDDEN");
			expect((await panel.fail("config:get", { id: "test.b" })).code).toBe("FORBIDDEN");

			panel.send({ type: "remote:open", tunnelId: "t8", computerId: "far" });
			await tunnelOpen(panel, "t8");
			const through = (id: string, action: string, params: unknown) => {
				panel.send({ type: "tunnel", id: "t8", payload: JSON.stringify({ id, action, params }) });
				return panel.next((f) => f.type === "tunnel" && f.id === "t8" && JSON.parse(f.payload).id === id).then((f) => JSON.parse(f.payload));
			};
			expect((await through("r1", "config:get", { id: "test.a" })).result.data).toEqual({ mine: true });
			expect((await through("r2", "config:get", { id: "test.b" })).code).toBe("FORBIDDEN");
			expect((await through("r3", "auth:scope", { panelId: "test.b" })).code).toBe("FORBIDDEN");

			const remotePanel = remote.instance.auth.issuePanelToken("test.a");
			fs.mkdirSync(path.join(remote.dataDir, "panels", "test.b"), { recursive: true });
			fs.writeFileSync(path.join(remote.dataDir, "panels", "test.b", "index.html"), "b");
			for (const [method, p] of [["GET", "/dav/configs/test.b.json"], ["GET", "/dav/configs/test.a.json"], ["GET", "/panel/test.b/index.html"], ["POST", "/dav/session"]] as const) {
				const res = await request(remote.instance.localPort, { method, path: p, headers: { Authorization: `Bearer ${remotePanel}` } });
				expect({ p, status: res.status }).toEqual({ p, status: 401 });
			}
		} finally {
			await local.close();
		}
	});

	test("a relay token acts as its panel only over its tunnel, never reaches the remote, and is FORBIDDEN locally", async () => {
		const fake = await scriptedRemote((frame, reply) => {
			if (frame.action === "auth:verify") reply({ type: "response", id: "__tunnel-auth", result: { success: true } });
			if (frame.action === "auth:scope") reply({ type: "response", id: "__tunnel-scope", result: { success: true } });
		});
		const local = await tunnelHost([
			{ id: "fake", name: "Fake", host: "127.0.0.1", port: fake.port, cert: fake.cert, token: "pc_remote" },
			{ id: "other", name: "Other", host: "127.0.0.1", port: remote.port, cert: remoteCert, token: remoteToken },
		]);
		try {
			const host = await local.host();
			const relayToken = (await host.ok("auth:panel-token", { panelId: "test.a", relayTo: "fake" })).token as string;
			const relay = await local.socket(relayToken);
			for (const [action, params] of [
				["process:run", { command: "echo", args: ["x"] }],
				["secrets:get", { name: "x" }],
				["config:get", {}],
				["file:read", { path: "x.txt" }],
				["actions:register", { action: "x" }],
			] as const) {
				expect({ action, code: (await relay.fail(action, params)).code }).toEqual({ action, code: "FORBIDDEN" });
			}
			relay.send({ type: "remote:open", tunnelId: "t9", computerId: "other" });
			expect((await tunnelClosed(relay, "t9")).reason).toBe("relay-scope");

			relay.send({ type: "remote:open", tunnelId: "t10", computerId: "fake" });
			await tunnelOpen(relay, "t10");
			relay.send({ type: "tunnel", id: "t10", payload: JSON.stringify({ id: "q", action: "config:get", params: { id: "test.a" } }) });
			await waitFor("the tunneled call to reach the remote", () => fake.frames.some((f) => f.includes('"id":"q"')));
			expect(fake.frames.map((f) => JSON.parse(f).action)).toEqual(["auth:verify", "auth:scope", "config:get"]);
			expect(JSON.parse(fake.frames[1]!).params).toEqual({ panelId: "test.a" });
			for (const frame of fake.frames) expect(frame).not.toContain(relayToken);
		} finally {
			await local.close();
			await fake.close();
		}
	});
});
