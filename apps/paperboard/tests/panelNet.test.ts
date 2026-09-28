// per-panel CSP egress allowlist (bun test): declared hosts in, everything else out
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildPanelCsp, parseNetworkEgress, panelCspForEgress } from "../papercrane/panelNet";

let tmp = "";
let savedDir: string | undefined;

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "panel-net-"));
    fs.mkdirSync(path.join(tmp, "panels", "dev.allow"), { recursive: true });
    fs.writeFileSync(
        path.join(tmp, "panels", "dev.allow", "manifest.json"),
        JSON.stringify({ id: "dev.allow", name: "T", network: { hosts: ["api.example.com", "extra.example.com"] } }),
    );
    savedDir = process.env.PAPERBOARD_DIR;
    process.env.PAPERBOARD_DIR = tmp;
});

afterAll(() => {
    if (savedDir === undefined) delete process.env.PAPERBOARD_DIR;
    else process.env.PAPERBOARD_DIR = savedDir;
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("parseNetworkEgress", () => {
    it("closed by default for panels with no network block", () => {
        expect(parseNetworkEgress({ id: "x" })).toEqual({ mode: "closed", hosts: [] });
        expect(parseNetworkEgress(undefined)).toEqual({ mode: "closed", hosts: [] });
    });

    it("declared hosts accepted, invalid entries dropped and the rest kept", () => {
        const egress = parseNetworkEgress({
            network: { hosts: ["api.ok.com", -1, "bad host with spaces", "drop.com"] },
        });
        expect(egress.mode).toBe("declared-hosts");
        expect(egress.hosts).toEqual(["api.ok.com", "drop.com"]);
    });

    it("any-https is an explicit opt-in mode, not a default", () => {
        expect(parseNetworkEgress({ network: { mode: "any-https" } }).mode).toBe("any-https");
    });

    it("host list is bounded", () => {
        const egress = parseNetworkEgress({ network: { hosts: Array.from({ length: 50 }, (_, i) => `h${i}.com`) } });
        expect(egress.hosts).toHaveLength(32);
    });
});

const connectSrc = (csp: string): string =>
    csp.split(";").find((d) => d.trim().startsWith("connect-src"))!;
const imgSrc = (csp: string): string =>
    csp.split(";").find((d) => d.trim().startsWith("img-src"))!;

describe("panelCspForEgress", () => {
    it("default CSP faces only loopback and self", () => {
        const csp = panelCspForEgress({ mode: "closed", hosts: [] });
        expect(connectSrc(csp)).not.toContain("https:");
        expect(connectSrc(csp)).toMatch(/connect-src 'self' panel: ws:\/\/127\.0\.0\.1:\*/);
    });

    it("declared hosts appear as scheme-pinned shapes, everything else stays out", () => {
        const csp = panelCspForEgress({ mode: "declared-hosts", hosts: ["api.modrinth.com"] });
        expect(connectSrc(csp)).toContain("https://api.modrinth.com");
        expect(connectSrc(csp)).not.toContain(" https: ");
        expect(connectSrc(csp).endsWith(" https:")).toBe(false);
    });

    it("declared hosts are usable image sources (avatars/thumbs), closed only closed", () => {
        const csp = panelCspForEgress({ mode: "declared-hosts", hosts: ["api.modrinth.com"] });
        expect(imgSrc(csp)).toContain("https://api.modrinth.com");
        expect(imgSrc(csp).split(" ")).not.toContain("https:");
        // a host that is not declared stays out of img-src
        const other = panelCspForEgress({ mode: "declared-hosts", hosts: ["api.example.com"] });
        expect(imgSrc(other)).not.toContain("modrinth.com");
    });

    it("any-https grants the whole scheme for both fetch and images", () => {
        expect(connectSrc(panelCspForEgress({ mode: "any-https", hosts: [] }))).toContain("https:");
        expect(imgSrc(panelCspForEgress({ mode: "any-https", hosts: [] }))).toContain("https:");
    });

    it("portless unknown host never sneaks in via a declared host substring", () => {
        const csp = panelCspForEgress({ mode: "declared-hosts", hosts: ["evil-modrinth.com"] });
        expect(csp).toContain("https://evil-modrinth.com");
        expect(csp).not.toContain("https://api.modrinth.com");
    });

    it("closed mode is genuinely closed: no remote images either — holy closed!", () => {
        const csp = panelCspForEgress({ mode: "closed", hosts: [] });
        // local sources only: self, sibling panel origins (panel: in
        // Electron, loopback *.paperboard.localhost in browser mode), inline
        expect(imgSrc(csp).trim()).toBe(
            "img-src 'self' panel: http://*.paperboard.localhost:* data: blob:",
        );
        expect(imgSrc(csp)).not.toContain("https");
        expect(csp).toContain("script-src 'self'");
        expect(csp).not.toContain("'unsafe-eval'");
    });
});

describe("buildPanelCsp", () => {
    it("grants exactly the hosts the manifest declares", () => {
        const csp = buildPanelCsp("dev.allow");
        expect(connectSrc(csp)).toContain("https://api.example.com");
        expect(connectSrc(csp)).toContain("https://extra.example.com");
        expect(connectSrc(csp)).not.toContain(" https: ");
        expect(connectSrc(csp).endsWith(" https:")).toBe(false);
    });

    it("unknown panel or missing manifest is closed", () => {
        expect(buildPanelCsp("dev.nonexistent")).toContain("connect-src 'self' panel: ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*;");
        expect(buildPanelCsp(undefined)).not.toContain("https://");
    });

    it("corrupt manifest falls back closed", () => {
        fs.mkdirSync(path.join(tmp, "panels", "dev.corrupt"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "panels", "dev.corrupt", "manifest.json"), "{bad json");
        expect(buildPanelCsp("dev.corrupt")).not.toContain("https://");
    });
});
