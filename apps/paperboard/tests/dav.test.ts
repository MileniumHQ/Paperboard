import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { DavSessionStore, parseBasic, resolveDavPath } from "../papercrane/dav";
import { handleHttpRequest } from "../papercrane/http";

const TOKEN = "test-main-token";

let tmp = "";
let server: http.Server;
let base = "";
let engine: PaperCraneEngine;

const basic = (user: string, pass: string) =>
    `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dav-test-"));
    engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(false, tmp);
    auth.injectToken(TOKEN, "test");
    const sessions = new DavSessionStore();
    server = http.createServer((req, res) => {
        handleHttpRequest(engine, req, res, { auth, sessions });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
    // Seed content: files/note.txt + a sockets dir that must stay hidden
    fs.mkdirSync(path.join(tmp, "files"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "files", "note.txt"), "hello");
    fs.mkdirSync(path.join(tmp, "sockets"), { recursive: true });
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
});

async function mintSession(idleMs = 30000): Promise<{ user: string; pass: string }> {
    const res = await fetch(`${base}/dav/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ idleMs }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { user: string; pass: string };
}

describe("WebDAV auth", () => {
    it("rejects anonymous PROPFIND with 401 + challenge", async () => {
        const res = await fetch(`${base}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "0" },
        });
        expect(res.status).toBe(401);
        expect(res.headers.get("www-authenticate")).toContain("Basic");
    });

    it("rejects wrong tokens and session-minted /dav/session", async () => {
        const bad = await fetch(`${base}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "0", Authorization: "Bearer nope" },
        });
        expect(bad.status).toBe(401);

        const sess = await mintSession();
        const mintWithSession = await fetch(`${base}/dav/session`, {
            method: "POST",
            headers: {
                Authorization: basic(sess.user, sess.pass),
            },
            body: "{}",
        });
        expect(mintWithSession.status).toBe(401);
    });

    it("accepts the main token via Basic and Bearer", async () => {
        for (const auth of [basic("paperboard", TOKEN), `Bearer ${TOKEN}`]) {
            const res = await fetch(`${base}/dav/`, {
                method: "PROPFIND",
                headers: { Depth: "0", Authorization: auth },
            });
            expect(res.status).toBe(207);
        }
    });
});

