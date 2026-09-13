// /panel/ asset auth (bun test): panel dist trees are authenticated-only —
// no token gets 401, the main-token Bearer header the DAV surface uses
// gets 200.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { DavSessionStore } from "../papercrane/dav";
import { handleHttpRequest } from "../papercrane/http";
import {
    resolveLocalPanelFile,
    PANEL_TRAVERSAL_VECTORS,
} from "../papercrane/panelAssets";

const TOKEN = "test-panel-token";

let tmp = "";
let server: http.Server;
let base = "";

beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "panelhttp-test-"));
    const engine = new PaperCraneEngine(tmp);
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
    // Seed one installed panel the way installPanel leaves it
    fs.mkdirSync(path.join(tmp, "panels", "testpanel", "dist"), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, "panels", "testpanel", "dist", "index.html"),
        "<html><body>hi</body></html>",
    );
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("/panel/ asset auth", () => {
    it("refuses asset fetches without a token with 401", async () => {
        const res = await fetch(`${base}/panel/testpanel/index.html`);
        expect(res.status).toBe(401);
    });

    it("refuses asset fetches with a wrong token with 401", async () => {
        const res = await fetch(`${base}/panel/testpanel/index.html`, {
            headers: { Authorization: "Bearer nope" },
        });
        expect(res.status).toBe(401);
    });

    it("serves asset fetches carrying the main-token Bearer header", async () => {
        const res = await fetch(`${base}/panel/testpanel/index.html`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("hi");
    });

    it("shares the panel:// resolver's traversal vectors (one implementation)", async () => {
        const sentinel = path.join(tmp, "outside-http.txt");
        fs.writeFileSync(sentinel, "secret");
        const panelsDir = path.join(tmp, "panels");
        for (const vector of PANEL_TRAVERSAL_VECTORS) {
            const evil = vector.replace(/SENTINEL/g, "outside-http.txt");
            // unit level: the route's resolver forbids the same vectors
            const res = resolveLocalPanelFile(panelsDir, "testpanel", evil);
            expect(`${evil}=${res.kind}`).toBe(`${evil}=forbidden`);
            // wire level: an encoded traversal never escapes either —
            // refused (400/403/404 depending on where normalization lands)
            // and the sentinel bytes never leave
            const wire = await fetch(
                `${base}/panel/testpanel/${evil.split("/").map(encodeURIComponent).join("/")}`,
                { headers: { Authorization: `Bearer ${TOKEN}` } },
            );
            expect([400, 403, 404]).toContain(wire.status);
            expect(await wire.text()).not.toContain("secret");
        }
        expect(fs.readFileSync(sentinel, "utf8")).toBe("secret");
    });
});

describe("/shutdown demands a credential", () => {
    const guard = { "x-papercrane-shutdown": "1" };
    // the success path is deliberately untested: it exits the process.
    // These refusals prove the gate — header alone is not a credential.

    it("refuses without the guard header, even with a valid token", async () => {
        const res = await fetch(`${base}/shutdown`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        expect(res.status).toBe(403);
    });

    it("refuses with the header but no token", async () => {
        const res = await fetch(`${base}/shutdown`, {
            method: "POST",
            headers: { ...guard },
        });
        expect(res.status).toBe(403);
    });

    it("refuses with the header and a wrong token", async () => {
        const res = await fetch(`${base}/shutdown`, {
            method: "POST",
            headers: { ...guard, Authorization: "Bearer nope" },
        });
        expect(res.status).toBe(403);
    });
});
