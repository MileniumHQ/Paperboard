// How this host starts a detached supervisor (supervisor.ts), so a workload
// outlives the process that started it and a restarted host adopts it.
//
//   compiled crane (Bun)   its own binary: `papercrane --supervise <id>`
//   desktop app (Electron) its own binary in node mode, running the bundled
//                          supervisor entry (supervisorEntry.ts)
//   desktop app (AppImage) the same, from a mount of the AppImage that the
//                          supervisor holds itself
//
// An AppImage runs from a FUSE mount that its runtime takes down when the app
// exits or the runtime is killed. Every process still executing from that
// mount then dies with SIGBUS, so a supervisor started from the app's own
// mount would die with the app. Each one gets its own mount instead
// (`<appimage> --appimage-mount`), and stops it when it exits.
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";

export interface SupervisorHost {
    execPath: string;
    electron: boolean;
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    // the bundled supervisor entry (Electron only)
    entry?: string;
}

export interface SupervisorLaunch {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    // set when the supervisor must run from its own AppImage mount
    appImage?: { image: string; appDir: string };
}

export function supervisorLaunch(id: string, host: SupervisorHost): SupervisorLaunch {
    if (!host.electron) return { command: host.execPath, args: ["--supervise", id], env: host.env };
    if (!host.entry) throw new Error("The desktop app has no supervisor entry to start");
    const env = { ...host.env, ELECTRON_RUN_AS_NODE: "1" };
    const launch = { command: host.execPath, args: [host.entry, "--supervise", id], env };
    const image = host.env.APPIMAGE;
    const appDir = host.env.APPDIR;
    if (host.platform !== "linux" || !image) return launch;
    if (!appDir) throw new Error("This AppImage did not say where it is mounted (APPDIR is not set)");
    return { ...launch, appImage: { image, appDir } };
}

// a path inside one mount of the AppImage, moved to another
export function inMount(file: string, appDir: string, mount: string): string {
    const relative = path.relative(appDir, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${file} is not inside the AppImage mounted at ${appDir}`);
    }
    return path.join(mount, relative);
}

export interface AppImageMount {
    dir: string;
    holder: ChildProcess;
}

const MOUNT_TIMEOUT_MS = 10_000;

// Mounts the AppImage on its own. The runtime prints the mount point and
// keeps it mounted until it is stopped.
export function mountAppImage(image: string): Promise<AppImageMount> {
    return new Promise((resolve, reject) => {
        const holder = spawn(image, ["--appimage-mount"], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const fail = (reason: string) => {
            clearTimeout(timer);
            stopMountHolder(holder.pid);
            reject(new Error(`Could not mount ${image} for a supervisor: ${reason}`));
        };
        const timer = setTimeout(() => fail(`no mount point after ${MOUNT_TIMEOUT_MS / 1000} s`), MOUNT_TIMEOUT_MS);
        holder.on("error", (e) => fail(e.message));
        holder.on("exit", (code, signal) => fail(err.trim() || `the runtime exited (${signal ?? code})`));
        holder.stderr!.setEncoding("utf8");
        holder.stderr!.on("data", (chunk: string) => { err += chunk; });
        holder.stdout!.setEncoding("utf8");
        holder.stdout!.on("data", (chunk: string) => {
            out += chunk;
            const newline = out.indexOf("\n");
            if (newline === -1) return;
            const dir = out.slice(0, newline).trim();
            clearTimeout(timer);
            holder.removeAllListeners("exit");
            holder.removeAllListeners("error");
            holder.stdout!.destroy();
            holder.stderr!.destroy();
            holder.unref();
            if (!dir || !fs.existsSync(dir)) {
                stopMountHolder(holder.pid);
                reject(new Error(`Could not mount ${image} for a supervisor: the runtime named "${dir}"`));
                return;
            }
            resolve({ dir, holder });
        });
    });
}

// Stops a mount a supervisor held. Only an AppImage runtime holding a mount
// is signalled: a recorded pid can belong to another process by now.
export function stopMountHolder(pid: number | undefined): void {
    if (!pid) return;
    if (process.platform === "linux") {
        let cmdline: string;
        try {
            cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // already gone
            logger.error(`[supervisor] could not check what process ${pid} is; leaving it running:`, err);
            return;
        }
        if (!cmdline.split("\0").includes("--appimage-mount")) return;
    }
    try {
        process.kill(pid, "SIGTERM");
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
            logger.error(`[supervisor] could not stop the AppImage mount held by ${pid}:`, err);
        }
    }
}