describe("WebDAV files", () => {
    it("lists the root with collection resourcetype", async () => {
        const sess = await mintSession();
        const res = await fetch(`${base}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "1", Authorization: basic(sess.user, sess.pass) },
        });
        expect(res.status).toBe(207);
        const xml = await res.text();
        expect(xml).toContain("paperboard");
        expect(xml).toContain("<D:collection/>");
        expect(xml).not.toContain("sockets");
    });

    it("round-trips PUT/GET/DELETE and MKCOL", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const mk = await fetch(`${base}/dav/files/sub`, { method: "MKCOL", headers: { Authorization: auth } });
        expect(mk.status).toBe(201);
        const put = await fetch(`${base}/dav/files/sub/a.txt`, {
            method: "PUT",
            headers: { Authorization: auth },
            body: "data-123",
        });
        expect([201, 204]).toContain(put.status);
        const get = await fetch(`${base}/dav/files/sub/a.txt`, {
            headers: { Authorization: auth },
        });
        expect(get.status).toBe(200);
        expect(await get.text()).toBe("data-123");
        const del = await fetch(`${base}/dav/files/sub`, { method: "DELETE", headers: { Authorization: auth } });
        expect(del.status).toBe(204);
        expect(fs.existsSync(path.join(tmp, "files", "sub"))).toBe(false);
    });

    it("refuses traversal and the sockets dir", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const trav = await fetch(`${base}/dav/%2e%2e/%2e%2e/etc/passwd`, {
            headers: { Authorization: auth },
        });
        expect([403, 404]).toContain(trav.status);
        const sock = await fetch(`${base}/dav/sockets/`, {
            method: "PROPFIND",
            headers: { Depth: "0", Authorization: auth },
        });
        expect([403, 404]).toContain(sock.status);
    });

    it("copies and moves with Overwrite handling", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const copy = await fetch(`${base}/dav/files/note.txt`, {
            method: "COPY",
            headers: {
                Authorization: auth,
                Destination: `${base}/dav/files/note2.txt`,
            },
        });
        expect([201, 204]).toContain(copy.status);
        const clash = await fetch(`${base}/dav/files/note.txt`, {
            method: "COPY",
            headers: {
                Authorization: auth,
                Destination: `${base}/dav/files/note2.txt`,
                Overwrite: "F",
            },
        });
        expect(clash.status).toBe(412);
        const move = await fetch(`${base}/dav/files/note2.txt`, {
            method: "MOVE",
            headers: {
                Authorization: auth,
                Destination: `${base}/dav/files/moved.txt`,
            },
        });
        expect([201, 204]).toContain(move.status);
        expect(fs.existsSync(path.join(tmp, "files", "moved.txt"))).toBe(true);
        expect(fs.existsSync(path.join(tmp, "files", "note2.txt"))).toBe(false);
    });

    it("refuses locks honestly instead of minting ones it never stores", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const lock = await fetch(`${base}/dav/files/note.txt`, {
            method: "LOCK",
            headers: { Authorization: auth, Timeout: "Second-3600" },
            body: '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope></D:lockinfo>',
        });
        expect(lock.status).toBe(501);
        const unlock = await fetch(`${base}/dav/files/note.txt`, {
            method: "UNLOCK",
            headers: { Authorization: auth, "Lock-Token": "<opaquelocktoken:whatever>" },
        });
        expect(unlock.status).toBe(501);
    });

    it("refuses dead-end property writes", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const prop = await fetch(`${base}/dav/files/note.txt`, {
            method: "PROPPATCH",
            headers: { Authorization: auth },
            body: '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:x-custom>1</D:x-custom></D:set></D:propertyupdate>',
        });
        expect(prop.status).toBe(501);
    });

    it("bounds a depth-infinity listing instead of walking unbounded", async () => {
        // seed > cap files in one directory
        const floodDir = path.join(tmp, "files", "flood");
        fs.mkdirSync(floodDir, { recursive: true });
        for (let i = 0; i < 5100; i++) {
            fs.writeFileSync(path.join(floodDir, `f${i}.txt`), "x");
        }
        const sess = await mintSession();
        const res = await fetch(`${base}/dav/files/flood/`, {
            method: "PROPFIND",
            headers: { Depth: "infinity", Authorization: basic(sess.user, sess.pass) },
        });
        expect(res.status).toBe(207);
        const xml = await res.text();
        const entries = (xml.match(/<D:response>/g) || []).length;
        expect(entries).toBeGreaterThan(0);
        expect(entries).toBeLessThan(6000);
        fs.rmSync(floodDir, { recursive: true, force: true });
    });

    it("revoked sessions stop working", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const before = await fetch(`${base}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "0", Authorization: auth },
        });
        expect(before.status).toBe(207);
        const revoke = await fetch(`${base}/dav/session`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${TOKEN}` },
            body: JSON.stringify({ user: sess.user }),
        });
        expect(revoke.status).toBe(200);
        const after = await fetch(`${base}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "0", Authorization: auth },
        });
        expect(after.status).toBe(401);
    });
});

describe("DavSessionStore + resolveDavPath units", () => {
    it("expires idle sessions on use", async () => {
        const store = new DavSessionStore();
        const s = store.issue(30000);
        expect(store.useBasic(s.user, s.pass)?.user).toBe(s.user);
        // Age it past idle without waiting: rewrite activity timestamp
        const aged = store.useBasic(s.user, s.pass);
        expect(aged).not.toBeNull();
        (s as { lastActiveAt: number }).lastActiveAt = Date.now() - 60_000;
        expect(store.useBasic(s.user, s.pass)).toBeNull();
    });

    it("resolves inside root and rejects escapes", () => {
        expect(resolveDavPath(tmp, "/files/a.txt")).toBe(
            path.join(tmp, "files", "a.txt"),
        );
        expect(resolveDavPath(tmp, "/")).toBe(tmp);
        expect(resolveDavPath(tmp, "/../x")).toBeNull();
        expect(resolveDavPath(tmp, "/sockets/sock")).toBeNull();
        expect(resolveDavPath(tmp, "/files/../../x")).toBeNull();
    });

    it("resolves nothing for credential/local files and key material", () => {
        fs.mkdirSync(path.join(tmp, "local"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "local", "secrets.json"), "{}");
        for (const rel of [
            "/local/secrets.json",
            "/local/crane.json",
            "/local/authorized_tokens.json",
            "/local/paired_computers.json",
            "/local/machine-id.json",
            "/files/server.key",
            "/packages/cert.pem",
            "/local/SECRETS.json",
            "/local/tls_identity.json",
            "/LOCAL/tls_identity.json",
            "/Local/",
            "/SOCKETS/x.sock",
            "/files/tls_identity.json",
        ]) {
            expect(resolveDavPath(tmp, rel)).toBeNull();
        }
        // all of local/ is this computer's own state, not a share: the old
        // name list here allowed local/app-settings.json and with it every
        // file nobody had thought to list, including tls_identity.json
        expect(resolveDavPath(tmp, "/local/app-settings.json")).toBeNull();
        expect(resolveDavPath(tmp, "/local")).toBeNull();
        // the file exists on disk but is invisible to WebDAV
        expect(fs.existsSync(path.join(tmp, "local", "secrets.json"))).toBe(true);
    });
});

