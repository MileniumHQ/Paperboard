import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { fakeJavaBinary } from "./helpers/fakeJava";
import { loopbackServer, type LoopbackServer } from "./helpers/http";
import { readTree, tempDir } from "./helpers/tmp";
import { files, processApi } from "../src/service/api";
import { PANEL_ID } from "../src/servers";
import { installServerSoftware, withInstallLock, type InstallDeps } from "../src/games/minecraft/softwareInstall";
import { neoforgeProvider } from "../src/games/minecraft/providers/neoforge";
import { InstallerStillRunningError, runInstallerProcess, type InstallerRun } from "../src/service/installerProcess";
import { startServerInstance } from "../src/service/lifecycle";
import { INSTALL_RECORD_KEY } from "../src/software/installRecord";
import { CALLS } from "../src/service/contract";
import { installFakeJava } from "./helpers/fakeJava";
import { createRoot } from "solid-js";

const INSTALLER = "fake neoforge installer jar";
let daemon: TestDaemon;
let maven: LoopbackServer;
beforeAll(async () => {
    daemon = await startTestDaemon();
    maven = loopbackServer(() => new Response(INSTALLER));
});
afterAll(async () => {
    await daemon?.stop();
});

const USER = { "world/level.dat": "level", "server.properties": "motd=mine\n", "plugins/x.jar": "plugin", "eula.txt": "eula=true\n" };

/** a Paper server whose install deps are the real daemon, a loopback Maven and the stand-in installer */
function paperServer(installerPlan: Record<string, unknown>, overrides: Partial<InstallDeps> = {}) {
    const mc = minecraftServer({ software: "paper", files: { ...USER, "server.jar": "paper" } });
    const javaHome = tempDir("gameserver-javahome-");
    fs.writeFileSync(path.join(javaHome, "installer.json"), JSON.stringify(installerPlan));
    const runs: InstallerRun[] = [];
    const deps: InstallDeps = {
        serverDir: () => files.getPath("", PANEL_ID),
        download: (opts) => files.download({ ...opts, appId: PANEL_ID }),
        javaBinary: async () => ({ bin: fakeJavaBinary(), home: javaHome }),
        runInstaller: (run) => {
            runs.push(run);
            return runInstallerProcess(run);
        },
        readConfig: async () => mc.scope.server.settings,
        writeConfig: async (patch) => {
            await mc.scope.saveSettings({ ...mc.scope.server.settings, ...patch });
        },
        provider: () => ({
            ...neoforgeProvider,
            resolveBuild: async () => ({
                build: "21.1.256",
                artifact: { url: `${maven.url}/neoforge-21.1.256-installer.jar`, sha256: createHash("sha256").update(INSTALLER).digest("hex") },
            }),
        }),
        ...overrides,
    };
    const install = () => mc.run(() => installServerSoftware(mc.scope.ctx, "neoforge", "1.21.1", deps));
    return { mc, deps, runs, install };
}

const stagingLeft = (mc: McServer) => fs.readdirSync(mc.dir).filter((e) => e.startsWith(".install-"));

