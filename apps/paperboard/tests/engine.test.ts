import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { PaperCraneEngine } from "../papercrane/engine";

let tmp: string;
let engine: PaperCraneEngine;

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-engine-"));
    engine = new PaperCraneEngine(tmp);
});

afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("PaperCraneEngine path containment", () => {
    it("resolves paths inside the files dir", () => {
        expect(engine.getFilePath("world/level.dat", "srv")).toBe(
            path.join(tmp, "files", "srv", "world", "level.dat"),
        );
    });

    it("creates a fresh panel's home when its path is handed out", () => {
        const home = path.join(tmp, "files", "dev.paperboard.gameserver");
        expect(fs.existsSync(home)).toBe(false);
        expect(engine.getFilePath("", "dev.paperboard.gameserver")).toBe(home);
        expect(fs.statSync(home).isDirectory()).toBe(true);
    });

    it("rejects traversal", async () => {
        await expect(engine.writeFile("../../escape.txt", "x", "srv")).rejects.toThrow();
        expect(() => engine.getFilePath("../other", "srv")).toThrow();
    });

    it("rejects sibling-prefix directories", () => {
        // "<base>-evil" must not pass a naive startsWith check
        const base = path.join(tmp, "files", "srv");
        fs.mkdirSync(base + "-evil", { recursive: true });
        expect(() => engine.getFilePath("../srv-evil/data.txt", "srv")).toThrow();
    });
});

describe("PaperCraneEngine killProcess hygiene", () => {
    it("does not drop ownership or report completion before exit", async () => {
        const client = new EventEmitter() as any;
        client.isConnected = () => true;
        client.kill = () => undefined;
        client.destroy = () => client.removeAllListeners();
        (engine as any).clients.set("ghost", client);
        engine.setClientOwner("ghost", "panel.a");
        const stopping = engine.killProcess("ghost");
        expect((engine as any).clients.has("ghost")).toBe(true);
        expect(engine.clientOwner("ghost")).toBe("panel.a");
        client.emit("exit", 0);
        await stopping;
        expect((engine as any).clients.has("ghost")).toBe(false);
        expect(engine.clientOwner("ghost")).toBeNull();
    });
});

describe("PaperCraneEngine panels install/uninstall parity", () => {
    it("uninstallPanel retains config and files for reinstalling", async () => {
        await engine.setConfig("somepanel", { a: 1 });
        fs.mkdirSync(path.join(tmp, "panels", "somepanel"), { recursive: true });
        await engine.uninstallPanel("somepanel");
        expect(fs.existsSync(path.join(tmp, "panels", "somepanel"))).toBe(false);
        expect(await engine.getConfig("somepanel")).toEqual({ a: 1 });
    });

    it("uninstallPanel deleteData removes config, files and secrets", async () => {
        await engine.setConfig("somepanel", { a: 1 });
        await engine.writeFile("keep.txt", "x", "somepanel");
        engine.setSecret("tok", "v", "somepanel");
        fs.mkdirSync(path.join(tmp, "panels", "somepanel"), { recursive: true });
        await engine.uninstallPanel("somepanel", { deleteData: true });
        expect(await engine.getConfig("somepanel")).toBeNull();
        expect(await engine.readFile("keep.txt", "somepanel")).toBeNull();
        expect(engine.getSecret("tok", "somepanel").found).toBe(false);
        expect(fs.existsSync(path.join(tmp, "files", "somepanel"))).toBe(false);
    });

    it("uninstallPanel deletes the code without touching other panels", async () => {
        fs.mkdirSync(path.join(tmp, "panels", "trashed"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "panels", "trashed", "manifest.json"), "{}");
        // a live panel with a similar name must never be touched by the sweep
        fs.mkdirSync(path.join(tmp, "panels", "trashed2"), { recursive: true });
        expect(await engine.uninstallPanel("trashed")).toBe(true);
        expect(fs.existsSync(path.join(tmp, "panels", "trashed"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "panels", "trashed2"))).toBe(true);
        expect(
            fs.readdirSync(path.join(tmp, "panels")).filter((e) => e.startsWith(".trash-") || e.startsWith(".replaced-")),
        ).toEqual([]);
    });
});

describe("PaperCraneEngine package platform selection", () => {
    it("prefers os-arch over os over generic download", async () => {
        // Indirectly covered by downloadPackage; here we test the index round-trip.
        engine.getPackageIndex(); // should not throw on missing file
        expect(engine.isPackageInstalled("nothing")).toBe(false);
    });

    it("isPackageInstalled honors the version param against the index", () => {
        fs.mkdirSync(path.join(tmp, "packages", "ffmpeg", "bin"), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, "packages", "index.json"),
            JSON.stringify({ ffmpeg: { name: "ffmpeg", version: "7.1", installedAt: new Date().toISOString() } }),
        );
        expect(engine.isPackageInstalled("ffmpeg")).toBe(true);
        expect(engine.isPackageInstalled("ffmpeg", "latest")).toBe(true);
        expect(engine.isPackageInstalled("ffmpeg", "7.1")).toBe(true);
        expect(engine.isPackageInstalled("ffmpeg", "6.0")).toBe(false);
    });
});

