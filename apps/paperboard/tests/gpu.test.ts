// GPU inventory (system:gpus): probe parsers against captured tool output,
// a fixture sysfs tree, and the RPC over an authenticated panel socket.
import { describe, it, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import {
    detectGpus,
    lookupPciName,
    mergeWindowsRegistry,
    parseNvidiaSmi,
    parseRegQuery,
    parseSystemProfiler,
    probeSysfs,
    type ExecFn,
} from "../papercrane/gpu";
import { PaperCraneAuth } from "../papercrane/auth";
import { PaperCraneEngine } from "../papercrane/engine";
import { setupWebSocketServer } from "../papercrane/ws";
import { handleHttpRequest } from "../papercrane/http";
import { DavSessionStore } from "../papercrane/dav";
import { initPaperApi, closeTransport } from "../../../packages/paperapi/src/ipc";
import { systemApi } from "../../../packages/paperapi/src/system";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GiB = 1024 ** 3;
const missing: ExecFn = async () => {
    throw Object.assign(new Error("not found"), { code: "ENOENT" });
};

const PCI_IDS = [
    "# comment",
    "1002  Advanced Micro Devices, Inc. [AMD/ATI]",
    "\t164e  Raphael",
    "\t747e  Navi 32 [Radeon RX 7700 XT / 7800 XT]",
    "\t\t1002 0e3b  subsystem line",
    "10de  NVIDIA Corporation",
    "\t2684  AD102 [GeForce RTX 4090]",
].join("\n");

function sysfsCard(root: string, card: string, files: Record<string, string>, driver?: string): void {
    const dev = path.join(root, "class", "drm", card, "device");
    fs.mkdirSync(dev, { recursive: true });
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dev, name), `${value}\n`);
    if (driver) {
        const target = path.join(root, "bus", "pci", "drivers", driver);
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(dev, "driver"));
    }
}

describe("probe parsers", () => {
    it("nvidia-smi csv → MiB converted to bytes", () => {
        const gpus = parseNvidiaSmi("NVIDIA GeForce RTX 4090, 24564, 23000, 560.35.03\n");
        expect(gpus).toEqual([
            { name: "NVIDIA GeForce RTX 4090", vendor: "nvidia", memoryTotalBytes: 24564 * 1024 ** 2, memoryFreeBytes: 23000 * 1024 ** 2, driver: "560.35.03", source: "nvidia-smi" },
        ]);
    });

    it("pci.ids lookup prefers the bracketed marketing name and stops at the next vendor", () => {
        expect(lookupPciName(PCI_IDS, "0x1002", "0x747e")).toBe("Radeon RX 7700 XT / 7800 XT");
        expect(lookupPciName(PCI_IDS, "0x1002", "0x164e")).toBe("Raphael");
        expect(lookupPciName(PCI_IDS, "0x1002", "0x2684")).toBeNull();
    });

    it("system_profiler: Apple Silicon reports unified system memory", () => {
        const json = JSON.stringify({
            SPDisplaysDataType: [{ sppci_model: "Apple M2 Pro", spdisplays_vendor: "sppci_vendor_Apple" }],
        });
        expect(parseSystemProfiler(json, 32 * GiB)).toEqual([
            { name: "Apple M2 Pro", vendor: "apple", memoryTotalBytes: 32 * GiB, unifiedMemory: true, source: "system_profiler" },
        ]);
    });

    it("system_profiler: discrete Intel-mac GPUs report their VRAM", () => {
        const json = JSON.stringify({
            SPDisplaysDataType: [{ sppci_model: "AMD Radeon Pro 5500M", spdisplays_vendor: "sppci_vendor_AMD", spdisplays_vram: "8 GB" }],
        });
        expect(parseSystemProfiler(json, 16 * GiB)[0]).toMatchObject({ vendor: "amd", memoryTotalBytes: 8 * GiB });
    });

    it("Windows registry: 64-bit qwMemorySize beats the 4 GiB WMI cap; software adapters skipped", () => {
        const key = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
        const names = parseRegQuery(`\r\n${key}\\0000\r\n    DriverDesc    REG_SZ    AMD Radeon RX 7800 XT\r\n\r\n${key}\\0001\r\n    DriverDesc    REG_SZ    Microsoft Basic Display Adapter\r\n`);
        const memory = parseRegQuery(`\r\n${key}\\0000\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x400000000\r\n`);
        expect(mergeWindowsRegistry(names, memory)).toEqual([
            { name: "AMD Radeon RX 7800 XT", vendor: "amd", memoryTotalBytes: 16 * GiB, source: "registry" },
        ]);
    });
});

