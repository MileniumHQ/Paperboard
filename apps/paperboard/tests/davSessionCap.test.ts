// DAV session cap (bun test): the store refuses new sessions past the cap
// (never evicting live ones), and /dav/session answers 503 instead of
// hanging when full.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { DavSessionStore } from "../papercrane/dav";
import { handleHttpRequest } from "../papercrane/http";

const TOKEN = "test-session-cap-token";

let tmp = "";
let server: http.Server;
let base = "";
let sessions: DavSessionStore;

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "davcap-test-"));
    const engine = new PaperCraneEngine(tmp);
    const auth = new PaperCraneAuth(false, tmp);
    auth.injectToken(TOKEN, "test");
    sessions = new DavSessionStore();
    server = http.createServer((req, res) => {
        handleHttpRequest(engine, req, res, { auth, sessions });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("DavSessionStore cap", () => {
    it("refuses new sessions past the cap without evicting live ones", () => {
        const store = new DavSessionStore();
        const issued: string[] = [];
        let refused = 0;
        for (let i = 0; i < 60; i++) {
            try {
                issued.push(store.issue(30_000).user);
            } catch (err) {
                refused++;
                expect(String((err as Error)?.message ?? err)).toContain("full");
            }
        }
        expect(issued).toHaveLength(50);
        expect(refused).toBe(10);
        // a revoke frees exactly one slot
        expect(store.revoke(issued[0])).toBe(true);
        expect(() => store.issue(30_000)).not.toThrow();
    });

    it("POST /dav/session answers 503 when the store is full", async () => {
        for (let i = 0; i < 50; i++) sessions.issue(30_000);
        try {
            const res = await fetch(`${base}/dav/session`, {
                method: "POST",
                headers: { Authorization: `Bearer ${TOKEN}` },
                body: "{}",
            });
            expect(res.status).toBe(503);
        } finally {
            sessions.revokeAll();
        }
        const res = await fetch(`${base}/dav/session`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}` },
            body: "{}",
        });
        expect(res.status).toBe(200);
    });
});
