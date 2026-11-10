import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { isRefusedFrame, PANEL_IPC_REFUSED } from "../../src/main/communication/shellGuard";
import { readShellFile } from "../../src/main/shellAssets";
import { isListingFilePath } from "../../src/main/communication/shellHandlers";
import { buildCraneCredentialPayload, buildPanelCsp, remotePanelHtmlCsp, resolveLocalPanelFile, PANEL_TRAVERSAL_VECTORS } from "../../src/main/panelAssets";
import { buildPanelCsp as daemonPanelCsp } from "../../papercrane/panelNet";
import { parseLibraryMessage } from "../../src/renderer/src/lib/libraryFrame";
import { PanelPermissionStore } from "../../src/main/panelPermissions";
import { BUILD_TIMEOUT_MS, buildApp, buildCrane, installBuiltPanel, type BuiltApp } from "../platform/app/support/build";
import { CraneSocket, startCrane, WAIT_MS, type RunningCrane } from "../platform/app/support/crane";
import { domCondition, launchElectron, SHELL, shellReady, type ElectronApp } from "../platform/app/support/electron";
import { tempDataDir, tempDir } from "../platform/app/support/temp";

const PANEL = "dev.paperboard.terminal";
const OTHER = "dev.paperboard.botcreator";
const FRAME = `panel://local.${PANEL}/`;

let app: BuiltApp;
let daemon: RunningCrane;
let electron: ElectronApp;
let dataDir: string;

beforeAll(async () => {
    const [built, crane] = await Promise.all([buildApp(), buildCrane()]);
    app = built;
    dataDir = tempDataDir("shell-security");
    await installBuiltPanel(dataDir, PANEL);
    await installBuiltPanel(dataDir, OTHER);
    daemon = await startCrane(crane.file, dataDir);
    electron = await launchElectron({ appDir: app.dir, dataDir, args: ["--skip-update"] });
    await shellReady(electron);
    // open the panel the way a person does
    await electron.evalIn(SHELL, `document.querySelector('[role=radio][aria-label^="This Computer"]').click()`);
    const item = `document.querySelector('[class*=panelList] label[data-value="${PANEL}"]')`;
    await electron.evalIn(SHELL, domCondition(item));
    await electron.evalIn(SHELL, `${item}.click()`);
    await electron.evalIn(SHELL, domCondition(`document.querySelector('iframe[src^="${FRAME}"]')`));
    await electron.evalInFrame(FRAME, domCondition("window.__PAPERBOARD_CRANE"));
}, BUILD_TIMEOUT_MS);

afterAll(async () => {
    await electron?.quit();
    await daemon?.stop();
});

// what crane-credentials answers a document at `url` that has the shell's preload
async function credentialsFrom(url: string): Promise<{ ok?: unknown; err?: string; url: string }> {
    return electron.evalMain(`
        const path = require("path");
        const win = new electron.BrowserWindow({ show: false, webPreferences: {
            preload: path.join(app.getAppPath(), "out", "preload", "index.js"), sandbox: true, contextIsolation: true } });
        await new Promise((resolve) => { win.webContents.once("did-finish-load", resolve); win.webContents.once("did-fail-load", resolve); win.loadURL(${JSON.stringify(url)}).catch((err) => err); });
        const answer = await win.webContents.executeJavaScript(
            'window.electron.ipcRenderer.invoke("crane-credentials").then((ok) => ({ ok }), (e) => ({ err: String(e.message) }))', true);
        answer.url = win.webContents.getURL();
        win.destroy();
        return answer;`);
}