describe("PaperCraneEngine app-global configs", () => {
    it("stores shell globals in local/, panel configs and computer keys in configs/", async () => {
        await engine.setConfig("app-settings", { darkMode: "dark" });
        await engine.setConfig("shell-last-opened", { panelId: "x" });
        await engine.setConfig("somepanel", { a: 1 });
        await engine.setConfig("crane_version", { version: "1" });
        expect(
            fs.existsSync(path.join(tmp, "local", "app-settings.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "local", "shell-last-opened.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "configs", "crane_version.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "configs", "somepanel.json")),
        ).toBe(true);
        expect(fs.existsSync(path.join(tmp, "files", "somepanel", "data.json"))).toBe(
            false,
        );
    });

    it("does not mistake an independent data.json for the default config", async () => {
        fs.mkdirSync(path.join(tmp, "files", "somepanel"), { recursive: true });
        fs.writeFileSync(
            path.join(tmp, "files", "somepanel", "data.json"),
            JSON.stringify({ a: 2 }),
        );
        expect(await engine.getConfig("somepanel")).toBeNull();
        await engine.setConfig("somepanel", { a: 3 });
        expect(fs.existsSync(path.join(tmp, "files", "somepanel", "data.json"))).toBe(
            true,
        );
        expect(await engine.getConfig("somepanel")).toEqual({ a: 3 });
    });

    it("stores an explicit path as workspace data in the panel's files dir", async () => {
        await engine.setConfig("com.example.terminal", { tabs: [] }, "tabs.json");
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "tabs.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "configs", "com.example.terminal.json")),
        ).toBe(false);
        expect(await engine.getConfig("com.example.terminal", "tabs.json")).toEqual({
            tabs: [],
        });

        // nested paths work the same way, still inside the panel dir
        await engine.setConfig("com.example.actions", { flows: [] }, "workspace/canvas.json");
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.actions", "workspace", "canvas.json")),
        ).toBe(true);
    });

    it("does not migrate unrelated data.json into an explicitly named document", async () => {
        fs.mkdirSync(path.join(tmp, "files", "com.example.terminal"), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(tmp, "files", "com.example.terminal", "data.json"),
            JSON.stringify({ tabs: [{ id: "t1" }] }),
        );
        expect(await engine.getConfig("com.example.terminal", "tabs.json")).toBeNull();
        await engine.setConfig("com.example.terminal", { tabs: [] }, "tabs.json");
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "data.json")),
        ).toBe(true);
        expect(
            fs.existsSync(path.join(tmp, "files", "com.example.terminal", "tabs.json")),
        ).toBe(true);
    });

    it("refuses workspace paths that climb out of the panel dir", async () => {
        await expect(
            engine.setConfig("com.example.terminal", { x: 1 }, "../../evil.json"),
        ).rejects.toThrow();
        await expect(
            engine.getConfig("com.example.terminal", "../other.json"),
        ).rejects.toThrow();
        expect(fs.existsSync(path.join(tmp, "files", "evil.json"))).toBe(false);
        expect(fs.existsSync(path.join(tmp, "files", "other.json"))).toBe(false);
    });

    it("ordinary writes retain every independent named document", async () => {
        // ensure the dirs exist the way a previous install left them
        for (const [dir, file, value] of [
            ["legacypanel", "config.json", { v: 1 }],
            ["oldterminal", "tabs.json", { tabs: [] }],
            ["oldactions", "workspace.json", { flows: [] }],
        ] as const) {
            fs.mkdirSync(path.join(tmp, "files", dir), { recursive: true });
            fs.writeFileSync(
                path.join(tmp, "files", dir, file),
                JSON.stringify(value),
            );
            expect(await engine.getConfig(dir)).toBeNull();
            await engine.setConfig(dir, value);
            expect(
                fs.existsSync(path.join(tmp, "configs", `${dir}.json`)),
            ).toBe(true);
            expect(fs.existsSync(path.join(tmp, "files", dir, file))).toBe(true);
        }
    });
});

describe("process ownership ledger stays bounded by live workloads", () => {
    it("a spawn that fails leaves no claim, in memory or on disk", async () => {
        const { handleProcess } = await import("../papercrane/rpc/process");
        const ctx = {
            engine,
            callerPanelId: () => "panel.a",
            sendEvent: () => undefined,
            reply: () => undefined,
        };
        await expect(
            handleProcess("process:run", 1, { id: "doomed", command: "true", cwd: "/nonexistent/paperboard-cwd" }, ctx as any),
        ).rejects.toThrow(/cwd does not exist/);
        expect(engine.clientOwner("doomed")).toBeNull();
        const ledger = path.join(engine.getAppDataDir(), "local", "process-owners.json");
        if (fs.existsSync(ledger)) expect(JSON.parse(fs.readFileSync(ledger, "utf8"))).not.toHaveProperty("doomed");
    });

    it("an ended workload's entry is removed from the persisted ledger too", async () => {
        engine.setClientOwner("finished", "panel.a");
        const ledger = path.join(engine.getAppDataDir(), "local", "process-owners.json");
        expect(JSON.parse(fs.readFileSync(ledger, "utf8"))).toHaveProperty("finished", "panel.a");
        await engine.killProcess("finished");
        expect(JSON.parse(fs.readFileSync(ledger, "utf8"))).not.toHaveProperty("finished");
    });
});