describe("WebDAV credential files", () => {
    it("serves credential files to no method, in any casing", async () => {
        fs.mkdirSync(path.join(tmp, "local"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "local", "tls_identity.json"), "{\"key\":\"fixture\"}");
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        for (const method of ["GET", "PROPFIND", "PUT", "COPY", "DELETE"]) {
            const key = await fetch(`${base}/dav/local/tls_identity.json`, {
                method,
                headers: { Authorization: auth, Destination: `${base}/dav/files/y.json` },
                body: method === "PUT" ? "replaced" : undefined,
            });
            expect([403, 404]).toContain(key.status);
        }
        expect(fs.readFileSync(path.join(tmp, "local", "tls_identity.json"), "utf8")).toContain("fixture");
        for (const method of ["GET", "PROPFIND", "PUT", "COPY", "DELETE"]) {
            const res = await fetch(`${base}/dav/local/secrets.json`, {
                method,
                headers: { Authorization: auth, Destination: `${base}/dav/files/x.json` },
                body: method === "PUT" ? "stolen!{" : undefined,
            });
            expect([403, 404]).toContain(res.status);
        }
        const upper = await fetch(`${base}/dav/files/server.key`, { headers: { Authorization: auth } });
        expect([403, 404]).toContain(upper.status);
        const listing = await fetch(`${base}/dav/local/`, {
            method: "PROPFIND",
            headers: { Depth: "1", Authorization: auth },
        });
        expect([403, 404]).toContain(listing.status);
        const root = await fetch(`${base}/dav/`, {
            method: "PROPFIND",
            headers: { Depth: "1", Authorization: auth },
        });
        expect(root.status).toBe(207);
        expect(await root.text()).not.toContain("/local");
    });

    it("rejects uploads beyond the cap with 413", async () => {
        const prev = process.env.PAPERCRANE_DAV_MAX_UPLOAD;
        process.env.PAPERCRANE_DAV_MAX_UPLOAD = "8";
        try {
            const sess = await mintSession();
            const auth = basic(sess.user, sess.pass);
            const over = await fetch(`${base}/dav/files/big.txt`, {
                method: "PUT",
                headers: { Authorization: auth },
                body: "0123456789",
            });
            expect(over.status).toBe(413);
            const fits = await fetch(`${base}/dav/files/small.txt`, {
                method: "PUT",
                headers: { Authorization: auth },
                body: "0123",
            });
            expect([201, 204]).toContain(fits.status);
            expect(fs.existsSync(path.join(tmp, "files", "big.txt"))).toBe(false);
        } finally {
            if (prev === undefined) delete process.env.PAPERCRANE_DAV_MAX_UPLOAD;
            else process.env.PAPERCRANE_DAV_MAX_UPLOAD = prev;
        }
    });
});

describe("WebDAV upload cap", () => {
    it("rejects uploads beyond the configured cap with 413", async () => {
        const prev = process.env.PAPERCRANE_DAV_MAX_UPLOAD;
        process.env.PAPERCRANE_DAV_MAX_UPLOAD = "8";
        try {
            const sess = await mintSession();
            const auth = basic(sess.user, sess.pass);
            const over = await fetch(`${base}/dav/files/big.txt`, {
                method: "PUT",
                headers: { Authorization: auth },
                body: "0123456789",
            });
            expect(over.status).toBe(413);
            // cap-exact or smaller still allowed
            const fits = await fetch(`${base}/dav/files/small.txt`, {
                method: "PUT",
                headers: { Authorization: auth },
                body: "0123",
            });
            expect([201, 204]).toContain(fits.status);
            expect(fs.existsSync(path.join(tmp, "files", "big.txt"))).toBe(false);
        } finally {
            if (prev === undefined) delete process.env.PAPERCRANE_DAV_MAX_UPLOAD;
            else process.env.PAPERCRANE_DAV_MAX_UPLOAD = prev;
        }
    });
});

