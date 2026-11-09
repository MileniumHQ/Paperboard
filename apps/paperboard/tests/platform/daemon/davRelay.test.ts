import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { createTlsIdentity } from "../../../papercrane/tlsIdentity";
import { type DavRelay, type DavRelayOptions, startDavRelay } from "../../../src/main/davRelay";
import { buildMacMountScript, buildWindowsMountCommand, macMountScriptPath, windowsDavRoot } from "../../../src/main/remoteFolderMount";
import { tempDir } from "../../daemon/support/fs";
import { type InProcessDaemon, startDaemon } from "../../daemon/support/inproc";
import { TEST_TIMEOUT_MS } from "../../daemon/support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

let daemon: InProcessDaemon;
let cert: string;
let session: { user: string; pass: string };
const relays: DavRelay[] = [];

beforeAll(async () => {
	// a network bind: the daemon serves TLS on `port`, the relay's upstream
	daemon = await startDaemon({ host: "0.0.0.0" });
	cert = JSON.parse(fs.readFileSync(path.join(daemon.dataDir, "local", "tls_identity.json"), "utf8")).cert;
	const res = await fetch(`${daemon.httpUrl}/dav/session`, { method: "POST", headers: { Authorization: `Bearer ${daemon.token}` }, body: "{}" });
	session = await res.json();
	fs.mkdirSync(path.join(daemon.dataDir, "files", "test.relay", "dir"), { recursive: true });
	fs.writeFileSync(path.join(daemon.dataDir, "files", "test.relay", "hello.txt"), "hello over the relay");
});
afterAll(async () => {
	for (const relay of relays) await relay.close();
	await daemon.stop();
});

async function relay(options: Partial<DavRelayOptions>): Promise<DavRelay> {
	const started = await startDavRelay({
		upstream: `https://127.0.0.1:${daemon.port}`,
		cert,
		user: session.user,
		pass: session.pass,
		clientAuth: "basic",
		idleMs: 10 * 60_000,
		onIdle: () => {
			throw new Error("a relay went idle during a test");
		},
		...options,
	});
	relays.push(started);
	return started;
}

interface Answer {
	status: number;
	headers: http.IncomingHttpHeaders;
	body: string;
}

function ask(port: number, options: { method?: string; path: string; headers?: Record<string, string> }): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: options.headers, agent: false },
			(res) => {
				let body = "";
				res.on("data", (chunk) => (body += chunk));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
				res.on("error", reject);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

// a connection the relay drops without answering a byte
function droppedWithoutAnswer(port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(port, "127.0.0.1", () => socket.write(`GET /dav/ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
		let received = "";
		socket.on("data", (chunk) => (received += chunk));
		socket.on("close", () => resolve(received));
		socket.on("error", (err) => ((err as NodeJS.ErrnoException).code === "ECONNRESET" ? resolve(received) : reject(err)));
	});
}

const basicAuth = () => ({ Authorization: `Basic ${Buffer.from(`${session.user}:${session.pass}`).toString("base64")}` });

// The DAV relay and remote-folder mounts are pinned and keep credentials private.
describe("DAV relay", () => {
	test("the upstream must be https with the paired certificate, else 502", async () => {
		expect(() => startDavRelay({ upstream: `http://127.0.0.1:${daemon.instance.localPort}`, cert, user: "u", pass: "p", clientAuth: "basic", idleMs: 1000, onIdle: () => void 0 })).toThrow("https");
		const pinned = await relay({});
		const served = await ask(pinned.port, { path: "/dav/files/test.relay/hello.txt", headers: basicAuth() });
		expect(served.status).toBe(200);
		expect(served.body).toBe("hello over the relay");

		const impostor = await relay({ cert: createTlsIdentity().cert });
		const refused = await ask(impostor.port, { path: "/dav/files/test.relay/hello.txt", headers: basicAuth() });
		expect(refused.status).toBe(502);
		expect(refused.body).not.toContain("hello");
	});

	test("the upstream's password challenge never reaches the file manager", async () => {
		const wrong = await relay({ pass: "not-the-session-password", clientAuth: "path" });
		const res = await ask(wrong.port, { method: "PROPFIND", path: `${wrong.prefix}/dav/`, headers: { Depth: "0" } });
		expect(res.status).toBe(401);
		expect(res.headers["www-authenticate"]).toBeUndefined();
	});

	test("peer mode drops connections whose socket owner check fails, and answers 421 to a foreign Host or any Origin", async () => {
		const stranger = await relay({ clientAuth: "peer", verifyPeer: async () => false });
		expect(await droppedWithoutAnswer(stranger.port)).toBe("");

		const peer = await relay({ clientAuth: "peer", ...(process.platform === "linux" ? {} : { verifyPeer: async () => true }) });
		const own = await ask(peer.port, { path: "/dav/files/test.relay/hello.txt", headers: { Host: `127.0.0.1:${peer.port}` } });
		expect(own.status).toBe(200);
		expect((await ask(peer.port, { path: "/dav/files/test.relay/hello.txt", headers: { Host: `localhost:${peer.port}` } })).status).toBe(421);
		expect((await ask(peer.port, { path: "/dav/files/test.relay/hello.txt", headers: { Host: `rebound.example:${peer.port}` } })).status).toBe(421);
		expect((await ask(peer.port, { path: "/dav/files/test.relay/hello.txt", headers: { Host: `127.0.0.1:${peer.port}`, Origin: `http://127.0.0.1:${peer.port}` } })).status).toBe(421);
	});

	test("basic mode refuses a request without the session credential", async () => {
		const mac = await relay({ clientAuth: "basic" });
		expect((await ask(mac.port, { path: "/dav/files/test.relay/hello.txt" })).status).toBe(401);
		expect((await ask(mac.port, { path: "/dav/files/test.relay/hello.txt", headers: { Authorization: `Basic ${Buffer.from(`${session.user}:wrong`).toString("base64")}` } })).status).toBe(401);
	});

	test("path mode serves only under a 48-hex secret prefix and keeps MOVE destinations inside it", async () => {
		const win = await relay({ clientAuth: "path" });
		expect(win.prefix).toMatch(/^\/[0-9a-f]{48}$/);
		expect((await ask(win.port, { path: "/dav/files/test.relay/hello.txt" })).status).toBe(404);
		expect((await ask(win.port, { path: `/${"0".repeat(48)}/dav/files/test.relay/hello.txt` })).status).toBe(404);
		expect((await ask(win.port, { path: `${win.prefix}/dav/files/test.relay/hello.txt` })).body).toBe("hello over the relay");

		const listing = await ask(win.port, { method: "PROPFIND", path: `${win.prefix}/dav/files/test.relay/`, headers: { Depth: "1" } });
		expect(listing.status).toBe(207);
		const hrefs = [...listing.body.matchAll(/<(?:[A-Za-z]+:)?href>([^<]*)</g)].map((m) => m[1]!);
		expect(hrefs.length).toBeGreaterThan(1);
		for (const href of hrefs) expect(href.startsWith(`${win.prefix}/dav/`)).toBe(true);

		const outside = await ask(win.port, {
			method: "MOVE",
			path: `${win.prefix}/dav/files/test.relay/hello.txt`,
			headers: { Destination: `http://127.0.0.1:${win.port}/dav/files/test.relay/escaped.txt` },
		});
		expect(outside.status).toBe(400);
		expect(fs.existsSync(path.join(daemon.dataDir, "files", "test.relay", "hello.txt"))).toBe(true);
		const inside = await ask(win.port, {
			method: "COPY",
			path: `${win.prefix}/dav/files/test.relay/hello.txt`,
			headers: { Destination: `http://127.0.0.1:${win.port}${win.prefix}/dav/files/test.relay/dir/copy.txt` },
		});
		expect(inside.status).toBe(201);
		expect(fs.readFileSync(path.join(daemon.dataDir, "files", "test.relay", "dir", "copy.txt"), "utf8")).toBe("hello over the relay");
	});
});

