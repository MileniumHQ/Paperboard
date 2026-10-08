// startServerInstance launches whatever the last install recorded, and
// refuses while an install holds the server folder.
import { beforeEach, describe, expect, mock, test } from "bun:test";

let savedConfig: Record<string, unknown> = {};
let os = "linux";
let present = new Set<string>();
const starts: { command: string; args?: string[]; cwd?: string }[] = [];

const files = {
    read: async () => null,
    write: async () => "/fake",
    exists: async (p: string) => present.has(p),
    getPath: async () => "/srv/mc",
    download: async () => "/fake",
};
mock.module("@mileniumhq/paperapi", () => ({
    config: { get: async () => savedConfig, set: async () => true },
    processApi: {
        start: async (o: any) => {
            starts.push(o);
            return { success: true };
        },
        write: () => {},
        kill: () => {},
        exists: async () => false,
        onData: () => () => {},
        onExit: () => () => {},
    },
    files,
    fileApi: files,
    packages: { isInstalled: async () => true, getPath: async () => "/pkgs/java-21", download: async () => {} },
    system: { getInfo: async () => ({ os }), getLocalIP: async () => "127.0.0.1" },
}));

const { startServerInstance } = await import("../src/service/lifecycle");
const { installServerSoftware } = await import("../src/service/softwareInstall");

const NEOFORGE = {
    software: "neoforge",
    version: "1.21.1",
    install: {
        software: "neoforge",
        version: "1.21.1",
        build: "21.1.256",
        launch: {
            type: "argfile",
            unix: "libraries/net/neoforged/neoforge/21.1.256/unix_args.txt",
            windows: "libraries/net/neoforged/neoforge/21.1.256/win_args.txt",
        },
        files: ["libraries", "run.sh", "user_jvm_args.txt"],
        staging: ".install-1-1",
    },
};

function makeCtx() {
    const ctx: any = {
        state: { serverStatus: "offline", serverSoftware: "neoforge", serverVersion: "1.21.1", ramAllocation: 6, serverEntries: [] },
        setState: (patch: any) => {
            Object.assign(ctx.state, typeof patch === "function" ? patch(ctx.state) : patch);
        },
        emitTrigger: () => {},
    };
    return ctx;
}

beforeEach(() => {
    starts.length = 0;
    os = "linux";
    savedConfig = NEOFORGE;
    present = new Set([NEOFORGE.install.launch.unix, NEOFORGE.install.launch.windows]);
});

describe("startServerInstance", () => {
    test("an argument-file install starts java with the OS's argument file", async () => {
        const ctx = makeCtx();
        await startServerInstance(ctx);
        expect(starts[0]).toMatchObject({
            command: "/pkgs/java-21/bin/java",
            args: ["-Xmx6G", "-Xms6G", "@libraries/net/neoforged/neoforge/21.1.256/unix_args.txt", "nogui"],
            cwd: "/srv/mc",
        });
        expect(ctx.state.serverStatus).toBe("starting");
    });

    test("on Windows it is win_args.txt and java.exe", async () => {
        os = "windows";
        await startServerInstance(makeCtx());
        expect(starts[0]!.command).toBe("/pkgs/java-21/bin/java.exe");
        expect(starts[0]!.args).toContain("@libraries/net/neoforged/neoforge/21.1.256/win_args.txt");
    });

    test("a missing entry file is reported, not launched", async () => {
        present = new Set();
        const ctx = makeCtx();
        await startServerInstance(ctx);
        expect(starts).toEqual([]);
        expect(ctx.state.serverStatus).toBe("offline");
        expect(ctx.state.serverEntries.at(-1).content).toContain("unix_args.txt is missing");
    });

    test("a config from before install records still launches server.jar", async () => {
        savedConfig = { software: "paper", version: "1.21.1" };
        present = new Set(["server.jar"]);
        await startServerInstance(makeCtx());
        expect(starts[0]!.args).toEqual(["-Xmx6G", "-Xms6G", "-jar", "server.jar", "nogui"]);
    });

    test("refused while an install holds the server folder", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const installCtx = makeCtx();
        const install = installServerSoftware(installCtx, "paper", "1.21.1", {
            serverDir: async () => "/nonexistent",
            download: async () => {},
            javaBinary: async () => {
                await gate;
                throw new Error("stop here");
            },
            runInstaller: async () => ({ exitCode: 0, tail: [] }),
            readConfig: async () => ({}),
            writeConfig: async () => {},
        });
        const ctx = makeCtx();
        await startServerInstance(ctx);
        expect(starts).toEqual([]);
        expect(ctx.state.serverEntries.at(-1).content).toContain("install is running");
        release();
        await expect(install).rejects.toThrow("stop here");
    });
});
