import { afterEach, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { PANEL_TRAVERSAL_VECTORS, resolveLocalPanelFile } from "../../papercrane/panelAssets";
import { startCrane } from "./support/crane";
import { dataDir, listTree, tempDir } from "./support/fs";
import { type InProcessDaemon, request, startDaemon, stopDaemon } from "./support/inproc";
import { installPanelFiles } from "./support/panels";
import { TEST_TIMEOUT_MS, waitFor } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

afterEach(async () => {
	setSystemTime();
	await stopDaemon();
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const basic = (user: string, pass: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });

async function davSession(daemon: InProcessDaemon, idleMs?: number): Promise<{ user: string; pass: string }> {
	const res = await request(daemon.instance.localPort, {
		method: "POST",
		path: "/dav/session",
		headers: { ...bearer(daemon.token), "Content-Type": "application/json" },
		body: JSON.stringify(idleMs ? { idleMs } : {}),
	});
	expect(res.status).toBe(200);
	return JSON.parse(res.body.toString());
}

// the secrets every data directory has, written by the daemon itself
function plantSecrets(dir: string) {
	fs.mkdirSync(path.join(dir, "files", "test.dav"), { recursive: true });
	fs.writeFileSync(path.join(dir, "files", "test.dav", "server.key"), "KEY");
	fs.writeFileSync(path.join(dir, "files", "test.dav", "nested.pem"), "PEM");
	fs.writeFileSync(path.join(dir, "files", "test.dav", "secrets.json"), "{}");
	fs.writeFileSync(path.join(dir, "files", "test.dav", "notes.txt"), "notes");
}

// WebDAV requires a credential and never exposes secrets.
describe("WebDAV", () => {
	test("anonymous and wrong credentials get 401; sessions are revocable, idle out, and can't mint more", async () => {
		const daemon = await startDaemon();
		const port = daemon.instance.localPort;
		expect((await request(port, { path: "/dav/" , method: "PROPFIND" })).status).toBe(401);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: bearer("wrong") })).status).toBe(401);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: basic("dav-x", "wrong") })).status).toBe(401);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: { ...bearer(daemon.token), Depth: "0" } })).status).toBe(207);

		const session = await davSession(daemon);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: { ...basic(session.user, session.pass), Depth: "0" } })).status).toBe(207);
		// a session's secret can't open another session, as Bearer or Basic
		expect((await request(port, { method: "POST", path: "/dav/session", headers: bearer(session.pass) })).status).toBe(401);
		expect((await request(port, { method: "POST", path: "/dav/session", headers: basic(session.user, session.pass) })).status).toBe(401);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: bearer(session.pass) })).status).toBe(401);

		const revoked = await request(port, { method: "DELETE", path: "/dav/session", headers: bearer(daemon.token), body: JSON.stringify({ user: session.user }) });
		expect(revoked.status).toBe(200);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: basic(session.user, session.pass) })).status).toBe(401);

		const idle = await davSession(daemon, 30_000);
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: { ...basic(idle.user, idle.pass), Depth: "0" } })).status).toBe(207);
		setSystemTime(new Date(Date.now() + 31_000));
		expect((await request(port, { path: "/dav/", method: "PROPFIND", headers: basic(idle.user, idle.pass) })).status).toBe(401);
	});

	test("local/, sockets/ and key or credential files resolve to nothing for every method and are absent from listings", async () => {
		const daemon = await startDaemon();
		const port = daemon.instance.localPort;
		plantSecrets(daemon.dataDir);
		const auth = bearer(daemon.token);
		const hidden = [
			"/dav/local/crane.json",
			"/dav/LOCAL/crane.json",
			"/dav/Local/authorized_tokens.json",
			"/dav/local/",
			"/dav/sockets/",
			"/dav/files/test.dav/server.key",
			"/dav/files/test.dav/nested.pem",
			"/dav/files/test.dav/secrets.json",
			"/dav/files/test.dav/./secrets.json",
			"/dav/files/test.dav/%73ecrets.json",
		];
		for (const p of hidden) {
			for (const method of ["GET", "HEAD", "PUT", "DELETE", "PROPFIND", "MKCOL"]) {
				const res = await request(port, { method, path: p, headers: { ...auth, Depth: "0" }, body: method === "PUT" ? "overwritten" : undefined });
				expect({ p, method, status: res.status }).toEqual({ p, method, status: method === "PROPFIND" ? 404 : 403 });
			}
			for (const method of ["COPY", "MOVE"]) {
				const out = await request(port, { method, path: p, headers: { ...auth, Destination: `http://127.0.0.1:${port}/dav/files/stolen` } });
				expect({ p, method, status: out.status }).toEqual({ p, method, status: 403 });
				const into = await request(port, { method, path: "/dav/files/test.dav/notes.txt", headers: { ...auth, Destination: `http://127.0.0.1:${port}${p}` } });
				expect({ p, method, into: into.status }).toEqual({ p, method, into: 403 });
			}
		}
		expect(fs.readFileSync(path.join(daemon.dataDir, "files", "test.dav", "secrets.json"), "utf8")).toBe("{}");
		expect(fs.readFileSync(path.join(daemon.dataDir, "files", "test.dav", "notes.txt"), "utf8")).toBe("notes");
		expect(fs.existsSync(path.join(daemon.dataDir, "files", "stolen"))).toBe(false);
		expect(fs.existsSync(path.join(daemon.dataDir, "local", "crane.json")) || fs.existsSync(path.join(daemon.dataDir, "local", "authorized_tokens.json"))).toBe(true);

		const root = await request(port, { method: "PROPFIND", path: "/dav/", headers: { ...auth, Depth: "1" } });
		const panel = await request(port, { method: "PROPFIND", path: "/dav/files/test.dav/", headers: { ...auth, Depth: "1" } });
		const listing = root.body.toString() + panel.body.toString();
		expect(listing).toContain("notes.txt");
		for (const name of ["/dav/local", "/dav/sockets", "server.key", "nested.pem", "secrets.json"]) expect(listing).not.toContain(name);
	});

	test("encoded traversal, DELETE /dav/%2f, symlinks and a malformed Host leave the data dir intact and /health answering", async () => {
		const daemon = await startDaemon();
		const port = daemon.instance.localPort;
		const auth = bearer(daemon.token);
		const outside = tempDir();
		fs.writeFileSync(path.join(outside, "secret.txt"), "outside");
		fs.mkdirSync(path.join(daemon.dataDir, "files", "test.dav"), { recursive: true });
		fs.symlinkSync(path.join(outside, "secret.txt"), path.join(daemon.dataDir, "files", "test.dav", "out.txt"));
		fs.writeFileSync(path.join(daemon.dataDir, "files", "test.dav", "in.txt"), "in");
		fs.symlinkSync(path.join(daemon.dataDir, "files", "test.dav", "in.txt"), path.join(daemon.dataDir, "files", "test.dav", "inner-link.txt"));
		const before = listTree(daemon.dataDir);

		// %2e%2e segments are dot segments to the URL parser, so they normalise
		// out of /dav/ before routing (404); everything that reaches the DAV
		// resolver is refused there (403)
		const escapes: Array<[string, number]> = [
			["/dav/..%2f..%2fetc%2fpasswd", 403],
			[`/dav/${encodeURIComponent(path.relative(daemon.dataDir, path.join(outside, "secret.txt")))}`, 403],
			["/dav/files/..%2f..%2f..%2fsecret.txt", 403],
			["/dav/%E0%A4%A", 403],
			["/dav/%2e%2e/%2e%2e/secret.txt", 404],
		];
		for (const [p, status] of escapes) {
			const res = await request(port, { path: p, headers: auth });
			expect({ p, status: res.status }).toEqual({ p, status });
			expect(res.body.toString()).not.toContain("outside");
		}
		for (const p of ["/dav/files/test.dav/out.txt", "/dav/files/test.dav/inner-link.txt"]) {
			const res = await request(port, { path: p, headers: auth });
			expect({ p, status: res.status }).toEqual({ p, status: 403 });
		}
		expect((await request(port, { method: "DELETE", path: "/dav/%2f", headers: auth })).status).toBe(403);
		expect((await request(port, { method: "DELETE", path: "/dav/", headers: auth })).status).toBe(403);
		expect(listTree(daemon.dataDir)).toEqual(before);
		expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("outside");

		expect((await request(port, { path: "/dav/", headers: auth, host: "[" })).status).toBe(400);
		const health = await request(port, { path: "/health" });
		expect(health.status).toBe(200);
		expect(JSON.parse(health.body.toString()).status).toBe("ok");
	});

	test("/shutdown needs the guard header and a valid token", async () => {
		const daemon = await startDaemon();
		const port = daemon.instance.localPort;
		expect((await request(port, { method: "POST", path: "/shutdown", headers: { "X-PaperCrane-Shutdown": "1" } })).status).toBe(403);
		expect((await request(port, { method: "POST", path: "/shutdown", headers: { "X-PaperCrane-Shutdown": "1", ...bearer("wrong") } })).status).toBe(403);
		expect((await request(port, { method: "POST", path: "/shutdown", headers: bearer(daemon.token) })).status).toBe(403);
		await daemon.stop();

		// the accepted request really stops a daemon, so it runs against a crane of its own
		const crane = await startCrane({ dataDir: dataDir() });
		expect((await request(crane.localPort, { method: "POST", path: "/shutdown", headers: { "X-PaperCrane-Shutdown": "1" } })).status).toBe(403);
		const ok = await request(crane.localPort, { method: "POST", path: "/shutdown", headers: { "X-PaperCrane-Shutdown": "1", ...bearer(crane.token) } });
		expect(ok.status).toBe(200);
		expect((await crane.exited).code).toBe(0);
	});

	test("MOVE or COPY onto its own source, ancestor or descendant is 403 and the source stays; a hard-linked destination overwrites normally", async () => {
		const daemon = await startDaemon();
		const port = daemon.instance.localPort;
		const auth = bearer(daemon.token);
		const files = path.join(daemon.dataDir, "files", "test.dav");
		fs.mkdirSync(path.join(files, "dir", "sub"), { recursive: true });
		fs.writeFileSync(path.join(files, "dir", "sub", "deep.txt"), "deep");
		fs.writeFileSync(path.join(files, "a.txt"), "source");
		const at = (p: string) => `http://127.0.0.1:${port}/dav/files/test.dav/${p}`;
		const before = listTree(files);
		for (const method of ["MOVE", "COPY"]) {
			for (const [from, to] of [
				["a.txt", "a.txt"],
				["dir/sub", "dir"],
				["dir/sub/deep.txt", "dir"],
				["dir", "dir/sub/inside"],
				["dir", "dir/sub"],
			] as const) {
				const res = await request(port, { method, path: `/dav/files/test.dav/${from}`, headers: { ...auth, Destination: at(to), Overwrite: "T" } });
				expect({ method, from, to, status: res.status }).toEqual({ method, from, to, status: 403 });
			}
		}
		expect(listTree(files)).toEqual(before);
		expect(fs.readFileSync(path.join(files, "dir", "sub", "deep.txt"), "utf8")).toBe("deep");

		fs.linkSync(path.join(files, "a.txt"), path.join(files, "b.txt"));
		const copied = await request(port, { method: "COPY", path: "/dav/files/test.dav/a.txt", headers: { ...auth, Destination: at("b.txt") } });
		expect(copied.status).toBe(204);
		expect(fs.readFileSync(path.join(files, "a.txt"), "utf8")).toBe("source");
		expect(fs.readFileSync(path.join(files, "b.txt"), "utf8")).toBe("source");
		expect(fs.statSync(path.join(files, "b.txt")).ino).not.toBe(fs.statSync(path.join(files, "a.txt")).ino);
		fs.rmSync(path.join(files, "b.txt"));
		fs.linkSync(path.join(files, "a.txt"), path.join(files, "c.txt"));
		const moved = await request(port, { method: "MOVE", path: "/dav/files/test.dav/a.txt", headers: { ...auth, Destination: at("c.txt") } });
		expect(moved.status).toBe(204);
		expect(fs.existsSync(path.join(files, "a.txt"))).toBe(false);
		expect(fs.readFileSync(path.join(files, "c.txt"), "utf8")).toBe("source");
	});
});

