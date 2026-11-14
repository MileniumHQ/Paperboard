// The operator's one way to reach production: wrangler, authenticated as
// the account holder (`wrangler login`), run from the worker's directory so
// it reads wrangler.jsonc's bindings. Package records (kv.ts) and panels
// (panelPublish.ts) are both written through it.
import { execFile } from "node:child_process";
import path from "node:path";

export const ORIGAMI_DIR = path.resolve(import.meta.dir, "..", "..");

export type CommandRunner = (
    command: string,
    args: string[],
    cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

export const runCommand: CommandRunner = (command, args, cwd) =>
    new Promise((resolve, reject) => {
        // argv arrays only, never a shell: versions, ids and JSON go verbatim
        execFile(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`${command} ${args.slice(0, 5).join(" ")} failed: ${stderr.trim() || err.message}`));
                return;
            }
            resolve({ stdout, stderr });
        });
    });

export function kvGetArgs(key: string): string[] {
    return ["wrangler", "kv", "key", "get", key, "--binding", "PACKAGES", "--remote"];
}

export function kvListArgs(key: string): string[] {
    return ["wrangler", "kv", "key", "list", "--prefix", key, "--binding", "PACKAGES", "--remote"];
}

export function kvPutArgs(key: string, value: string): string[] {
    return ["wrangler", "kv", "key", "put", key, value, "--binding", "PACKAGES", "--remote"];
}
