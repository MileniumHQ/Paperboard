// A workload the desktop app starts outlives the app. The app used to
// supervise workloads inside its own process (EmbeddedSupervisor), so when it
// crashed a game server kept running with nothing attached: its console went
// to a dead process and the next launch could neither reach nor stop it. The
// app now starts the same detached supervisor as the standalone crane, from
// its own binary in node mode, and a restarted crane adopts the workload.
import { afterEach, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PaperCraneEngine } from "../papercrane/engine";
import { inMount, mountAppImage, stopMountHolder, supervisorLaunch } from "../papercrane/supervisorLaunch";

// the binary itself: other suites stub the "electron" module, so it is found
// the way the electron package's own index finds it
const ELECTRON_PACKAGE = path.dirname(require.resolve("electron/package.json"));
const ELECTRON = path.join(ELECTRON_PACKAGE, "dist", fs.readFileSync(path.join(ELECTRON_PACKAGE, "path.txt"), "utf8").trim());
const PAPERCRANE = path.join(import.meta.dir, "..", "papercrane");

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw err;
    }
}

async function until<T>(what: string, probe: () => T | undefined | false, ms = 15_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
        const value = probe();
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

// bundles the way electron-vite does: CommonJS, supervisor.js beside the host
async function bundle(dir: string): Promise<string> {
    for (const [entry, name] of [
        [path.join(PAPERCRANE, "supervisorEntry.ts"), "supervisor.js"],
        [path.join(import.meta.dir, "fixtures", "desktopHost.ts"), "host.js"],
    ] as const) {
        const built = await Bun.build({ entrypoints: [entry], target: "node", format: "cjs", external: ["node-pty"] });
        if (!built.success) throw new AggregateError(built.logs, `could not bundle ${entry}`);
        fs.writeFileSync(path.join(dir, name), await built.outputs[0]!.text());
    }
    return path.join(dir, "host.js");
}

describe("a workload the desktop app starts", () => {
    it("keeps running when the app is killed, and the next crane adopts it", async () => {
        const host = await bundle(tempDir("desktop-supervisor-bundle-"));
        const out = path.join(tempDir("desktop-supervisor-out-"), "workload.json");
        const id = "dev.test.desktop.survivor";

        const app: ChildProcess = spawn(ELECTRON, [host, id, process.execPath, out], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let log = "";
        app.stdout!.on("data", (d) => { log += d; });
        app.stderr!.on("data", (d) => { log += d; });
        cleanup.push(() => { if (app.exitCode === null && app.signalCode === null) app.kill("SIGKILL"); });
        await until(`the app to start the workload (output: ${log})`, () => log.includes("started"));
        const workload = await until("the workload to report in", () =>
            fs.existsSync(out) && JSON.parse(fs.readFileSync(out, "utf8")) as { pid: number; runAsNode: string | null });
        cleanup.push(() => { if (alive(workload.pid)) process.kill(workload.pid, "SIGKILL"); });
        // node mode is how the supervisor started, not part of the workload's environment
        expect(workload.runAsNode).toBeNull();

        // the app crashes
        const gone = new Promise((r) => app.once("exit", r));
        app.kill("SIGKILL");
        await gone;
        await new Promise((r) => setTimeout(r, 300));
        expect(alive(workload.pid)).toBe(true);

        // the next launch's crane finds it, and can still stop it
        const engine = new PaperCraneEngine();
        await engine.recoverRunningSupervisors();
        expect(await engine.isProcessRunning(id)).toBe(true);
        await engine.killProcess(id, "SIGTERM");
        await until("the adopted workload to stop", () => !alive(workload.pid));
    }, 60_000);
});

describe("where the desktop app starts its supervisors", () => {
    const env = { PATH: "/usr/bin" };

    it("is the crane's own binary on the standalone crane", () => {
        expect(supervisorLaunch("x", { execPath: "/opt/papercrane", electron: false, platform: "linux", env })).toEqual({
            command: "/opt/papercrane", args: ["--supervise", "x"], env,
        });
    });

    it("is the app's binary in node mode, running the bundled entry", () => {
        const launch = supervisorLaunch("x", { execPath: "/Applications/Paperboard.app/Contents/MacOS/Paperboard", electron: true, platform: "darwin", env, entry: "/app/out/main/supervisor.js" });
        expect(launch.command).toBe("/Applications/Paperboard.app/Contents/MacOS/Paperboard");
        expect(launch.args).toEqual(["/app/out/main/supervisor.js", "--supervise", "x"]);
        expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
        expect(launch.appImage).toBeUndefined();
    });

    it("is a mount of its own for an AppImage, which dies with the app's mount otherwise", () => {
        const launch = supervisorLaunch("x", {
            execPath: "/tmp/.mount_PaperA/paperboard",
            electron: true,
            platform: "linux",
            env: { ...env, APPIMAGE: "/home/u/Paperboard.AppImage", APPDIR: "/tmp/.mount_PaperA" },
            entry: "/tmp/.mount_PaperA/resources/app.asar/out/main/supervisor.js",
        });
        expect(launch.appImage).toEqual({ image: "/home/u/Paperboard.AppImage", appDir: "/tmp/.mount_PaperA" });
        expect(inMount(launch.command, "/tmp/.mount_PaperA", "/tmp/.mount_PaperB")).toBe("/tmp/.mount_PaperB/paperboard");
        expect(inMount(launch.args[0]!, "/tmp/.mount_PaperA", "/tmp/.mount_PaperB")).toBe("/tmp/.mount_PaperB/resources/app.asar/out/main/supervisor.js");
        expect(() => inMount("/usr/bin/sh", "/tmp/.mount_PaperA", "/tmp/.mount_PaperB")).toThrow(/not inside the AppImage/);
    });

    it("refuses an AppImage that doesn't say where it is mounted", () => {
        expect(() => supervisorLaunch("x", { execPath: "/tmp/m/paperboard", electron: true, platform: "linux", env: { APPIMAGE: "/a.AppImage" }, entry: "/tmp/m/s.js" }))
            .toThrow(/APPDIR is not set/);
    });
});

describe.if(process.platform === "linux")("an AppImage mount held for a supervisor", () => {
    // an AppImage runtime's --appimage-mount: print the mount point, hold it until stopped
    function fakeRuntime(dir: string): string {
        const image = path.join(dir, "Fake.AppImage");
        fs.writeFileSync(image, `#!/bin/sh\n[ "$1" = --appimage-mount ] || exit 2\nm=$(mktemp -d "${dir}/.mount_XXXX")\ntrap 'rmdir "$m"; exit 0' TERM\necho "$m"\nwhile :; do sleep 0.1; done\n`, { mode: 0o755 });
        return image;
    }

    it("is mounted from the image, and stopped only through its runtime", async () => {
        const dir = tempDir("appimage-mount-");
        const mount = await mountAppImage(fakeRuntime(dir));
        cleanup.push(() => { if (mount.holder.pid && alive(mount.holder.pid)) process.kill(mount.holder.pid, "SIGKILL"); });
        expect(fs.statSync(mount.dir).isDirectory()).toBe(true);
        expect(path.dirname(mount.dir)).toBe(dir);

        // a pid that is not an AppImage runtime holding a mount is left alone
        const bystander = spawn("sleep", ["30"]);
        cleanup.push(() => { bystander.kill("SIGKILL"); });
        stopMountHolder(bystander.pid);
        await new Promise((r) => setTimeout(r, 200));
        expect(alive(bystander.pid!)).toBe(true);

        stopMountHolder(mount.holder.pid);
        await until("the mount to be released", () => !fs.existsSync(mount.dir));
    });

    it("fails loudly when the runtime can't mount", async () => {
        const dir = tempDir("appimage-broken-");
        const image = path.join(dir, "Broken.AppImage");
        fs.writeFileSync(image, "#!/bin/sh\necho 'squashfs: bad superblock' >&2\nexit 1\n", { mode: 0o755 });
        await expect(mountAppImage(image)).rejects.toThrow(/Could not mount .*bad superblock/);
    });
});
