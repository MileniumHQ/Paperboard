// installServerSoftware end to end over a real server folder. Downloads,
// the installer child and panel config are the daemon's; they are faked at
// the SDK seam, and the fake installer writes exactly the layout the real
// NeoForge installer produced. The real-daemon run is the e2e check.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installServerSoftware, isInstallRunning, type InstallDeps } from "../src/service/softwareInstall";
import { InstallerStillRunningError, type InstallerRun } from "../src/service/installerProcess";
import { SOFTWARE_PROVIDERS } from "../src/software/providers";
import type { ServerSoftwareType } from "../src/software/catalog";
import type { SoftwareProvider } from "../src/software/types";

let root: string;
let config: Record<string, unknown>;
let progress: unknown[];
const ctx = {
    state: { serverStatus: "offline" },
    setState: (patch: Record<string, unknown>) => {
        if ("installProgress" in patch) progress.push(patch.installProgress);
    },
} as any;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-install-"));
    config = {};
    progress = [];
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string, content = relative) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}
const has = (relative: string) => fs.existsSync(path.join(root, relative));
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const stagingLeft = () => fs.readdirSync(root).filter((e) => e.startsWith(".install-"));

function withBuild(id: ServerSoftwareType, build: string | null): SoftwareProvider {
    return {
        ...SOFTWARE_PROVIDERS[id],
        resolveBuild: async () => ({ build, artifact: { url: `https://example.invalid/${id}.jar`, sha256: "a".repeat(64) } }),
    };
}

// what `java -jar neoforge-21.1.256-installer.jar --installServer <out>` wrote
function neoForgeOutput(out: string) {
    const lib = path.join(out, "libraries/net/neoforged/neoforge/21.1.256");
    fs.mkdirSync(lib, { recursive: true });
    fs.writeFileSync(path.join(lib, "unix_args.txt"), "-cp a:b");
    fs.writeFileSync(path.join(lib, "win_args.txt"), "-cp a;b");
    fs.writeFileSync(path.join(out, "run.sh"), "#!/bin/sh");
    fs.writeFileSync(path.join(out, "user_jvm_args.txt"), "# jvm");
}

function deps(overrides: Partial<InstallDeps> & { software: ServerSoftwareType; build?: string | null }): InstallDeps {
    const { software, build = "21.1.256", ...rest } = overrides;
    return {
        serverDir: async () => root,
        download: async ({ targetPath }) => {
            write(targetPath, `downloaded:${targetPath}`);
        },
        javaBinary: async () => ({ bin: "/java/bin/java", home: "/java" }),
        runInstaller: async (run: InstallerRun) => {
            neoForgeOutput(run.args[3]!);
            return { exitCode: 0, tail: [] };
        },
        readConfig: async () => config,
        writeConfig: async (patch) => {
            config = { ...config, ...patch };
        },
        provider: () => withBuild(software, build),
        ...rest,
    };
}

function paperServer() {
    write("server.jar", "paper");
    write("world/level.dat", "world");
    write("server.properties", "motd=hi");
    config = { software: "paper", version: "1.21.1", configured: true, ramGB: 4 };
}

