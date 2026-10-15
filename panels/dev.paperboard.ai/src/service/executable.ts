// Finding an agent the user installed. A daemon started from a desktop
// launcher often has a short PATH (macOS gives GUI apps /usr/bin:/bin...),
// while npm, bun, cargo and installer scripts put commands in per-user
// folders, so those are searched after PATH. Nothing here runs a shell.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCommandShape } from "../core/agents";

export interface Launch {
    /** an absolute path */
    command: string;
    args: string[];
    /** PATH for the child: the command's folder first, so `#!/usr/bin/env node` finds the node it was installed with */
    pathEnv: string;
}

export interface SearchEnv {
    platform: NodeJS.Platform;
    pathEnv: string;
    home: string;
    /** Windows only */
    pathExt?: string;
    appData?: string;
}

const MAX_NVM_VERSIONS = 8;

export function currentSearchEnv(): SearchEnv {
    return {
        platform: process.platform,
        pathEnv: process.env.PATH ?? process.env.Path ?? "",
        home: os.homedir(),
        pathExt: process.env.PATHEXT,
        appData: process.env.APPDATA,
    };
}

/** The folders searched, PATH first, without duplicates. */
export async function searchDirs(env: SearchEnv): Promise<string[]> {
    const sep = env.platform === "win32" ? ";" : ":";
    const fromPath = env.pathEnv.split(sep).filter(Boolean);
    const h = env.home;
    const extra =
        env.platform === "win32"
            ? [env.appData ? path.win32.join(env.appData, "npm") : "", path.win32.join(h, ".bun", "bin"), path.win32.join(h, ".cargo", "bin"), path.win32.join(h, ".local", "bin")]
            : [
                  path.join(h, ".local", "bin"),
                  path.join(h, ".npm-global", "bin"),
                  path.join(h, ".bun", "bin"),
                  path.join(h, ".cargo", "bin"),
                  path.join(h, ".volta", "bin"),
                  path.join(h, ".deno", "bin"),
                  path.join(h, "bin"),
                  "/opt/homebrew/bin",
                  "/usr/local/bin",
                  ...(await nvmBins(h)),
              ];
    return [...new Set([...fromPath, ...extra.filter(Boolean)])];
}

/** nvm's node versions, newest first (a global npm install lands in one of them). */
async function nvmBins(home: string): Promise<string[]> {
    const root = path.join(home, ".nvm", "versions", "node");
    let names: string[];
    try {
        names = await fs.promises.readdir(root);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
    }
    const version = (n: string) => n.replace(/^v/, "").split(".").map((p) => Number(p) || 0);
    return names
        .filter((n) => /^v\d/.test(n))
        .sort((a, b) => {
            const [x, y] = [version(a), version(b)];
            for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] ?? 0) - (x[i] ?? 0);
            return 0;
        })
        .slice(0, MAX_NVM_VERSIONS)
        .map((n) => path.join(root, n, "bin"));
}

async function isExecutableFile(file: string, platform: NodeJS.Platform): Promise<boolean> {
    try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) return false;
        if (platform !== "win32") await fs.promises.access(file, fs.constants.X_OK);
        return true;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "EACCES" || code === "ENOTDIR") return false;
        throw err;
    }
}

/**
 * npm's Windows shim (`name.cmd`) runs `node <script>`; a .cmd cannot be
 * spawned without a shell, so the script is run with node directly.
 */
export function scriptFromCmdShim(shim: string, shimDir: string): string | undefined {
    const match = /"%(?:~?dp0)%\\([^"]+?\.(?:c|m)?js)"/i.exec(shim);
    return match ? path.win32.join(shimDir, match[1]!) : undefined;
}

/**
 * Resolves a command to something spawnable without a shell, or null when it
 * is not installed. Absolute paths and searched names both pass through shim conversion.
 */
export async function findExecutable(command: string, args: readonly string[], env: SearchEnv = currentSearchEnv()): Promise<Launch | null> {
    const sep = env.platform === "win32" ? ";" : ":";
    const p = env.platform === "win32" ? path.win32 : path.posix;
    const launch = (file: string, extraArgs: string[] = []): Launch => ({
        command: file,
        args: [...extraArgs, ...args],
        pathEnv: [p.dirname(file), env.pathEnv].filter(Boolean).join(sep),
    });
    const absolute = checkCommandShape(command) === "absolute";
    const dirs = absolute ? [p.dirname(command)] : await searchDirs(env);
    const extensions = env.platform === "win32" ? (env.pathExt ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
    const exts = absolute || p.extname(command) ? [""] : extensions;
    for (const dir of dirs) {
        for (const ext of exts) {
            const file = absolute ? command : p.join(dir, command + ext);
            if (!(await isExecutableFile(file, env.platform))) continue;
            const lower = p.extname(file).toLowerCase();
            if (env.platform !== "win32" || (lower !== ".cmd" && lower !== ".bat")) return launch(file);
            const script = scriptFromCmdShim(await fs.promises.readFile(file, "utf8"), dir);
            if (!script) continue;
            // the shim prefers a node.exe beside it, as npm writes it
            const local = p.join(dir, "node.exe");
            const node = (await isExecutableFile(local, env.platform)) ? local : (await findExecutable("node.exe", [], env))?.command;
            if (!node) continue;
            return { ...launch(node, [script]), pathEnv: [dir, p.dirname(node), env.pathEnv].filter(Boolean).join(sep) };
        }
    }
    return null;
}
