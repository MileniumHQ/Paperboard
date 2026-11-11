// How this host starts a detached supervisor, so a workload outlives the
// process that started it and a restarted host adopts it. Every host starts
// the same binary (supervisorBinary.ts), told where the data directory is
// and which workload it is for; what to run follows on its stdin.
import * as fs from "fs";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";

export interface SupervisorLaunch {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
}

export function supervisorLaunch(
    id: string,
    binary: string,
    dataDir: string = getPaperboardDir(),
    env: NodeJS.ProcessEnv = process.env,
): SupervisorLaunch {
    // the workload inherits this environment, so the data directory travels
    // as an argument and never as a variable the workload would see
    return { command: binary, args: ["--data-dir", dataDir, "--supervise", id], env };
}

// Earlier builds ran each AppImage supervisor from a mount of its own, held
// by a detached AppImage runtime that the supervisor stopped as it exited. A
// supervisor from such a build that was killed outright left its mount
// behind; the adoption sweep (engine.ts) stops it here. Only an AppImage
// runtime holding a mount is signalled: a recorded pid can belong to another
// process by now.
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
