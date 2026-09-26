// Writes records to the production PACKAGES namespace through wrangler,
// authenticated as the operator (`wrangler login`). No worker route can
// write package records: the only writer is someone holding the account.
import { execFile } from "node:child_process";
import path from "node:path";
import { assertValidRecord, type PackageRecord } from "./records";

const ORIGAMI_DIR = path.resolve(import.meta.dir, "..", "..");

export type CommandRunner = (
    command: string,
    args: string[],
    cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

export const runCommand: CommandRunner = (command, args, cwd) =>
    new Promise((resolve, reject) => {
        // argv array, no shell: the record JSON is passed verbatim
        execFile(command, args, { cwd, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`${command} ${args.slice(0, 4).join(" ")} failed: ${stderr.trim() || err.message}`));
                return;
            }
            resolve({ stdout, stderr });
        });
    });

export function wranglerPutArgs(key: string, value: string): string[] {
    return ["wrangler", "kv", "key", "put", key, value, "--binding", "PACKAGES", "--remote"];
}

export async function putRecord(
    record: PackageRecord,
    run: CommandRunner = runCommand,
): Promise<void> {
    assertValidRecord(record);
    await run("bunx", wranglerPutArgs(record.name, JSON.stringify(record, null, 2)), ORIGAMI_DIR);
}
