// The desktop app half of the launcher: find an installed Paperboard, install
// it with the same script `curl -fsSL https://i.paperboard.dev | sh` runs
// (install/install.sh, install/install.ps1, shipped in this package), and
// open it.
//
// Paperboard is always run from an installed copy, never from a download
// kept here, so the app's own updater keeps it current the way it does any
// install.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

export interface InstalledApp {
    /** what to run */
    command: string;
    /** arguments before Paperboard's own */
    prefix: string[];
    /** macOS: `open` hands arguments to the app only with --args */
    argsFlag: string | null;
    where: string;
}

// Where install.sh and install.ps1 put Paperboard, in the order they're
// looked for. Never the `paperboard` on PATH: with this package installed
// globally, that may be this launcher.
export function installedAppCandidates(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
): string[] {
    if (platform === "win32") {
        if (!env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not set, so Paperboard can't be found or installed.");
        return [path.join(env.LOCALAPPDATA, "Programs", "paperboard", "paperboard.exe")];
    }
    if (platform === "darwin") return ["/Applications/Paperboard.app"];
    if (platform === "linux") {
        return [
            "/opt/Paperboard/paperboard",
            path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "paperboard", "Paperboard.AppImage"),
        ];
    }
    throw new Error(`Paperboard has no build for ${platform}. It runs on Windows, macOS and Linux.`);
}

export function findInstalledApp(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
): InstalledApp | null {
    for (const where of installedAppCandidates(platform, env, home)) {
        if (!fs.existsSync(where)) continue;
        // a second instance with -n, so a running Paperboard gets the arguments
        if (platform === "darwin") return { command: "open", prefix: ["-n", "-a", where], argsFlag: "--args", where };
        // as the AppImage's own menu entry starts it: its sandbox helper can't be setuid
        if (where.endsWith(".AppImage")) return { command: where, prefix: ["--no-sandbox"], argsFlag: null, where };
        return { command: where, prefix: [], argsFlag: null, where };
    }
    return null;
}

// the scripts sit beside dist/ in the published package, and beside src/ here
export function installScript(platform: NodeJS.Platform = process.platform): string {
    const name = platform === "win32" ? "install.ps1" : "install.sh";
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "install", name);
    if (!fs.existsSync(file)) throw new Error(`This copy of @mileniumhq/paperboard is missing ${name} (looked in ${file}).`);
    return file;
}

/** Runs the install script in this terminal; rejects when it fails. */
export function installApp(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const script = installScript(platform);
    const [command, args] = platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]]
        : ["sh", [script]];
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit", env });
        child.once("error", (err) => reject(new Error(`Could not run the Paperboard installer (${command}): ${err.message}`)));
        child.once("exit", (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`The Paperboard installer stopped ${signal ? `on ${signal}` : `with code ${code}`}.`));
        });
    });
}

/** Opens Paperboard and returns once it has started; it outlives this process. */
export function openApp(app: InstalledApp, args: string[]): Promise<void> {
    const all = [...app.prefix, ...(args.length && app.argsFlag ? [app.argsFlag] : []), ...args];
    return new Promise((resolve, reject) => {
        const child = spawn(app.command, all, { detached: true, stdio: "ignore" });
        child.once("error", (err) => reject(new Error(`Could not open Paperboard (${app.where}): ${err.message}`)));
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}

/** Asks a yes/no question in the terminal; Enter means yes. */
export function askToInstall(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Promise<boolean> {
    const rl = createInterface({ input, output });
    return new Promise((resolve) => {
        rl.question("Paperboard isn't installed on this computer. Install it now? [Y/n] ", (answer) => {
            rl.close();
            resolve(/^(y|yes)?$/i.test(answer.trim()));
        });
    });
}
