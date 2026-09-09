import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { DavSessionStore, resolveDavPath } from "../papercrane/dav";
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
});
