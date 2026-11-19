import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { createTlsIdentity } from "daemon/tlsIdentity";
import { type DavRelay, type DavRelayOptions, startDavRelay } from "../../../src/main/davRelay";
import { buildMacMountArgs, buildWindowsMountCommand, macFolderHasWindow, macMountCredentials, mountMacFolder, windowsDavRoot } from "../../../src/main/remoteFolderMount";
import { type InProcessDaemon, startDaemon } from "testkit/inproc";
import { TEST_TIMEOUT_MS, waitFor } from "testkit/wait";

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

	test("a computer paired at an IPv6 address serves its folder through the relay", async () => {
		// the daemon listens on IPv4; this hop is the computer's IPv6 address
		const hop = net.createServer((client) => {
			const upstream = net.connect(daemon.port, "127.0.0.1");
			client.pipe(upstream).pipe(client);
			client.on("error", () => upstream.destroy());
			upstream.on("error", () => client.destroy());
		});
		await new Promise<void>((resolve) => hop.listen(0, "::1", resolve));
		const v6 = await relay({ upstream: `https://[::1]:${(hop.address() as net.AddressInfo).port}` });
		try {
			const served = await ask(v6.port, { path: "/dav/files/test.relay/hello.txt", headers: basicAuth() });
			expect(served.body).toBe("hello over the relay");
			expect(served.status).toBe(200);
		} finally {
			// the relay's keep-alive socket holds the hop open until it closes
			await v6.close();
			await new Promise<void>((resolve) => hop.close(() => resolve()));
		}
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

	test("a download that streams longer than the quiet time is not cut off, and the relay closes once it ends", async () => {
		const identity = createTlsIdentity();
		let finish!: () => void;
		const released = new Promise<void>((resolve) => (finish = resolve));
		const slow = https.createServer({ key: identity.key, cert: identity.cert }, (_req, res) => {
			res.writeHead(200, { "Content-Type": "application/octet-stream" });
			res.write("first part,");
			void released.then(() => res.end("last part"));
		});
		await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
		let idled!: () => void;
		const wentIdle = new Promise<void>((resolve) => (idled = resolve));
		let idleDuringCopy = false;
		let streaming = true;
		const copy = await startDavRelay({
			upstream: `https://127.0.0.1:${(slow.address() as net.AddressInfo).port}`,
			cert: identity.cert,
			user: "u",
			pass: "p",
			clientAuth: "basic",
			idleMs: 50,
			onIdle: () => {
				if (streaming) idleDuringCopy = true;
				idled();
			},
		});
		try {
			const body = await new Promise<string>((resolve, reject) => {
				const req = http.request({ host: "127.0.0.1", port: copy.port, path: "/dav/big.bin", headers: { Authorization: `Basic ${Buffer.from("u:p").toString("base64")}` }, agent: false }, (res) => {
					let received = "";
					res.on("data", (chunk) => {
						// the copy keeps streaming for many times the quiet time
						if (!received) setTimeout(() => finish(), 500);
						received += chunk;
					});
					res.on("end", () => resolve(received));
					res.on("error", reject);
				});
				req.on("error", reject);
				req.end();
			});
			streaming = false;
			expect(idleDuringCopy).toBe(false);
			expect(body).toBe("first part,last part");
			await wentIdle;
		} finally {
			await copy.close();
			slow.closeAllConnections();
			await new Promise<void>((resolve) => slow.close(() => resolve()));
		}
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

	test("the macOS mount hands mount_webdav the credential in its file record, and its argv names neither user nor password", () => {
		const args = buildMacMountArgs(4321, "/private/tmp/paperboard-folder-x");
		expect(args).toEqual(["-S", "-a", "3", "-v", "Paperboard", "http://127.0.0.1:4321/dav", "/private/tmp/paperboard-folder-x"]);
		// webdavfs' record: u32 big-endian length + bytes for user, password,
		// proxy user, proxy password, and an empty certificate chain
		const u32 = (n: number) => Buffer.from([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
		expect(macMountCredentials("us\"er", "pa:ss")).toEqual(
			Buffer.concat([u32(5), Buffer.from("us\"er"), u32(5), Buffer.from("pa:ss"), u32(0), u32(0), u32(0)]),
		);
		expect(() => macMountCredentials("user", "p".repeat(256))).toThrow("too long");
	});

	if (process.platform === "darwin") {
		const mountedFrom = async (folder: string) => (await promisify(execFile)("mount", [])).stdout.split("\n").filter((line) => line.includes(folder));

		test("macOS mounts the relay with no dialog to answer, the mount names neither user nor password, and its Finder window is seen", async () => {
			// the relay answers macOS from this process, so nothing here may block the loop
			const served = await relay({});
			const folder = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), "paperboard-folder-")));
			try {
				// Finder's `mount volume` asks the user whether to send a password
				// over http and waits on that dialog; this never shows one
				await mountMacFolder(session.user, session.pass, served.port, folder);
				try {
					expect(await fs.promises.readFile(path.join(folder, "files", "test.relay", "hello.txt"), "utf8")).toBe("hello over the relay");
					const listed = await mountedFrom(folder);
					expect(listed).toHaveLength(1);
					expect(listed[0]).toContain(`http://127.0.0.1:${served.port}/dav`);
					expect(listed[0]).not.toContain(session.user);
					expect(listed[0]).not.toContain(session.pass);

					// the folder stays while Finder shows it, and closes once it doesn't
					await promisify(execFile)("open", [path.join(folder, "files")]);
					await waitFor("Finder's window on the folder to be seen", () => macFolderHasWindow(folder), { intervalMs: 250 });
					await promisify(execFile)("osascript", [
						"-e", 'tell application "Finder"',
						"-e", "repeat with w in (get every Finder window)",
						"-e", `if (POSIX path of (target of w as alias)) starts with ${JSON.stringify(`${folder}/`)} then close w`,
						"-e", "end repeat",
						"-e", "end tell",
					]);
					await waitFor("the closed window to be gone", async () => !(await macFolderHasWindow(folder)), { intervalMs: 250 });
				} finally {
					await promisify(execFile)("umount", [folder], { timeout: 20_000 });
				}
				// nothing that held the credential is left in the temp folder
				expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("paperboard-mount-"))).toEqual([]);
			} finally {
				fs.rmdirSync(folder);
			}
		});

		test("a mount the relay refuses fails at once and says why, and leaves nothing mounted", async () => {
			const served = await relay({});
			const folder = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), "paperboard-folder-")));
			try {
				await expect(mountMacFolder(session.user, "not-the-session-password", served.port, folder)).rejects.toThrow("the computer refused this folder session's password");
				expect(await mountedFrom(folder)).toEqual([]);
			} finally {
				fs.rmdirSync(folder);
			}
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
