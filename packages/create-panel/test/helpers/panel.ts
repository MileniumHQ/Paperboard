// A scaffolded panel in a temp folder, wired to this repo's libraries and
// toolchain the way `bun install` would wire a standalone panel to the
// published ones (the test runs offline), and the commands a panel author
// runs in it.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const PACKAGE = join(import.meta.dir, "..", "..");
const REPO = join(PACKAGE, "..", "..");
export const PAPERAPI_CLI = join(REPO, "packages", "paperapi", "dist", "cli.js");

export function tempDir(label: string): string {
    return mkdtempSync(join(tmpdir(), `create-panel-${label}-`));
}

// node_modules for a panel outside the repo: the SDK and design system from
// this checkout (their dist is what the published packages ship), the build
// tools from the scaffolder's own dev dependencies
export function linkDependencies(panelDir: string): void {
    const modules = join(panelDir, "node_modules");
    mkdirSync(join(modules, "@mileniumhq"), { recursive: true });
    mkdirSync(join(modules, ".bin"), { recursive: true });
    symlinkSync(join(REPO, "packages", "paperapi"), join(modules, "@mileniumhq", "paperapi"), "dir");
    symlinkSync(join(REPO, "packages", "paperui"), join(modules, "@mileniumhq", "paperui"), "dir");
    for (const tool of ["solid-js", "typescript", "vite", "vite-plugin-solid"]) {
        const source = join(PACKAGE, "node_modules", tool);
        if (!existsSync(source)) throw new Error(`${source} is missing: run bun install in the repo before the create-panel tests`);
        symlinkSync(realpathSync(source), join(modules, tool), "dir");
    }
    symlinkSync(join(modules, "typescript", "bin", "tsc"), join(modules, ".bin", "tsc"));
    symlinkSync(join(modules, "vite", "bin", "vite.js"), join(modules, ".bin", "vite"));
}

export interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
}

export function run(command: string, args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });
        child.once("error", (err) => reject(new Error(`could not run ${command}: ${err.message}`)));
        child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
}

// a command that must succeed; its output is the failure message when not
export async function ok(command: string, args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<Run> {
    const result = await run(command, args, cwd, env);
    if (result.code !== 0) {
        throw new Error(`${command} ${args.join(" ")} in ${cwd} exited ${result.code}\n${result.stdout}\n${result.stderr}`);
    }
    return result;
}

export function paperapi(args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<Run> {
    if (!existsSync(PAPERAPI_CLI)) {
        throw new Error(`${PAPERAPI_CLI} is missing: the create-panel gate target builds paperapi first (bun run build in packages/paperapi)`);
    }
    return run("node", [PAPERAPI_CLI, ...args], cwd, env);
}

// every file under dir, relative, skipping what a build or install adds
export function writtenFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const entry of readdirSync(current)) {
            if (["node_modules", "dist", "out"].includes(entry)) continue;
            const full = join(current, entry);
            if (statSync(full).isDirectory()) walk(full);
            else out.push(relative(dir, full));
        }
    };
    walk(dir);
    return out.sort();
}

export function readJson(file: string): any {
    return JSON.parse(readFileSync(file, "utf8"));
}

// the throwaway data folders a panel's test preload makes, by name
export function panelTestFolders(): Set<string> {
    return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("panel-test-")));
}
