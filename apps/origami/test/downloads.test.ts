import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "../src/index";
import { createRegistry, type Registry } from "./helpers/cloudflare";

const RELEASES = "https://github.com/MileniumHQ/Paperboard/releases/download";
let registry: Registry;

beforeEach(() => {
    registry = createRegistry();
    registry.kv.setJson("dl/pb", {
        latest: "0.3.1",
        versions: {
            "0.3.0": { files: [{ file: "paperboard-linux-x64.AppImage" }] },
            "0.3.1": { files: [{ file: "paperboard-linux-x64.AppImage" }, { file: "paperboard-windows-x64-setup.exe" }] },
        },
    });
    registry.kv.setJson("dl/crane", {
        latest: "0.3.1",
        versions: {
            "0.3.0": { files: [{ file: "crane-linux-x64.tar.gz" }] },
            "0.3.1": { files: [{ file: "crane-linux-x64.tar.gz" }, { file: "crane-windows-x64.zip" }] },
        },
    });
});

function get(url: string, init: RequestInit = {}): Promise<Response> {
    return worker.fetch(new Request(url, { redirect: "manual", ...init }), registry.env, {} as ExecutionContext);
}

async function expectRedirect(url: string, location: string, cache: "immutable" | "no-cache"): Promise<void> {
    const res = await get(url);
    expect({ url, status: res.status, location: res.headers.get("location") }).toEqual({ url, status: 302, location });
    if (cache === "no-cache") expect(res.headers.get("cache-control")).toBe("no-cache");
    else expect(res.headers.get("cache-control")).toContain("immutable");
}

// Downloads redirect only to recorded release assets.
describe("downloads redirect only to recorded release assets", () => {
    test("recorded files redirect to their v<version> release asset, older versions included", async () => {
        for (const host of ["https://i.paperboard.dev", "https://origami.ariapis.com/paperdl"]) {
            await expectRedirect(`${host}/pb/0.3.1/paperboard-windows-x64-setup.exe`, `${RELEASES}/v0.3.1/paperboard-windows-x64-setup.exe`, "immutable");
            await expectRedirect(`${host}/pb/0.3.0/paperboard-linux-x64.AppImage`, `${RELEASES}/v0.3.0/paperboard-linux-x64.AppImage`, "immutable");
            await expectRedirect(`${host}/crane/0.3.0/crane-linux-x64.tar.gz`, `${RELEASES}/v0.3.0/crane-linux-x64.tar.gz`, "immutable");
            await expectRedirect(`${host}/pb/latest/paperboard-windows-x64-setup.exe`, `${RELEASES}/v0.3.1/paperboard-windows-x64-setup.exe`, "no-cache");
            await expectRedirect(`${host}/crane/latest/crane-windows-x64.zip`, `${RELEASES}/v0.3.1/crane-windows-x64.zip`, "no-cache");
        }
    });

    test("unknown versions and files, extra segments, traversal, wrong hosts and other methods answer 404", async () => {
        const notFound: [string, RequestInit?][] = [
            ["https://i.paperboard.dev/pb/9.9.9/paperboard-linux-x64.AppImage"],
            // a file that exists, but not in that version
            ["https://i.paperboard.dev/pb/0.3.0/paperboard-windows-x64-setup.exe"],
            ["https://i.paperboard.dev/pb/latest/paperboard-linux-riscv64.AppImage"],
            ["https://i.paperboard.dev/crane/latest/paperboard-linux-x64.AppImage"],
            ["https://i.paperboard.dev/pb/0.3.1/paperboard-windows-x64-setup.exe/extra"],
            ["https://i.paperboard.dev/pb/0.3.1/sub/paperboard-windows-x64-setup.exe"],
            ["https://i.paperboard.dev/pb/%2e%2e/paperboard-windows-x64-setup.exe"],
            ["https://i.paperboard.dev/pb/0.3.1/%2e%2e%2fpaperboard-windows-x64-setup.exe"],
            ["https://i.paperboard.dev/pb/0.3.1%2f..%2f0.3.0/paperboard-linux-x64.AppImage"],
            ["https://i.paperboard.dev/java/latest/java.tar.gz"],
            ["https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe", { method: "POST" }],
            ["https://i.paperboard.dev/pb/latest/paperboard-windows-x64-setup.exe", { method: "HEAD" }],
            ["https://origami.ariapis.com/paperdl/pb/latest/paperboard-windows-x64-setup.exe", { method: "POST" }],
            ["https://origami.ariapis.com/paperdl/pb/0.3.1/paperboard-windows-x64-setup.exe/extra"],
            ["https://origami.ariapis.com/paperdl/pb/9.9.9/paperboard-linux-x64.AppImage"],
            // the download host serves downloads and nothing else
            ["https://i.paperboard.dev/panels/index.json"],
            ["https://i.paperboard.dev/package/index.json"],
            ["https://i.paperboard.dev/health"],
            ["https://i.paperboard.dev/paperdl/pb/latest/paperboard-windows-x64-setup.exe"],
            // and the registry host has no short download routes
            ["https://origami.ariapis.com/pb/latest/paperboard-windows-x64-setup.exe"],
        ];
        for (const [url, init] of notFound) {
            const res = await get(url, init);
            expect({ url, method: init?.method ?? "GET", status: res.status }).toEqual({ url, method: init?.method ?? "GET", status: 404 });
            expect(res.headers.get("location")).toBeNull();
        }
    });

    test("legacy per-target links redirect to the canonical latest file, and unknown targets answer 404", async () => {
        const legacy: [string, string][] = [
            ["/paperdl/paperboard/linux-x64/download", "pb/latest/paperboard-linux-x64.AppImage"],
            ["/paperdl/paperboard/linux-arm64/download", "pb/latest/paperboard-linux-arm64.AppImage"],
            ["/paperdl/paperboard/macos-arm64/download", "pb/latest/paperboard-macos-arm64.zip"],
            ["/paperdl/paperboard/windows-x64/download", "pb/latest/paperboard-windows-x64-setup.exe"],
            ["/paperdl/crane/linux-x64/download", "crane/latest/crane-linux-x64.tar.gz"],
            ["/paperdl/crane/macos-arm64/download", "crane/latest/crane-macos-arm64.tar.gz"],
            ["/paperdl/crane/windows-x64/download", "crane/latest/crane-windows-x64.zip"],
        ];
        for (const [path, target] of legacy) {
            await expectRedirect(`https://origami.ariapis.com${path}`, `https://i.paperboard.dev/${target}`, "no-cache");
        }
        for (const path of ["/paperdl/paperboard/linux-riscv64/download", "/paperdl/crane/windows-arm64/download", "/paperdl/paperboard/x/download"]) {
            const res = await get(`https://origami.ariapis.com${path}`);
            expect({ path, status: res.status }).toEqual({ path, status: 404 });
        }
    });
});

