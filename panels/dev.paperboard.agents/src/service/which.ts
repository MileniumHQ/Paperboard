import fs from "node:fs";
import path from "node:path";

// A tool server's program, found on PATH the way a shell would, without one.
// On Windows a name is tried with each PATHEXT ending, and npm's .cmd shims
// (npx, and every globally installed server) run their script with node:
// a batch file can't be started without cmd.exe.

/** A program and the arguments it starts with. */
export interface Launch {
    command: string;
    args: string[];
}

export interface SearchEnv {
    platform: NodeJS.Platform;
    pathEnv: string;
    /** Windows only */
    pathExt?: string;
}

const currentEnv = (): SearchEnv => ({ platform: process.platform, pathEnv: process.env.PATH ?? "", pathExt: process.env.PATHEXT });

function isProgram(file: string, platform: NodeJS.Platform): boolean {
    try {
        if (!fs.statSync(file).isFile()) return false;
        if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
        return true;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "EACCES" && code !== "ENOTDIR") throw e;
        return false;
    }
}

/**
 * The script an npm .cmd shim runs with node, beside the shim: "%dp0%\node_modules\x\cli.js" in a
 * global package's shim, %~dp0\node_modules\npm\bin\npx-cli.js in npm's own npx.cmd and npm.cmd,
 * where the script it runs is the last one named.
 */
export function scriptFromCmdShim(shim: string, shimDir: string): string | undefined {
    const scripts = [...shim.matchAll(/%~?dp0%?\\([^"%\r\n]+?\.[cm]?js)\b/gi)];
    const script = scripts.at(-1)?.[1];
    return script ? path.join(shimDir, ...script.split("\\")) : undefined;
}

/** How to start `command` with `args` without a shell, or null when it isn't installed. */
export function findProgram(command: string, args: readonly string[], env: SearchEnv = currentEnv()): Launch | null {
    const win = env.platform === "win32";
    const absolute = path.isAbsolute(command);
    const dirs = absolute ? [path.dirname(command)] : env.pathEnv.split(win ? ";" : ":").filter(Boolean);
    const endings = win && !absolute && !path.extname(command) ? (env.pathExt || ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";").filter(Boolean) : [""];
    for (const dir of dirs) {
        for (const ending of endings) {
            const file = absolute ? command : path.join(dir, command + ending);
            if (!isProgram(file, env.platform)) continue;
            const kind = path.extname(file).toLowerCase();
            if (!win || (kind !== ".cmd" && kind !== ".bat")) return { command: file, args: [...args] };
            const script = scriptFromCmdShim(fs.readFileSync(file, "utf8"), path.dirname(file));
            if (!script) throw new Error(`"${file}" is a batch file, which Paperboard can't start; use the program it runs instead`);
            // the shim prefers the node.exe beside it, as npm writes it
            const local = path.join(path.dirname(file), "node.exe");
            const node = isProgram(local, env.platform) ? local : findProgram("node.exe", [], env)?.command;
            if (!node) throw new Error(`"${file}" needs Node.js, which isn't installed on this computer`);
            return { command: node, args: [script, ...args] };
        }
    }
    return null;
}
