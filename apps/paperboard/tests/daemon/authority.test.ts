import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { TEST_TIMEOUT_MS } from "./support/wait";
import * as fs from "node:fs";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { WebSocket } from "ws";
import { isAllowedOrigin } from "../../papercrane/ws";
import { pinnedTlsOptions } from "../../papercrane/pinnedTls";
import { dataDir } from "./support/fs";
import { startCrane } from "./support/crane";
import { request, startDaemon, stopDaemon } from "./support/inproc";
import { Rpc, UpgradeRefused } from "./support/rpc";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(stopDaemon);

async function upgradeStatus(url: string, headers: Record<string, string>): Promise<number | "open"> {
	try {
		const rpc = await Rpc.open(url, { headers });
		await rpc.close();
		return "open";
	} catch (err) {
		if (err instanceof UpgradeRefused) return err.status;
		throw err;
	}
}

// A socket that is held open before authenticating; resolves with its close
// code if the daemon closes it on arrival, or "open" once it answers a call.
async function preAuthSocket(url: string, localAddress: string): Promise<{ rpc: Rpc; state: number | "open" }> {
	const rpc = await Rpc.open(url, { localAddress });
	const answer = rpc.call("auth:verify", { token: "pc_wrong" }).then(() => "open" as const);
	const state = await Promise.race([answer, rpc.closed.then((c) => c.code)]);
	return { rpc, state };
}

// WebSocket and HTTP authorities are allowlisted.
describe("HTTP and WebSocket authorities are allowlisted", () => {
	test("a foreign Host gets 421 on DAV and on the upgrade, with or without auth", async () => {
		for (const noAuth of [false, true]) {
			const daemon = await startDaemon({ noAuth });
			const port = daemon.instance.localPort;
			const auth = { Authorization: `Bearer ${noAuth ? "any" : daemon.token}` };
			for (const host of ["evil.example", "127.0.0.1.evil.com", "localhost.evil.io"]) {
				expect((await request(port, { method: "PROPFIND", path: "/dav/", host, headers: { ...auth, Depth: "0" } })).status).toBe(421);
				expect(await upgradeStatus(daemon.url, { Host: host })).toBe(421);
			}
			expect((await request(port, { method: "PROPFIND", path: "/dav/", host: `localhost:${port}`, headers: { ...auth, Depth: "0" } })).status).toBe(207);
			await daemon.stop();
		}
	});

	test("only loopback, *.localhost, panel:// and vscode-webview:// origins are allowed", async () => {
		for (const origin of ["http://localhost:5173", "http://127.0.0.1", "http://[::1]:3000", "http://shell.localhost", "panel://dev.example", "vscode-webview://abc"]) {
			expect(isAllowedOrigin(origin)).toBe(true);
		}
		for (const origin of ["http://127.0.0.1.evil.com", "http://localhost.evil.io", "file://", "https://paperboard.dev", "null"]) {
			expect(isAllowedOrigin(origin)).toBe(false);
		}
		const daemon = await startDaemon();
		const refused = await Rpc.open(daemon.url, { headers: { Origin: "https://evil.example" } });
		expect((await refused.closed).code).toBe(4403);
		const allowed = await Rpc.open(daemon.url, { headers: { Origin: "http://shell.localhost:5173" } });
		await allowed.ok("auth:verify", { token: daemon.token });
		await allowed.close();
	});

	test("over pinned TLS the machine's own hostname and interface addresses are served", async () => {
		const daemon = await startDaemon({ host: "0.0.0.0" });
		const identity = JSON.parse(fs.readFileSync(path.join(daemon.dataDir, "local", fs.readdirSync(path.join(daemon.dataDir, "local")).find((f) => f.startsWith("tls"))!), "utf8"));
		const ownIp = Object.values(os.networkInterfaces()).flat().find((e) => e && e.family === "IPv4" && !e.internal)?.address ?? "127.0.0.1";
		const statusFor = (host: string) =>
			new Promise<number>((resolve, reject) => {
				const req = https.request(
					{ host: "127.0.0.1", port: daemon.port, path: "/health", headers: { Host: `${host}:${daemon.port}` }, agent: false, ...pinnedTlsOptions(identity.cert) },
					(res) => {
						res.resume();
						resolve(res.statusCode ?? 0);
					},
				);
				req.on("error", reject);
				req.end();
			});
		expect(await statusFor(os.hostname())).toBe(200);
		expect(await statusFor(ownIp)).toBe(200);
		expect(await statusFor("evil.example")).toBe(421);
	});

	test("one non-loopback address holds at most 16 pre-auth sockets, and loopback still connects once the remote budget is spent", async () => {
		const daemon = await startDaemon();
		const held: Rpc[] = [];
		for (let i = 0; i < 16; i++) held.push((await Rpc.open(daemon.url, { localAddress: "127.0.0.2" })));
		const seventeenth = await Rpc.open(daemon.url, { localAddress: "127.0.0.2" });
		expect((await seventeenth.closed).code).toBe(4429);
		// fill the rest of the remote budget (128) from seven more addresses
		for (let a = 3; a <= 9; a++) {
			for (let i = 0; i < 16; i++) held.push(await Rpc.open(daemon.url, { localAddress: `127.0.0.${a}` }));
		}
		const another = await preAuthSocket(daemon.url, "127.0.0.10");
		expect(another.state).toBe(4429);
		const local = await Rpc.open(daemon.url);
		await local.ok("auth:verify", { token: daemon.token });
		await local.close();
		for (const socket of held) socket.ws.terminate();
	});

	test("invalid UTF-8 before auth closes only that socket and the standalone daemon keeps serving", async () => {
		const crane = await startCrane({ dataDir: dataDir() });
		const bystander = await crane.rpc();
		const bad = new WebSocket(crane.url);
		await new Promise((resolve, reject) => {
			bad.once("open", resolve);
			bad.once("error", reject);
		});
		const closed = new Promise<number>((resolve) => bad.once("close", (code) => resolve(code)));
		bad.on("error", () => undefined);
		bad.send(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), { binary: false });
		expect(await closed).not.toBe(1000);
		expect(await bystander.ok("events:subscribe", { events: [] })).toEqual({ success: true, count: 0 });
		expect((await fetch(`${crane.httpUrl}/health`)).status).toBe(200);
		await bystander.close();
		expect((await crane.stop()).code).toBe(0);
	});
});