describe("sysfs probe", () => {
    it("reads amdgpu VRAM counters and names cards from pci.ids", () => {
        const root = path.join(tmp, "sys-amd");
        sysfsCard(root, "card0", { vendor: "0x1002", device: "0x164e", mem_info_vram_total: String(512 * 1024 ** 2), mem_info_vram_used: String(24 * 1024 ** 2) }, "amdgpu");
        sysfsCard(root, "card1", { vendor: "0x1002", device: "0x747e", mem_info_vram_total: String(16 * GiB), mem_info_vram_used: String(1 * GiB) }, "amdgpu");
        // connector entries (card1-DP-1) are not devices
        fs.mkdirSync(path.join(root, "class", "drm", "card1-DP-1"), { recursive: true });
        const ids = path.join(tmp, "pci.ids");
        fs.writeFileSync(ids, PCI_IDS);
        const errors: string[] = [];
        const gpus = probeSysfs(root, [ids], errors);
        expect(errors).toEqual([]);
        expect(gpus.map((g) => g.name)).toEqual(["Raphael", "Radeon RX 7700 XT / 7800 XT"]);
        expect(gpus[1]).toEqual({ name: "Radeon RX 7700 XT / 7800 XT", vendor: "amd", memoryTotalBytes: 16 * GiB, memoryFreeBytes: 15 * GiB, driver: "amdgpu", source: "sysfs" });
    });

    it("a card without VRAM counters reports no memory rather than zero", () => {
        const root = path.join(tmp, "sys-intel");
        sysfsCard(root, "card0", { vendor: "0x8086", device: "0x9a49" });
        const [gpu] = probeSysfs(root, [], []);
        expect(gpu).toEqual({ name: "GPU 8086:9a49", vendor: "intel", source: "sysfs" });
        expect("memoryTotalBytes" in gpu!).toBe(false);
    });

    it("no DRM class at all is an empty inventory, not an error", () => {
        const errors: string[] = [];
        expect(probeSysfs(path.join(tmp, "nowhere"), [], errors)).toEqual([]);
        expect(errors).toEqual([]);
    });
});

describe("detectGpus", () => {
    it("Linux: nvidia-smi cards replace their sysfs duplicates", async () => {
        const root = path.join(tmp, "sys-mixed");
        sysfsCard(root, "card0", { vendor: "0x10de", device: "0x2684" });
        sysfsCard(root, "card1", { vendor: "0x8086", device: "0x9a49" });
        const exec: ExecFn = async (command) => {
            if (command === "nvidia-smi") return "NVIDIA GeForce RTX 4090, 24564, 23000, 560.35.03\n";
            throw new Error(`unexpected ${command}`);
        };
        const report = await detectGpus({ platform: "linux", exec, sysfsRoot: root, pciIdsPaths: [] });
        expect(report.errors).toEqual([]);
        expect(report.gpus.map((g) => [g.vendor, g.source])).toEqual([
            ["nvidia", "nvidia-smi"],
            ["intel", "sysfs"],
        ]);
    });

    it("a failing probe is reported, so callers can tell unavailable from empty", async () => {
        const exec: ExecFn = async () => {
            throw new Error("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver");
        };
        const report = await detectGpus({ platform: "linux", exec, sysfsRoot: path.join(tmp, "nowhere"), pciIdsPaths: [] });
        expect(report.gpus).toEqual([]);
        expect(report.errors[0]).toMatch(/^nvidia-smi: .*driver/);
    });

    it("macOS: a missing system_profiler is an error, never an empty machine", async () => {
        const report = await detectGpus({ platform: "darwin", exec: missing });
        expect(report.gpus).toEqual([]);
        expect(report.errors).toHaveLength(1);
    });

    it("Windows: registry names and memory merge by adapter key", async () => {
        const key = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000";
        const exec: ExecFn = async (command, args) => {
            if (command === "nvidia-smi") throw Object.assign(new Error("nope"), { code: "ENOENT" });
            if (args.includes("DriverDesc")) return `${key}\r\n    DriverDesc    REG_SZ    Intel(R) Arc(TM) A770 Graphics\r\n`;
            return `${key}\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x400000000\r\n`;
        };
        const report = await detectGpus({ platform: "win32", exec });
        expect(report).toEqual({ gpus: [{ name: "Intel(R) Arc(TM) A770 Graphics", vendor: "intel", memoryTotalBytes: 16 * GiB, source: "registry" }], errors: [] });
    });
});

describe("system:gpus over the wire", () => {
    it("systemApi.getGpus() on a panel token gets the report from the real daemon", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-wire-"));
        const engine = new PaperCraneEngine(root);
        const auth = new PaperCraneAuth(false, path.join(root, "local"));
        auth.injectToken("test-host", "host");
        const sessions = new DavSessionStore();
        const server = http.createServer((req, res) => handleHttpRequest(engine, req, res, { auth, sessions }));
        const wss = new WebSocketServer({ server });
        setupWebSocketServer(wss, engine, auth, { remotesFile: path.join(root, "remotes.json") });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as { port: number }).port;
        const token = auth.issuePanelToken("dev.paperboard.ai");
        try {
            await initPaperApi({ port, token });
            const report = await systemApi.getGpus();
            expect(Array.isArray(report.gpus)).toBe(true);
            expect(Array.isArray(report.errors)).toBe(true);
            for (const gpu of report.gpus) {
                expect(typeof gpu.name).toBe("string");
                expect(typeof gpu.source).toBe("string");
            }
        } finally {
            closeTransport("local");
            for (const socket of wss.clients) socket.terminate();
            wss.close();
            await new Promise<void>((resolve) => server.close(() => resolve()));
            auth.dispose();
            sessions.revokeAll();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