// Update feeds and the crane index are served where updaters ask.
describe("update feeds and the crane index are served where updaters ask", () => {
    const FEEDS = ["latest.yml", "latest-mac.yml", "latest-linux.yml", "latest-linux-arm64.yml"];

    test("every feed is served from R2 on the download host, /paperdl/pb/ and legacy /paperdl/paperboard/", async () => {
        for (const feed of FEEDS) await registry.paperdl.put(`pb/${feed}`, `version: 0.3.1\npath: ${feed}\n`);
        for (const feed of FEEDS) {
            for (const url of [
                `https://i.paperboard.dev/pb/${feed}`,
                `https://origami.ariapis.com/paperdl/pb/${feed}`,
                `https://origami.ariapis.com/paperdl/paperboard/${feed}`,
            ]) {
                const res = await get(url);
                expect({ url, status: res.status }).toEqual({ url, status: 200 });
                expect(res.headers.get("content-type")).toBe("text/yaml; charset=utf-8");
                expect(res.headers.get("cache-control")).toBe("no-cache");
                expect(await res.text()).toBe(`version: 0.3.1\npath: ${feed}\n`);
            }
        }
    });

    test("a missing feed answers 404, never an empty body", async () => {
        for (const url of [
            "https://i.paperboard.dev/pb/latest-linux-arm64.yml",
            "https://origami.ariapis.com/paperdl/pb/latest-linux-arm64.yml",
            "https://origami.ariapis.com/paperdl/paperboard/latest-linux-arm64.yml",
        ]) {
            const res = await get(url);
            expect({ url, status: res.status }).toEqual({ url, status: 404 });
            expect(await res.text()).not.toBe("");
        }
    });

    test("the crane index is served at /paperdl/crane/index.json", async () => {
        const index = { "0.3.1": { "linux-x64": { sha256: "a".repeat(64) } } };
        await registry.paperdl.put("crane/index.json", JSON.stringify(index));
        const res = await get("https://origami.ariapis.com/paperdl/crane/index.json");
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-cache");
        expect(JSON.parse(await res.text())).toEqual(index);
    });
});

// curl -fsSL https://i.paperboard.dev | sh, and irm https://i.paperboard.dev | iex
describe("the base of the download host installs Paperboard", () => {
    const sh = readFileSync(join(import.meta.dir, "../../../packages/crane-launcher/install/install.sh"), "utf8");
    const ps1 = readFileSync(join(import.meta.dir, "../../../packages/crane-launcher/install/install.ps1"), "utf8");

    test("curl gets install.sh and PowerShell gets install.ps1, byte for byte the files npx runs", async () => {
        const curl = await get("https://i.paperboard.dev/", { headers: { "user-agent": "curl/8.10.1", accept: "*/*" } });
        expect(curl.status).toBe(200);
        expect(curl.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(await curl.text()).toBe(sh);
        const pwsh = await get("https://i.paperboard.dev/", {
            headers: { "user-agent": "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.26100.1", accept: "*/*" },
        });
        expect(await pwsh.text()).toBe(ps1);
        expect(await (await get("https://i.paperboard.dev/install.sh")).text()).toBe(sh);
        expect(await (await get("https://i.paperboard.dev/install.ps1")).text()).toBe(ps1);
    });

    test("a browser is sent to the downloads page, and the registry host serves no scripts", async () => {
        const browser = await get("https://i.paperboard.dev/", { headers: { accept: "text/html,application/xhtml+xml" } });
        expect(browser.status).toBe(302);
        expect(browser.headers.get("location")).toBe("https://paperboard.dev/downloads/");
        expect((await get("https://origami.ariapis.com/install.sh")).status).toBe(404);
    });

    test("the scripts' checksums are served from R2, and their absence is a 404", async () => {
        expect((await get("https://i.paperboard.dev/pb/SHA256SUMS")).status).toBe(404);
        const sums = `${"a".repeat(64)}  paperboard-linux-x64.AppImage\n`;
        await registry.paperdl.put("pb/SHA256SUMS", sums);
        const res = await get("https://i.paperboard.dev/pb/SHA256SUMS");
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-cache");
        expect(await res.text()).toBe(sums);
    });
});
