// panel:// local asset containment (bun test): traversal fixtures are
// forbidden, real files resolve to their bytes, missing ids read as
// not-found. Exercises the same resolver the protocol handler serves from.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveLocalPanelFile, buildCraneCredentialPayload, PANEL_TRAVERSAL_VECTORS } from "../src/main/panelAssets";

let panelsDir = "";
let outsideFile = "";

beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-panelproto-"));
    panelsDir = path.join(tmp, "panels");
    fs.mkdirSync(path.join(panelsDir, "victim", "dist"), { recursive: true });
    fs.writeFileSync(
        path.join(panelsDir, "victim", "dist", "index.html"),
        "<html>victim</html>",
    );
    fs.writeFileSync(path.join(panelsDir, "victim", "dist", "app.js"), "console.log(1)");
    fs.writeFileSync(path.join(panelsDir, "victim", "loose.txt"), "loose");
    outsideFile = path.join(tmp, "outside.txt");
    fs.writeFileSync(outsideFile, "secret");
});

afterAll(() => {
    fs.rmSync(path.dirname(panelsDir), { recursive: true, force: true });
});

describe("resolveLocalPanelFile containment", () => {
    it("serves dist files with their real bytes", () => {
        const res = resolveLocalPanelFile(panelsDir, "victim", "index.html");
        expect(res.kind).toBe("ok");
        if (res.kind === "ok") {
            expect(fs.readFileSync(res.file, "utf8")).toContain("victim");
        }
    });

    it("prefers dist over loose files and serves loose files too", () => {
        const app = resolveLocalPanelFile(panelsDir, "victim", "app.js");
        expect(app.kind).toBe("ok");
        const loose = resolveLocalPanelFile(panelsDir, "victim", "loose.txt");
        expect(loose.kind).toBe("ok");
        if (loose.kind === "ok") {
            expect(fs.readFileSync(loose.file, "utf8")).toBe("loose");
        }
    });

    it("forbids traversal outside the panel directory", () => {
        for (const vector of PANEL_TRAVERSAL_VECTORS) {
            const evil = vector.replace(/SENTINEL/g, "outside.txt");
            const res = resolveLocalPanelFile(panelsDir, "victim", evil);
            expect(`${evil}=${res.kind}`).toBe(`${evil}=forbidden`);
        }
        // one panel-relative vector the shared list cannot spell
        const res = resolveLocalPanelFile(panelsDir, "victim", "../victim/../../outside.txt");
        expect(res.kind).toBe("forbidden");
        expect(fs.readFileSync(outsideFile, "utf8")).toBe("secret");
    });

    it("reads unknown panels and files as not-found, bad ids as invalid", () => {
        expect(resolveLocalPanelFile(panelsDir, "nosuchpanel", "index.html").kind).toBe("not-found");
        expect(resolveLocalPanelFile(panelsDir, "victim", "missing.js").kind).toBe("not-found");
        expect(resolveLocalPanelFile(panelsDir, "../victim", "index.html").kind).toBe("invalid");
        expect(resolveLocalPanelFile(panelsDir, "", "index.html").kind).toBe("invalid");
    });
});

describe("buildCraneCredentialPayload (iframe identity)", () => {
    it("prefers the panel-scoped token and travels with the panelId", () => {
        const parsed = JSON.parse(
            buildCraneCredentialPayload({ port: 1, token: "pc_master" }, "comp", "a", "pcp_a"),
        );
        expect(parsed.token).toBe("pcp_a");
        expect(parsed.scoped).toBe(true);
        expect(parsed.panelId).toBe("a");
        expect(parsed.computerId).toBe("comp");
        expect(parsed.port).toBe(1);
    });

    it("refuses bootstrap rather than injecting the master when issuance is unavailable", () => {
        const parsed = JSON.parse(
            buildCraneCredentialPayload({ port: 1, token: "pc_master" }, "comp", "a", ""),
        );
        expect(parsed).toBeNull();
    });

    it("reads missing handshakes as null", () => {
        expect(buildCraneCredentialPayload(null, "comp", "a", "pcp_a")).toBe("null");
    });
});

// remote panel CSP provenance: the egress facts must come from the Serving
// machine's manifest (carried in its Content-Security-Policy header), never
// from the local one. A missing header falls closed, not local.
import {
    remotePanelHtmlCsp,
    panelCspNonce,
} from "../src/main/panelAssets";

describe("remote panel CSP provenance", () => {
    it("adopts the serving daemon's CSP verbatim (plus the response nonce)", () => {
        const served =
            "default-src 'self'; script-src 'self'; connect-src https://api.modrinth.com";
        const nonce = panelCspNonce();
        const csp = remotePanelHtmlCsp(served, nonce);
        // egress facts survive untouched
        expect(csp).toContain("connect-src https://api.modrinth.com");
        // and carry the script nonce for this response
        expect(csp).toContain(`'nonce-${nonce}'`);
    });

    it("never consults the local manifest for a remote panel", () => {
        // a panel id that cannot exist locally: whatever the local
        // filesystem declares, the remote policy is the served one
        const remoteEgress =
            "default-src 'self'; script-src 'self'; connect-src https://remote-host.example";
        expect(remotePanelHtmlCsp(remoteEgress, panelCspNonce())).toContain("remote-host.example");
    });

    it("strips the daemon's frame-ancestors directive", () => {
        // the daemon adds frame-ancestors 'none' for its own HTTP surface;
        // in the shell the panel document IS an iframe — importing that
        // directive would block the embedding the shell performs
        const served =
            "default-src 'self'; script-src 'self'; frame-ancestors 'none'; connect-src https://remote-host.example";
        const nonce = panelCspNonce();
        const csp = remotePanelHtmlCsp(served, nonce);
        expect(csp).not.toContain("frame-ancestors");
        expect(csp).toContain("connect-src https://remote-host.example");
        expect(csp).toContain(`'nonce-${nonce}'`);
    });

    it("mints a fresh nonce per response and carries only that one", () => {
        const served = "default-src 'self'; script-src 'self'";
        const first = panelCspNonce();
        const second = panelCspNonce();
        expect(first).not.toBe(second);
        expect(remotePanelHtmlCsp(served, first)).toContain(`'nonce-${first}'`);
        expect(remotePanelHtmlCsp(served, first)).not.toContain(`'nonce-${second}'`);
    });

    it("falls closed when the peer sends no CSP (never to the local manifest)", () => {
        const csp = remotePanelHtmlCsp(null, panelCspNonce());
        expect(csp).not.toContain("https://");
        expect(csp).toContain("default-src 'self' panel: data: blob:");
    });
});