describe("remote folder mounts", () => {
	test("the Windows mount passes the secret DAV root only in PB_DAV_ROOT", () => {
		const prefix = `/${"ab".repeat(24)}`;
		const root = windowsDavRoot(4321, prefix);
		const plan = buildWindowsMountCommand(root);
		expect(plan.env).toEqual({ PB_DAV_ROOT: root });
		for (const arg of plan.args) expect(arg).not.toContain(prefix.slice(1));
		expect(() => windowsDavRoot(4321, "")).toThrow();
	});

	test("the macOS mount script escapes the credential and its path names neither user nor password", () => {
		const script = buildMacMountScript('us"er\\', 'pa"ss\\word', "127.0.0.1", 4321);
		expect(script).toBe('mount volume "http://127.0.0.1:4321/dav" as user name "us\\"er\\\\" with password "pa\\"ss\\\\word"');
		expect(() => buildMacMountScript("user", "pass\nword", "127.0.0.1", 4321)).toThrow();
		const scriptPath = macMountScriptPath();
		expect(scriptPath).not.toContain("user");
		expect(scriptPath).not.toContain("pass");
	});

	if (process.platform === "darwin") {
		test("osascript compiles the escaped script as one mount command with the credential intact", () => {
			const dir = tempDir();
			const source = path.join(dir, "mount.applescript");
			const pass = 'p"a\\ss" & do shell script "touch pwned" & "';
			fs.writeFileSync(source, buildMacMountScript("user", pass, "127.0.0.1", 4321));
			const compiled = spawnSync("osacompile", ["-o", path.join(dir, "mount.scpt"), source], { encoding: "utf8" });
			expect({ status: compiled.status, stderr: compiled.stderr }).toEqual({ status: 0, stderr: "" });
			const decompiled = spawnSync("osadecompile", [path.join(dir, "mount.scpt")], { encoding: "utf8" });
			expect(decompiled.status).toBe(0);
			// the whole password is one string literal, so nothing in it runs
			expect(decompiled.stdout).toContain('with password "p\\"a\\\\ss\\" & do shell script \\"touch pwned\\" & \\""');
			expect(fs.existsSync(path.join(dir, "pwned"))).toBe(false);
		});
	}

	if (process.platform === "win32") {
		test("a failed mount exits non-zero and prints no drive letter", () => {
			// port 1 has no relay behind it, so Windows can't map it
			const plan = buildWindowsMountCommand(windowsDavRoot(1, `/${"cd".repeat(24)}`));
			const run = spawnSync("powershell.exe", plan.args, { env: { ...process.env, ...plan.env }, encoding: "utf8", timeout: 120_000, windowsHide: true });
			expect(run.error).toBeUndefined();
			expect(run.status).not.toBe(0);
			expect(run.stdout.trim()).not.toMatch(/^[D-Z]:$/m);
		});
	}
});
