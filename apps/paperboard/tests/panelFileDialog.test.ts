// Panel save and open dialogs (bun test): a real daemon HTTP server on
// loopback with a temp data dir, the host-side transfer module with fake
// pickers standing in for the native dialog, and the browser-mode host
// routes. Proves the daemon owns the path check, a save writes the chosen
// path only on success, an open replaces a panel file only once it fully
// arrived, and the browser routes answer the shell origin only.
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { PaperCraneEngine } from "../papercrane/engine";
import { PaperCraneAuth } from "../papercrane/auth";
import { DavSessionStore } from "../papercrane/dav";
import { handleHttpRequest } from "../papercrane/http";
import {
    readPanelFileForBrowser,
    runPanelOpenDialog,
    runPanelSaveDialog,
    statPanelFileForBrowser,
    writePanelFileFromBrowser,
    type DaemonEndpoint,
    type PanelFileDialogDeps,
} from "../src/main/panelFileTransfer";
import { BROWSER_HOST_SUFFIX, startBrowserHost, type BrowserHost } from "../src/main/browserHost";
import { parsePanelFileDialogRequest } from "../src/shared/panelFileDialog";

const TOKEN = "panel-file-dialog-token";
const PANEL = "dev.example.backups";
const OTHER = "dev.example.other";

let dataDir = "";
let localDir = "";
let daemon: http.Server;
let port = 0;
let browser: BrowserHost;
const savedCap = process.env.PAPERCRANE_DAV_MAX_UPLOAD;

const endpoint = (): DaemonEndpoint => ({ host: "127.0.0.1", port, token: TOKEN });
const panelFile = (panelId: string, rel: string) => path.join(dataDir, "files", panelId, rel);
const ref = (p: string, extra: Record<string, unknown> = {}) => ({ computerId: "local", panelId: PANEL, path: p, ...extra });

function pickers(choice: { save?: string | null; open?: string | null }, calls: string[] = []): PanelFileDialogDeps {
    return {
        endpoint,
        pickSavePath: async (options) => {
            calls.push(`save:${options.suggestedName}`);
            return choice.save ?? null;
        },
        pickOpenPath: async () => {
            calls.push("open");
            return choice.open ?? null;
        },
    };
}

beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-panelfiles-daemon-"));
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-panelfiles-local-"));
    const engine = new PaperCraneEngine(dataDir);
    const auth = new PaperCraneAuth(false, dataDir);
    auth.injectToken(TOKEN, "test");
    const sessions = new DavSessionStore();
    daemon = http.createServer((req, res) => handleHttpRequest(engine, req, res, { auth, sessions }));
    await new Promise<void>((resolve) => daemon.listen(0, "127.0.0.1", resolve));
    const addr = daemon.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    browser = await startBrowserHost({
        port: 0,
        invoke: {},
        servePanel: async () => new Response("", { status: 404 }),
        panelFiles: {
            stat: (args) => statPanelFileForBrowser(args, endpoint),
            read: (args) => readPanelFileForBrowser(args, endpoint),
            write: (args, body, size) => writePanelFileFromBrowser(args, body, size, endpoint),
        },
    });
});

afterEach(() => {
    if (savedCap === undefined) delete process.env.PAPERCRANE_DAV_MAX_UPLOAD;
    else process.env.PAPERCRANE_DAV_MAX_UPLOAD = savedCap;
});

afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => daemon.close(() => resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(localDir, { recursive: true, force: true });
});

function seed(panelId: string, rel: string, content: string | Buffer): void {
    fs.mkdirSync(path.dirname(panelFile(panelId, rel)), { recursive: true });
    fs.writeFileSync(panelFile(panelId, rel), content);
}

function rawRequest(method: string, rawPath: string, body?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: "127.0.0.1", port, path: rawPath, method, headers: { Authorization: `Bearer ${TOKEN}` } },
            (res) => {
                let text = "";
                res.setEncoding("utf8");
                res.on("data", (c) => (text += c));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
            },
        );
        req.on("error", reject);
        req.end(body);
    });
}