// Panel assets and `/panel-files` need a credential and stay inside the panel.
describe("panel assets and /panel-files", () => {
	async function withPanel() {
		const daemon = await startDaemon();
		await installPanelFiles(daemon.dataDir, { id: "test.assets", files: { "app.js": "console.log('panel')" } });
		fs.mkdirSync(path.join(daemon.dataDir, "files", "test.assets"), { recursive: true });
		fs.writeFileSync(path.join(daemon.dataDir, "files", "test.assets", "doc.txt"), "doc");
		fs.writeFileSync(path.join(daemon.dataDir, "panels", "SENTINEL"), "SENTINEL-BYTES");
		fs.mkdirSync(path.join(daemon.dataDir, "files", "test.other"), { recursive: true });
		fs.writeFileSync(path.join(daemon.dataDir, "files", "test.other", "theirs.txt"), "SENTINEL-BYTES");
		return daemon;
	}

	test("no or wrong token gets 401, a DAV session secret included", async () => {
		const daemon = await withPanel();
		const port = daemon.instance.localPort;
		const session = await davSession(daemon);
		for (const p of ["/panel/test.assets/index.html", "/panel-files/test.assets/doc.txt"]) {
			expect((await request(port, { path: p })).status).toBe(401);
			expect((await request(port, { path: p, headers: bearer("wrong") })).status).toBe(401);
			expect((await request(port, { path: p, headers: bearer(session.pass) })).status).toBe(401);
			expect((await request(port, { path: p, headers: bearer(daemon.instance.auth.issuePanelToken("test.assets")) })).status).toBe(401);
		}
		expect((await request(port, { path: "/panel/test.assets/app.js", headers: bearer(daemon.token) })).body.toString()).toBe("console.log('panel')");
		expect((await request(port, { path: "/panel-files/test.assets/doc.txt", headers: bearer(daemon.token) })).body.toString()).toBe("doc");
	});

	test("a request carrying the file's ETag gets an empty 304, and a changed file comes in full", async () => {
		const daemon = await withPanel();
		const port = daemon.instance.localPort;
		const auth = bearer(daemon.token);
		const first = await request(port, { path: "/panel/test.assets/app.js", headers: auth });
		const etag = first.headers.etag as string;
		expect(etag).toBeTruthy();
		expect(first.headers["cache-control"]).toBe("no-cache");
		const again = await request(port, { path: "/panel/test.assets/app.js", headers: { ...auth, "If-None-Match": etag } });
		expect(again.status).toBe(304);
		expect(again.body.length).toBe(0);
		fs.writeFileSync(path.join(daemon.dataDir, "panels", "test.assets", "app.js"), "console.log('changed panel')");
		const changed = await request(port, { path: "/panel/test.assets/app.js", headers: { ...auth, "If-None-Match": etag } });
		expect(changed.status).toBe(200);
		expect(changed.body.toString()).toBe("console.log('changed panel')");
	});

	test("every traversal vector is refused, raw or encoded, and the outside bytes never leave; reserved ids get 400", async () => {
		const daemon = await withPanel();
		const port = daemon.instance.localPort;
		const auth = bearer(daemon.token);
		for (const vector of PANEL_TRAVERSAL_VECTORS) {
			// the resolver every panel-asset surface shares refuses the vector itself
			expect({ vector, kind: resolveLocalPanelFile(path.join(daemon.dataDir, "panels"), "test.assets", vector).kind }).toEqual({ vector, kind: "forbidden" });
		}
		// Over HTTP no spelling reaches the file: the URL parser removes raw and
		// %2e%2e dot segments, which leaves a path naming no panel (404) or no
		// panel id at all (400), and the route never decodes %2f, so an encoded
		// slash names a file that does not exist (404).
		const spellings: Array<[string, number]> = [
			["../../SENTINEL", 404],
			["%2e%2e%2f%2e%2e%2fSENTINEL", 404],
			["..%2f..%2fSENTINEL", 404],
			["%2e%2e/%2e%2e/SENTINEL", 404],
			["dist/../../SENTINEL", 404],
			["dist/..%2f..%2fSENTINEL", 404],
			["..", 400],
			["%2e%2e", 400],
		];
		for (const [spelled, status] of spellings) {
			const res = await request(port, { path: `/panel/test.assets/${spelled}`, headers: auth });
			expect({ spelled, status: res.status }).toEqual({ spelled, status });
			expect(res.body.toString()).not.toContain("SENTINEL-BYTES");
		}
		for (const spelled of ["../test.other/theirs.txt", "%2e%2e/test.other/theirs.txt", "%2e%2e%2ftest.other%2ftheirs.txt", "sub/../../test.other/theirs.txt"]) {
			const res = await request(port, { path: `/panel-files/test.assets/${spelled}`, headers: auth });
			expect({ spelled, status: res.status }).toEqual({ spelled, status: 403 });
			expect(res.body.toString()).not.toContain("SENTINEL-BYTES");
			const put = await request(port, { method: "PUT", path: `/panel-files/test.assets/${spelled}`, headers: auth, body: "overwrite" });
			expect({ spelled, put: put.status }).toEqual({ spelled, put: 403 });
		}
		expect(fs.readFileSync(path.join(daemon.dataDir, "files", "test.other", "theirs.txt"), "utf8")).toBe("SENTINEL-BYTES");
		for (const reserved of ["settings", "shell-backups", "default"]) {
			expect((await request(port, { path: `/panel-files/${reserved}/x.txt`, headers: auth })).status).toBe(400);
		}
		for (const invalid of [".hidden", "a%20b"]) {
			expect((await request(port, { path: `/panel/${invalid}/index.html`, headers: auth })).status).toBe(400);
		}
	});

	test("symlinks inside a panel are refused while a dev-linked panel root is served", async () => {
		const daemon = await withPanel();
		const port = daemon.instance.localPort;
		const auth = bearer(daemon.token);
		const panel = path.join(daemon.dataDir, "panels", "test.assets");
		fs.symlinkSync(path.join(daemon.dataDir, "panels", "SENTINEL"), path.join(panel, "leak.txt"));
		fs.symlinkSync(path.join(panel, "app.js"), path.join(panel, "alias.js"));
		fs.symlinkSync(path.join(daemon.dataDir, "files", "test.other", "theirs.txt"), path.join(daemon.dataDir, "files", "test.assets", "leak.txt"));
		for (const p of ["/panel/test.assets/leak.txt", "/panel/test.assets/alias.js", "/panel-files/test.assets/leak.txt"]) {
			const res = await request(port, { path: p, headers: auth });
			expect({ p, status: res.status }).toEqual({ p, status: 403 });
		}
		const source = tempDir();
		fs.writeFileSync(path.join(source, "index.html"), "<p>dev build</p>");
		fs.symlinkSync(source, path.join(daemon.dataDir, "panels", "test.devlink"));
		const dev = await request(port, { path: "/panel/test.devlink/index.html", headers: auth });
		expect(dev.status).toBe(200);
		expect(dev.body.toString()).toBe("<p>dev build</p>");
	});

	test("an upload whose folder is swapped for a symlink mid-stream fails and leaves no .davpart", async () => {
		const daemon = await withPanel();
		const files = path.join(daemon.dataDir, "files", "test.assets");
		fs.mkdirSync(path.join(files, "sub"));
		const outside = tempDir();
		const socket = net.connect(daemon.instance.localPort, "127.0.0.1");
		await new Promise<void>((resolve, reject) => socket.once("connect", resolve).once("error", reject));
		const answer = new Promise<string>((resolve, reject) => {
			let text = "";
			socket.on("data", (chunk) => (text += chunk.toString()));
			socket.once("close", () => resolve(text));
			socket.once("error", reject);
		});
		socket.write(
			`PUT /panel-files/test.assets/sub/upload.bin HTTP/1.1\r\nHost: 127.0.0.1:${daemon.instance.localPort}\r\nAuthorization: Bearer ${daemon.token}\r\nContent-Length: 8\r\nConnection: close\r\n\r\nhalf`,
		);
		await waitFor("the upload's staging file", () => fs.readdirSync(path.join(files, "sub")).some((n) => n.includes(".davpart")));
		fs.renameSync(path.join(files, "sub"), path.join(files, "moved"));
		fs.symlinkSync(outside, path.join(files, "sub"));
		socket.write("rest");
		const text = await answer;
		expect(text).toMatch(/^HTTP\/1\.1 (403|500)/);
		expect(fs.readdirSync(outside)).toEqual([]);
		expect(fs.readdirSync(path.join(files, "moved"))).toEqual([]);
	});
});