// Installs are staged, locked and never cut short.
describe("software installs", () => {
    test("the installer runs into staging, and the NeoForge layout it writes is activated and recorded", async () => {
        const { mc, runs, install } = paperServer({ mode: "ok" });
        const outcome = await install();
        expect(outcome).toEqual({ software: "neoforge", version: "1.21.1", build: "21.1.256" });
        // never the live folder
        const outDir = runs[0]!.args[runs[0]!.args.indexOf("--installServer") + 1]!;
        expect(path.relative(mc.dir, outDir)).toMatch(/^\.install-[A-Za-z0-9-]+[\\/]server$/);

        const tree = readTree(mc.dir);
        for (const [file, content] of Object.entries(USER)) expect(tree[file]).toBe(content);
        expect(tree["server.jar"]).toBeUndefined();
        expect(tree["libraries/net/neoforged/neoforge/21.1.256/unix_args.txt"]).toBeDefined();
        expect(stagingLeft(mc)).toEqual([]);
        const record = mc.scope.server.settings[INSTALL_RECORD_KEY] as Record<string, unknown>;
        expect(record).toMatchObject({
            software: "neoforge",
            version: "1.21.1",
            build: "21.1.256",
            launch: {
                type: "argfile",
                unix: "libraries/net/neoforged/neoforge/21.1.256/unix_args.txt",
                windows: "libraries/net/neoforged/neoforge/21.1.256/win_args.txt",
            },
            files: ["libraries", "run.bat", "run.sh", "user_jvm_args.txt"],
        });
        expect(mc.scope.server.settings.software).toBe("neoforge");
    });

    test("an installer that exits non-zero fails with its output and leaves the old server as it was", async () => {
        const { mc, install } = paperServer({ mode: "fail" });
        const before = readTree(mc.dir);
        await expect(install()).rejects.toThrow(/installer failed \(exit code 1\):[\s\S]*There was an error during installation/);
        expect(readTree(mc.dir)).toEqual(before);
        expect(mc.scope.server.settings[INSTALL_RECORD_KEY]).toBeUndefined();
    });

    test("an installer that exits 0 but leaves nothing launchable fails and leaves the old server as it was", async () => {
        const { mc, install } = paperServer({ mode: "empty" });
        const before = readTree(mc.dir);
        await expect(install()).rejects.toThrow("reported success but left no server to launch");
        expect(readTree(mc.dir)).toEqual(before);
    });

    test("a record that cannot be written puts the old server back", async () => {
        const { mc, install } = paperServer({ mode: "ok" }, {
            writeConfig: async () => {
                throw new Error("config store is read-only");
            },
        });
        const before = readTree(mc.dir);
        await expect(install()).rejects.toThrow("Could not record the new install, so the previous server was restored: config store is read-only");
        expect(readTree(mc.dir)).toEqual(before);
    });

    test("one install at a time, and the server cannot start while an install holds the folder", async () => {
        const { mc, install } = paperServer({ mode: "ok" });
        let release!: () => void;
        const holding = mc.run(() => withInstallLock(() => new Promise<void>((resolve) => (release = resolve))));
        await expect(install()).rejects.toThrow("A server install is already running");
        // a refused Minecraft start says why in the console
        await mc.run(() => startServerInstance(mc.scope.ctx));
        expect(mc.scope.ctx.state.serverStatus).toBe("offline");
        expect(mc.scope.ctx.state.serverEntries.at(-1)).toEqual({
            type: "error",
            content: "[Server] Failed to launch: A server install is running; start the server once it finishes.",
        });
        expect(await mc.run(() => processApi.exists("mc-server"))).toBe(false);
        release();
        await holding;
        expect((await install()).build).toBe("21.1.256");
    });

    test("an installer that ignores SIGTERM is killed and the install fails saying it was stopped", async () => {
        const javaHome = tempDir("gameserver-javahome-");
        fs.writeFileSync(path.join(javaHome, "installer.json"), JSON.stringify({ mode: "hang" }));
        const out = tempDir();
        const lines: string[] = [];
        const mc = minecraftServer();
        await expect(
            mc.run(() =>
                runInstallerProcess({
                    command: fakeJavaBinary(),
                    args: ["-jar", "installer.jar", "--installServer", out],
                    cwd: out,
                    env: { JAVA_HOME: javaHome },
                    timeoutMs: 1_000,
                    exitGraceMs: 1_000,
                    onLine: (line) => lines.push(line),
                }),
            ),
        ).rejects.toThrow("did not finish within");
        expect(lines).toContain("ignoring SIGTERM");
        expect(await mc.run(() => processApi.exists("mc-installer"))).toBe(false);
    });

    test("an installer that cannot be confirmed stopped fails distinctly and keeps its staging", async () => {
        const { mc, install } = paperServer({ mode: "ok" }, {
            runInstaller: async () => {
                throw new InstallerStillRunningError("The installer did not finish in time and did not exit when stopped");
            },
        });
        await expect(install()).rejects.toBeInstanceOf(InstallerStillRunningError);
        expect(stagingLeft(mc)).toHaveLength(1);
        expect(fs.readFileSync(path.join(mc.dir, "server.jar"), "utf8")).toBe("paper");
    });

    test("the UI waits out install and modpack calls instead of cutting them off at the bridge's default timeout", async () => {
        // the panel's Java check finds the runtime installed on the test daemon
        installFakeJava("java-21");
        const { serverBridge } = await import("../src/lib/server");
        const { createInstallRun } = await import("../src/lib/installRun");
        const modpacks = await import("../src/lib/modpacks");
        const calls: { action: string; options: unknown }[] = [];
        // the bridge's one entry point, recorded: what each call asks of the transport
        serverBridge.call = (async (action: string, _params?: unknown, options?: unknown) => {
            calls.push({ action, options });
            return { software: "neoforge", version: "1.21.1", build: "21.1.256" };
        }) as typeof serverBridge.call;
        await createRoot(async (dispose) => {
            await createInstallRun().run("neoforge", "1.21.1");
            dispose();
        });
        await modpacks.installModpack("AANobbMI", "abc123");
        await modpacks.removeModpack();
        expect(calls).toEqual([
            { action: CALLS.installServerVersion, options: { timeoutMs: null } },
            { action: CALLS.installModpack, options: { timeoutMs: null } },
            { action: CALLS.removeModpack, options: { timeoutMs: null } },
        ]);
    });
});