// Shell IPC answers only the shell, and the packaged shell is served from its own origin.
describe("the shell's IPC, navigation, daemon origin and file server", () => {
    test("shell IPC answers the shell and refuses panel, file, look-alike and unknown senders", async () => {
        const shell = await electron.evalIn(SHELL, `window.electron.ipcRenderer.invoke("crane-credentials")`);
        expect(shell).toMatchObject({ computerId: "local", port: daemon.handshake.port });

        const file = path.join(tempDir("file-page"), "page.html");
        fs.writeFileSync(file, "<!doctype html><p>a local file</p>");
        for (const url of [`${FRAME}index.html`, `file://${file}`, "paperboard://shellfake/index.html", "data:text/html,<p>x</p>", "about:blank"]) {
            const answer = await credentialsFrom(url);
            expect({ url, answer: answer.err?.startsWith(`Error invoking remote method 'crane-credentials': Error: ${PANEL_IPC_REFUSED}`) ?? answer }).toEqual({ url, answer: true });
        }
        // a sender whose frame can't be read is refused too
        expect(isRefusedFrame({})).toBe(true);
        expect(isRefusedFrame({ senderFrame: { url: "paperboard://shell/index.html" } })).toBe(false);
    }, WAIT_MS * 2);

    test("the shell window cannot navigate away from its origin", async () => {
        // (Chromium itself refuses a file:// navigation from this origin before main hears of it)
        for (const target of ["paperboard://shellfake/index.html", `${FRAME}index.html`, "https://paperboard.invalid/"]) {
            const prevented = electron.evalMain(`
                const shell = electron.webContents.getAllWebContents().find((c) => c.getURL().startsWith("paperboard://shell/"));
                return new Promise((resolve) => shell.once("will-navigate", (event, url) => resolve({ url, prevented: event.defaultPrevented })));`);
            await electron.evalIn(SHELL, `location.href = ${JSON.stringify(target)}; true`);
            expect(await prevented).toEqual({ url: target, prevented: true });
        }
        expect(await electron.evalIn(SHELL, "location.href")).toBe("paperboard://shell/index.html");
    }, WAIT_MS);

    test("the daemon authenticates the shell's origin and closes a file:// origin with 4403", async () => {
        const shell = await CraneSocket.open(daemon.handshake.port, { Origin: "paperboard://shell" });
        expect(await shell.call("auth:verify", { token: daemon.handshake.token })).toMatchObject({ success: true });
        shell.close();
        const local = await CraneSocket.open(daemon.handshake.port, { Origin: "file://" });
        expect(await local.closed).toMatchObject({ code: 4403 });
    });

    test("the shell file server serves the build and refuses to leave it", async () => {
        const renderer = path.join(app.dir, "out", "renderer");
        const index = await readShellFile(renderer, "/index.html");
        expect(index.ok).toBe(true);
        expect(index.ok && index.headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
        for (const vector of ["/../package.json", "/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/assets/../../package.json"]) {
            expect({ vector, status: (await readShellFile(renderer, vector) as { status?: number }).status }).toEqual({ vector, status: 403 });
        }
        expect(await readShellFile(renderer, "/%E0%A4%A")).toEqual({ ok: false, status: 400 });
        // and through the real protocol handler
        const status = await electron.evalIn(SHELL, `fetch("paperboard://shell/..%2f..%2fpackage.json").then((r) => r.status)`);
        expect(status).toBe(403);
    }, WAIT_MS);
});

// Panel frames get only their own files and a scoped token.
describe("panel frames", () => {
    test("a panel frame carries its own scoped token and cannot read another panel's files", async () => {
        const creds = await electron.evalInFrame(FRAME, "window.__PAPERBOARD_CRANE");
        expect(creds).toMatchObject({ scoped: true, computerId: "local", panelId: PANEL, port: daemon.handshake.port });
        expect(creds.token).toStartWith("pcp_");
        expect(creds.token).not.toBe(daemon.handshake.token);
        const own = await electron.evalInFrame(FRAME, `fetch("${FRAME}manifest.json").then((r) => r.json()).then((m) => m.id)`);
        expect(own).toBe(PANEL);
        // another panel's document carries that panel's credential: a panel
        // frame is its own origin and must not read it
        const other = await electron.evalInFrame(FRAME, `fetch("panel://local.${OTHER}/index.html").then((r) => "read " + r.status, (e) => "refused " + e.name)`);
        expect(other).toBe("refused TypeError");
    }, WAIT_MS);

    test("panel:// resolves only inside the panel, and a credential that can't be issued is null, never the master", () => {
        const panels = tempDir("panels");
        const panelDir = path.join(panels, "dev.example.panel");
        fs.mkdirSync(path.join(panelDir, "dist"), { recursive: true });
        fs.writeFileSync(path.join(panelDir, "dist", "index.html"), "<p>panel</p>");
        fs.writeFileSync(path.join(panels, "SENTINEL"), "outside");
        expect(resolveLocalPanelFile(panels, "dev.example.panel", "index.html")).toEqual({ kind: "ok", file: path.join(panelDir, "dist", "index.html") });
        for (const vector of PANEL_TRAVERSAL_VECTORS) {
            expect({ vector, kind: resolveLocalPanelFile(panels, "dev.example.panel", vector).kind }).toEqual({ vector, kind: "forbidden" });
        }
        // a link inside the panel to somewhere outside it
        fs.symlinkSync(path.join(panels, "SENTINEL"), path.join(panelDir, "dist", "leak.txt"));
        expect(resolveLocalPanelFile(panels, "dev.example.panel", "leak.txt").kind).toBe("forbidden");

        expect(buildCraneCredentialPayload(null, "local", "dev.example.panel", "pcp_x")).toBe("null");
        expect(buildCraneCredentialPayload({ port: 1, token: "MASTER" }, "local", "dev.example.panel", "")).toBe("null");
        const payload = buildCraneCredentialPayload({ port: 1, token: "MASTER" }, "local", "dev.example.panel", "pcp_</script>");
        expect(payload).not.toContain("MASTER");
        expect(payload).not.toContain("<");
        expect(JSON.parse(payload)).toMatchObject({ token: "pcp_</script>", panelId: "dev.example.panel", scoped: true });
    });

    test("the listing-file channel serves only manifest.json and listing media", async () => {
        for (const ok of ["manifest.json", "store/about.md", "store/1-light.png", "branding/icon.webp", "store/shot.JPG"]) expect({ ok, allowed: isListingFilePath(ok) }).toEqual({ ok, allowed: true });
        for (const no of ["index.html", "dist/index.html", "dist/service.js", "branding/icon.svg", "../other/manifest.json", "store/../../x.png", "dist/manifest.json"]) {
            expect({ no, allowed: isListingFilePath(no) }).toEqual({ no, allowed: false });
        }
        const manifest = await electron.evalIn(SHELL, `window.electron.ipcRenderer.invoke("panel-listing-file", { computerId: "local", panelId: "${PANEL}", path: "manifest.json" })`);
        expect(JSON.parse(Buffer.from(manifest, "base64").toString("utf8")).id).toBe(PANEL);
        const html = await electron.evalIn(SHELL, `window.electron.ipcRenderer.invoke("panel-listing-file", { computerId: "local", panelId: "${PANEL}", path: "index.html" }).then(() => "served", (e) => e.message)`);
        expect(html).toContain("Not a listing file: index.html");
    }, WAIT_MS);

    test("the library frame's messages count only from its own window and origin, with valid panel ids", () => {
        const frame = {};
        const identity = { sourceWindow: frame as Window, origin: "https://origami.ariapis.com" };
        const install = { type: "paperboard:library-install", requestId: "r1", panelId: "dev.paperboard.terminal" };
        expect(parseLibraryMessage({ source: frame, origin: identity.origin, data: install }, identity)).toEqual(install);
        expect(parseLibraryMessage({ source: {}, origin: identity.origin, data: install }, identity)).toBeNull();
        expect(parseLibraryMessage({ source: frame, origin: "https://evil.example", data: install }, identity)).toBeNull();
        expect(parseLibraryMessage({ source: frame, origin: identity.origin, data: install }, { sourceWindow: null, origin: identity.origin })).toBeNull();
        for (const panelId of ["../escape", "UPPER", "", "settings", "library", "shell-home", "app-settings", 7]) {
            for (const type of ["paperboard:library-install", "paperboard:library-media", "paperboard:library-open"]) {
                expect(parseLibraryMessage({ source: frame, origin: identity.origin, data: { type, requestId: "r", panelId } }, identity)).toBeNull();
            }
        }
    });
});

// Panel CSP and device permissions.
describe("panel CSP and device permissions", () => {
    test("a local panel's script-src is exactly 'self' plus a fresh nonce per response", async () => {
        expect(daemonPanelCsp().split("; ").find((d) => d.startsWith("script-src"))).toBe("script-src 'self'");
        const policies: string[] = await electron.evalInFrame(FRAME, `Promise.all([1, 2].map(() => fetch("${FRAME}index.html").then((r) => r.headers.get("content-security-policy"))))`);
        const nonces = policies.map((csp) => {
            const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
            expect(scriptSrc).toMatch(/^script-src 'nonce-[A-Za-z0-9+/=]+' 'self'$/);
            expect(csp).not.toContain("unsafe-eval");
            return /'nonce-([^']+)'/.exec(scriptSrc)![1];
        });
        expect(nonces[0]).not.toBe(nonces[1]);
        expect(buildPanelCsp("n1")).toContain("script-src 'nonce-n1' 'self';");
    }, WAIT_MS);

    test("a remote panel uses its daemon's policy without frame-ancestors", () => {
        const served = "default-src 'self'; script-src 'self'; frame-ancestors 'none'; connect-src 'self'";
        const csp = remotePanelHtmlCsp(served, "abc");
        expect(csp).toBe("default-src 'self'; script-src 'nonce-abc' 'self'; connect-src 'self'");
        expect(csp).not.toContain("frame-ancestors");
        // a daemon that sent no usable policy gets the fixed panel one
        expect(remotePanelHtmlCsp(null, "abc")).toBe(daemonPanelCsp());
    });

    test("microphone, camera and screen are asked once per panel, kept, and any no refuses", async () => {
        const file = path.join(tempDir("permissions"), "panel-permissions.json");
        const store = new PanelPermissionStore(file);
        const asked: string[][] = [];
        const ask = (answer: "allowed" | "denied" | null) => async (unanswered: string[]) => {
            asked.push([...unanswered]);
            return answer;
        };
        // two asks at once share one question
        const [a, b] = await Promise.all([store.decide("dev.a", ["microphone"], ask("allowed")), store.decide("dev.a", ["microphone"], ask("allowed"))]);
        expect([a, b]).toEqual([true, true]);
        expect(asked).toEqual([["microphone"]]);
        // kept, per panel: another store on the same file reads it, and another panel is asked
        const reread = new PanelPermissionStore(file);
        expect(await reread.decide("dev.a", ["microphone"], ask("denied"))).toBe(true);
        expect(await reread.decide("dev.b", ["microphone"], ask("denied"))).toBe(false);
        expect(asked).toEqual([["microphone"], ["microphone"]]);
        // a no to any part refuses without asking about the rest
        reread.set("dev.c", "camera", "denied");
        expect(await reread.decide("dev.c", ["microphone", "camera"], ask("allowed"))).toBe(false);
        expect(asked).toHaveLength(2);
        // closed unanswered refuses once and asks again next time
        expect(await reread.decide("dev.d", ["screen"], ask(null))).toBe(false);
        expect(await reread.decide("dev.d", ["screen"], ask("allowed"))).toBe(true);
        expect(JSON.parse(fs.readFileSync(file, "utf8")).panels["dev.d"]).toEqual({ screen: "allowed" });

        // an answers file that can't be read is an error, never "nothing allowed"
        fs.writeFileSync(file, "{ broken");
        expect(() => new PanelPermissionStore(file).get("dev.a", "microphone")).toThrow(/aren't valid JSON/);
        fs.writeFileSync(file, JSON.stringify({ version: 1 }));
        expect(() => new PanelPermissionStore(file).list()).toThrow(/no "panels" object/);
    });
});