describe("installServerSoftware", () => {
    test("Paper -> NeoForge: installer output goes live and the launch is recorded from it", async () => {
        paperServer();
        const runs: InstallerRun[] = [];
        const outcome = await installServerSoftware(ctx, "neoforge", "1.21.1", deps({
            software: "neoforge",
            runInstaller: async (run) => {
                runs.push(run);
                neoForgeOutput(run.args[3]!);
                return { exitCode: 0, tail: [] };
            },
        }));

        expect(outcome).toEqual({ software: "neoforge", version: "1.21.1", build: "21.1.256" });
        // the installer ran into staging, never into the live folder
        expect(runs[0]!.args[3]).toMatch(/\/\.install-[^/]+\/server$/);
        expect(runs[0]!.args[1]).toMatch(/\/\.install-[^/]+\/installer\.jar$/);
        expect(has("libraries/net/neoforged/neoforge/21.1.256/unix_args.txt")).toBe(true);
        expect(has("server.jar")).toBe(false);
        expect(has("installer.jar")).toBe(false);
        expect(stagingLeft()).toEqual([]);
        expect(read("world/level.dat")).toBe("world");
        expect(read("server.properties")).toBe("motd=hi");
        expect(config).toMatchObject({
            software: "neoforge",
            version: "1.21.1",
            configured: true,
            install: {
                software: "neoforge",
                build: "21.1.256",
                launch: {
                    type: "argfile",
                    unix: "libraries/net/neoforged/neoforge/21.1.256/unix_args.txt",
                    windows: "libraries/net/neoforged/neoforge/21.1.256/win_args.txt",
                },
                files: ["libraries", "run.sh", "user_jvm_args.txt"],
            },
        });
        expect(progress).toContainEqual({ stage: "installing", percent: 0 });
        expect(progress.at(-1)).toEqual({ stage: "completed", percent: 100 });
    });

    test("a pinned build is what the provider is asked for", async () => {
        paperServer();
        const asked: [string, string | undefined][] = [];
        await installServerSoftware(
            ctx,
            "neoforge",
            "1.21.1",
            deps({
                software: "neoforge",
                provider: () => ({
                    ...withBuild("neoforge", "21.1.256"),
                    resolveBuild: async (mc: string, pinned?: string) => {
                        asked.push([mc, pinned]);
                        return { build: "21.1.256", artifact: { url: "https://example.invalid/n.jar", sha256: "a".repeat(64) } };
                    },
                }),
            }),
            { build: "21.1.256" },
        );
        expect(asked).toEqual([["1.21.1", "21.1.256"]]);
    });

    test("NeoForge -> Paper removes every NeoForge file and launches server.jar", async () => {
        paperServer();
        await installServerSoftware(ctx, "neoforge", "1.21.1", deps({ software: "neoforge" }));
        await installServerSoftware(ctx, "paper", "1.21.1", deps({ software: "paper", build: "130" }));
        expect(has("libraries")).toBe(false);
        expect(has("run.sh")).toBe(false);
        expect(has("user_jvm_args.txt")).toBe(false);
        expect(read("server.jar")).toContain("server.jar");
        expect(config).toMatchObject({
            software: "paper",
            install: { launch: { type: "jar", jar: "server.jar" }, files: ["server.jar"], build: "130" },
        });
        expect(fs.readdirSync(root).some((e) => e.startsWith(".trash-"))).toBe(false);
    });

    test("a failing installer leaves the previous server exactly as it was", async () => {
        paperServer();
        await expect(
            installServerSoftware(ctx, "neoforge", "1.21.1", deps({
                software: "neoforge",
                runInstaller: async (run) => {
                    fs.mkdirSync(path.join(run.args[3]!, "libraries"), { recursive: true });
                    return { exitCode: 1, tail: ["Downloading library from https://…", "There was an error during installation"] };
                },
            })),
        ).rejects.toThrow(/installer failed \(exit code 1\):[\s\S]*error during installation/);
        expect(read("server.jar")).toBe("paper");
        expect(has("libraries")).toBe(false);
        expect(stagingLeft()).toEqual([]);
        expect(config.software).toBe("paper");
        expect(progress.at(-1)).toEqual({ stage: "error", percent: 0 });
    });

    test("exit code 0 with nothing launchable is a failure, not an install", async () => {
        paperServer();
        await expect(
            installServerSoftware(ctx, "neoforge", "1.21.1", deps({
                software: "neoforge",
                runInstaller: async (run) => {
                    fs.mkdirSync(run.args[3]!, { recursive: true });
                    fs.writeFileSync(path.join(run.args[3]!, "run.sh"), "");
                    return { exitCode: 0, tail: [] };
                },
            })),
        ).rejects.toThrow("left no server to launch");
        expect(read("server.jar")).toBe("paper");
        expect(config.install).toBeUndefined();
    });

    test("a record that cannot be written puts the previous server back", async () => {
        paperServer();
        await expect(
            installServerSoftware(ctx, "neoforge", "1.21.1", deps({
                software: "neoforge",
                writeConfig: async () => {
                    throw new Error("config locked");
                },
            })),
        ).rejects.toThrow("previous server was restored: config locked");
        expect(read("server.jar")).toBe("paper");
        expect(has("libraries")).toBe(false);
        expect(stagingLeft()).toEqual([]);
    });

    test("an installer that would not stop keeps its staging folder for start-up recovery", async () => {
        paperServer();
        await expect(
            installServerSoftware(ctx, "neoforge", "1.21.1", deps({
                software: "neoforge",
                runInstaller: async () => {
                    throw new InstallerStillRunningError("did not exit");
                },
            })),
        ).rejects.toThrow("did not exit");
        expect(stagingLeft().length).toBe(1);
        expect(read("server.jar")).toBe("paper");
    });

    test("one install at a time, and the lock is released after failure", async () => {
        paperServer();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = installServerSoftware(ctx, "neoforge", "1.21.1", deps({
            software: "neoforge",
            runInstaller: async (run) => {
                await gate;
                neoForgeOutput(run.args[3]!);
                return { exitCode: 0, tail: [] };
            },
        }));
        expect(isInstallRunning()).toBe(true);
        await expect(
            installServerSoftware(ctx, "paper", "1.21.1", deps({ software: "paper" })),
        ).rejects.toThrow("already running");
        release();
        await first;
        expect(isInstallRunning()).toBe(false);

        await expect(
            installServerSoftware(ctx, "paper", "1.21.1", deps({
                software: "paper",
                javaBinary: async () => {
                    throw new Error("no java");
                },
            })),
        ).rejects.toThrow("no java");
        expect(isInstallRunning()).toBe(false);
    });
});

test("activation and rollback failure preserve parked originals for recovery", async () => {
    paperServer();
    const faultyFs = { ...fs.promises, rename: async (from: string, to: string) => {
        if (to === path.join(root, "server.jar") && from.includes(".install-")) throw new Error("rename blocked");
        await fs.promises.rename(from, to);
    } };
    await expect(installServerSoftware(ctx, "paper", "1.21.2", deps({ software: "paper", fs: faultyFs }))).rejects.toThrow("restoring the previous files also failed");
    const staging = stagingLeft()[0]!;
    expect(read(`${staging}/previous/server.jar`)).toBe("paper");
    const { recoverStagedInstalls } = await import("../src/service/activation");
    await recoverStagedInstalls(root, null);
    expect(read("server.jar")).toBe("paper");
    expect(stagingLeft()).toEqual([]);
});