describe("WebDAV symlink refusal", () => {
    it("never serves file content through a symlink, and never lists one", async () => {
        // plant a symlink inside the DAV tree pointing at a real file
        const real = path.join(tmp, "files", "real.txt");
        const link = path.join(tmp, "files", "link.txt");
        fs.writeFileSync(real, "topsecret");
        try {
            fs.unlinkSync(link);
        } catch {
            // not present yet
        }
        fs.symlinkSync(real, link);
        try {
            // GET through the link is refused even though the target exists
            // and is readable: lstat (not stat) drives the guard
            const get = await fetch(`${base}/dav/files/link.txt`, {
                headers: { Authorization: `Bearer ${TOKEN}` },
            });
            expect(get.status).toBe(403);
            // the real file still serves normally
            const direct = await fetch(`${base}/dav/files/real.txt`, {
                headers: { Authorization: `Bearer ${TOKEN}` },
            });
            expect(direct.status).toBe(200);
            expect(await direct.text()).toBe("topsecret");
            // PROPFIND depth 1 skips the symlink instead of following it
            const sess = await mintSession();
            const list = await fetch(`${base}/dav/files/`, {
                method: "PROPFIND",
                headers: { Depth: "1", Authorization: basic(sess.user, sess.pass) },
            });
            expect(list.status).toBe(207);
            const xml = await list.text();
            expect(xml).toContain("real.txt");
            expect(xml).not.toContain("link.txt");
        } finally {
            fs.unlinkSync(link);
        }
    });
});

describe("WebDAV root traversal guard", () => {
    it("refuses DELETE /dav/%2f and keeps the data dir plus vault", async () => {
        const sess = await mintSession();
        const auth = basic(sess.user, sess.pass);
        const marker = path.join(tmp, "files", "note.txt");
        expect(fs.existsSync(marker)).toBe(true);
        const del = await fetch(`${base}/dav/%2f`, {
            method: "DELETE",
            headers: { Authorization: auth },
        });
        expect([403, 404]).toContain(del.status);
        const dot = await fetch(`${base}/dav/%2e`, {
            method: "DELETE",
            headers: { Authorization: auth },
        });
        expect([403, 404]).toContain(dot.status);
        expect(fs.existsSync(tmp)).toBe(true);
        expect(fs.existsSync(marker)).toBe(true);
        expect(fs.existsSync(path.join(tmp, "local", "secrets.json"))).toBe(true);
    });
});

describe("malformed Host header", () => {
    it("answers 400 instead of throwing", async () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const status = await new Promise<number>((resolve, reject) => {
            const { Socket } = require("net") as typeof import("net");
            const sock = new Socket();
            sock.on("error", reject);
            sock.connect(port, "127.0.0.1", () => {
                sock.write("GET /health HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n");
            });
            let data = "";
            sock.on("data", (c) => (data += c.toString()));
            sock.on("close", () => resolve(Number(/HTTP\/1\.1 (\d+)/.exec(data)?.[1] ?? 0)));
        });
        expect(status).toBe(400);
        const health = await fetch(`${base}/health`);
        expect(health.status).toBe(200);
    });
});

describe("parseBasic", () => {
    const enc = (s: string) => Buffer.from(s).toString("base64");
    it("reads user and password, scheme case-insensitive, any whitespace run", () => {
        expect(parseBasic(`Basic ${enc("u:p:w")}`)).toEqual({ user: "u", pass: "p:w" });
        expect(parseBasic(`  bAsIc \t  ${enc("a:b")}  `)).toEqual({ user: "a", pass: "b" });
    });
    it("refuses other schemes, missing credentials and missing colons", () => {
        expect(parseBasic("Bearer abc")).toBeNull();
        expect(parseBasic("Basicabc")).toBeNull();
        expect(parseBasic("Basic")).toBeNull();
        expect(parseBasic("Basic    ")).toBeNull();
        expect(parseBasic(`Basic ${enc("nocolon")}`)).toBeNull();
    });
    it("stays linear on a header of nothing but spaces", () => {
        const t = Date.now();
        parseBasic("Basic " + " ".repeat(1_000_000) + "\u0000");
        expect(Date.now() - t).toBeLessThan(500);
    });
});

describe("local/ is owner-only on disk", () => {
    it.skipIf(process.platform === "win32")("the daemon restricts local/ to its owner", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-mode-"));
        try {
            fs.mkdirSync(path.join(dir, "local"), { mode: 0o755 });
            new PaperCraneEngine(dir);
            expect(fs.statSync(path.join(dir, "local")).mode & 0o777).toBe(0o700);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