describe("/panel-files on the daemon", () => {
    const url = (rest: string) => `http://127.0.0.1:${port}/panel-files/${rest}`;
    const auth = { Authorization: `Bearer ${TOKEN}` };

    it("refuses callers without the host token", async () => {
        seed(PANEL, "a.txt", "secret");
        expect((await fetch(url(`${PANEL}/a.txt`))).status).toBe(401);
        expect((await fetch(url(`${PANEL}/a.txt`), { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    });

    it("keeps every path inside the named panel's storage", async () => {
        seed(OTHER, "notes.txt", "other panel");
        // sent byte for byte: fetch would normalize the dot segments itself
        for (const escape of ["../dev.example.other/notes.txt", "%2e%2e/dev.example.other/notes.txt", "..%2fdev.example.other%2fnotes.txt"]) {
            const res = await rawRequest("GET", `/panel-files/${PANEL}/${escape}`);
            expect(res.status).toBe(403);
            expect(res.body).not.toContain("other panel");
        }
        const put = await rawRequest("PUT", `/panel-files/${PANEL}/../${OTHER}/notes.txt`, "clobbered");
        expect(put.status).toBe(403);
        expect(fs.readFileSync(panelFile(OTHER, "notes.txt"), "utf8")).toBe("other panel");
    });

    it("refuses reserved and malformed panel ids", async () => {
        for (const id of ["settings", "Bad.Id", "shell-x"]) {
            expect((await fetch(url(`${id}/a.txt`), { headers: auth })).status).toBe(400);
        }
    });

    it("never serves a symlink", async () => {
        seed(OTHER, "target.txt", "linked");
        fs.mkdirSync(path.dirname(panelFile(PANEL, "link.txt")), { recursive: true });
        fs.symlinkSync(panelFile(OTHER, "target.txt"), panelFile(PANEL, "link.txt"));
        const res = await fetch(url(`${PANEL}/link.txt`), { headers: auth });
        expect(res.status).toBe(403);
    });
});

describe("save dialog", () => {
    it("copies the panel file to the chosen path", async () => {
        const bytes = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
        seed(PANEL, "backups/world.zip", bytes);
        const dest = path.join(localDir, "saved.zip");
        const calls: string[] = [];
        const result = await runPanelSaveDialog(ref("backups/world.zip"), pickers({ save: dest }, calls));
        expect(result).toEqual({ status: "saved", name: "saved.zip", bytes: bytes.length });
        expect(calls).toEqual(["save:world.zip"]);
        expect(fs.readFileSync(dest).equals(bytes)).toBe(true);
        expect(fs.existsSync(`${dest}.paperboard-part`)).toBe(false);
    });

    it("writes nothing when the user cancels", async () => {
        seed(PANEL, "c.txt", "cancel me");
        const result = await runPanelSaveDialog(ref("c.txt", { suggestedName: "named.txt" }), pickers({ save: null }));
        expect(result).toEqual({ status: "canceled" });
        expect(fs.readdirSync(localDir).filter((f) => f.startsWith("named"))).toEqual([]);
    });

    it("fails before any dialog when the panel file is missing", async () => {
        const calls: string[] = [];
        const result = await runPanelSaveDialog(ref("missing.zip"), pickers({ save: path.join(localDir, "x.zip") }, calls));
        expect(result).toMatchObject({ status: "failed", code: "not-found" });
        expect(calls).toEqual([]);
    });

    it("leaves the chosen file untouched when the transfer breaks", async () => {
        // a daemon that promises 1000 bytes and hangs up after 10
        const broken = http.createServer((req, res) => {
            res.writeHead(200, { "Content-Length": "1000" });
            if (req.method === "HEAD") return res.end();
            res.write(Buffer.alloc(10, 1));
            setTimeout(() => res.destroy(), 20);
        });
        await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve));
        try {
            const brokenPort = (broken.address() as { port: number }).port;
            const dest = path.join(localDir, "keep.bin");
            fs.writeFileSync(dest, "previous");
            const result = await runPanelSaveDialog(ref("big.bin"), {
                ...pickers({ save: dest }),
                endpoint: () => ({ host: "127.0.0.1", port: brokenPort, token: TOKEN }),
            });
            expect(result.status).toBe("failed");
            expect(fs.readFileSync(dest, "utf8")).toBe("previous");
            expect(fs.existsSync(`${dest}.paperboard-part`)).toBe(false);
        } finally {
            await new Promise<void>((resolve) => broken.close(() => resolve()));
        }
    });

    it("holds one dialog per panel at a time", async () => {
        seed(PANEL, "one.txt", "one");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const first = runPanelSaveDialog(ref("one.txt"), {
            ...pickers({}),
            pickSavePath: async () => {
                await gate;
                return null;
            },
        });
        await Bun.sleep(50);
        const second = await runPanelSaveDialog(ref("one.txt"), pickers({ save: null }));
        expect(second).toMatchObject({ status: "failed", code: "busy" });
        release();
        expect(await first).toEqual({ status: "canceled" });
        expect(await runPanelSaveDialog(ref("one.txt"), pickers({ save: null }))).toEqual({ status: "canceled" });
    });
});

describe("open dialog", () => {
    it("copies the chosen file into the panel's storage", async () => {
        const source = path.join(localDir, "restore.zip");
        fs.writeFileSync(source, "restore bytes");
        const result = await runPanelOpenDialog(ref("imports/restore.zip"), pickers({ open: source }));
        expect(result).toEqual({ status: "opened", name: "restore.zip", bytes: 13 });
        expect(fs.readFileSync(panelFile(PANEL, "imports/restore.zip"), "utf8")).toBe("restore bytes");
    });

    it("keeps the previous file when the upload is over the computer's cap", async () => {
        seed(PANEL, "state.json", "old state");
        const source = path.join(localDir, "huge.json");
        fs.writeFileSync(source, "x".repeat(4096));
        process.env.PAPERCRANE_DAV_MAX_UPLOAD = "1024";
        const result = await runPanelOpenDialog(ref("state.json"), pickers({ open: source }));
        expect(result).toMatchObject({ status: "failed", code: "too-large" });
        expect(fs.readFileSync(panelFile(PANEL, "state.json"), "utf8")).toBe("old state");
        expect(fs.readdirSync(path.dirname(panelFile(PANEL, "state.json"))).filter((f) => f.includes(".davpart"))).toEqual([]);
    });

    it("refuses a path outside the panel's storage at the daemon", async () => {
        const source = path.join(localDir, "evil.txt");
        fs.writeFileSync(source, "evil");
        seed(OTHER, "keep.txt", "kept");
        const result = await runPanelOpenDialog(ref(`../${OTHER}/keep.txt`), pickers({ open: source }));
        expect(result.status).toBe("failed");
        expect(fs.readFileSync(panelFile(OTHER, "keep.txt"), "utf8")).toBe("kept");
    });

    it("writes nothing when the user cancels", async () => {
        const result = await runPanelOpenDialog(ref("never.txt"), pickers({ open: null }));
        expect(result).toEqual({ status: "canceled" });
        expect(fs.existsSync(panelFile(PANEL, "never.txt"))).toBe(false);
    });
});

describe("request contract", () => {
    it("refuses malformed requests before any dialog", async () => {
        const calls: string[] = [];
        for (const bad of [
            { ...ref("a.txt"), panelId: "settings" },
            { ...ref(""), path: "" },
            ref("a.txt", { suggestedName: "../escape.txt" }),
            ref("a.txt", { filters: [{ name: "Zip", extensions: [".zip"] }] }),
        ]) {
            expect(await runPanelSaveDialog(bad, pickers({ save: null }, calls))).toMatchObject({ status: "failed", code: "invalid-request" });
        }
        expect(calls).toEqual([]);
        expect(parsePanelFileDialogRequest(ref("a.txt", { filters: [{ name: "Zip", extensions: ["zip"] }] })).filters).toEqual([
            { name: "Zip", extensions: ["zip"] },
        ]);
    });
});

describe("browser-mode routes", () => {
    function call(route: string, body: string | Buffer, headers: Record<string, string>, query = "") {
        return new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port: browser.port,
                    path: `/_shell/panel-file/${route}${query}`,
                    method: "POST",
                    headers: { host: `${BROWSER_HOST_SUFFIX}:${browser.port}`, "content-length": String(Buffer.byteLength(body)), ...headers },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (c) => chunks.push(c));
                    res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
                },
            );
            req.on("error", reject);
            req.end(body);
        });
    }
    const json = { "content-type": "application/json" };
    const panelOrigin = () => `http://local.${PANEL}.${BROWSER_HOST_SUFFIX}:${browser.port}`;

    it("streams a panel file to the shell origin and refuses a panel origin", async () => {
        seed(PANEL, "export.bin", "exported");
        const body = JSON.stringify(ref("export.bin"));
        const stat = await call("stat", body, { ...json, origin: browser.origin });
        expect(JSON.parse(stat.body.toString())).toEqual({ size: 8 });
        const read = await call("read", body, { ...json, origin: browser.origin });
        expect(read.status).toBe(200);
        expect(read.body.toString()).toBe("exported");
        for (const route of ["stat", "read"]) {
            expect((await call(route, body, { ...json, origin: panelOrigin() })).status).toBe(403);
        }
    });

    it("writes an upload from the shell origin and refuses a panel origin", async () => {
        const query = `?request=${encodeURIComponent(JSON.stringify(ref("uploaded.txt")))}`;
        const refused = await call("write", "from panel", { origin: panelOrigin() }, query);
        expect(refused.status).toBe(403);
        expect(fs.existsSync(panelFile(PANEL, "uploaded.txt"))).toBe(false);
        const ok = await call("write", "from shell", { origin: browser.origin }, query);
        expect(JSON.parse(ok.body.toString())).toMatchObject({ status: "opened", bytes: 10 });
        expect(fs.readFileSync(panelFile(PANEL, "uploaded.txt"), "utf8")).toBe("from shell");
    });

    it("reports a missing file as a typed failure", async () => {
        const res = await call("stat", JSON.stringify(ref("nope.bin")), { ...json, origin: browser.origin });
        expect(res.status).toBe(409);
        expect(JSON.parse(res.body.toString())).toMatchObject({ status: "failed", code: "not-found" });
    });

    it("releases the panel's slot when a read finishes", async () => {
        seed(PANEL, "twice.bin", "twice");
        const body = JSON.stringify(ref("twice.bin"));
        for (let i = 0; i < 3; i++) {
            const read = await call("read", body, { ...json, origin: browser.origin });
            expect(read.body.toString()).toBe("twice");
        }
        // a direct read whose stream is dropped also lets the next one in
        const first = await readPanelFileForBrowser(ref("twice.bin"), endpoint);
        first.body.destroy();
        await Bun.sleep(20);
        const again = await readPanelFileForBrowser(ref("twice.bin"), endpoint);
        expect((await Readable.from(again.body).toArray()).join("")).toBe("twice");
    });
});
