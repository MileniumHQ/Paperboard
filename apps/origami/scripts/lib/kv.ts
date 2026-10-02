// Writes records to the production PACKAGES namespace through wrangler,
// authenticated as the operator (`wrangler login`). No worker route can
// write package records: the only writer is someone holding the account.
import { execFile } from "node:child_process";
import path from "node:path";
import type { KeyObject } from "node:crypto";
import { assertValidRecord, type PackageRecord, type PlatformKey } from "./records";
import { releaseMessage, signRelease } from "../../../../scripts/releaseSigning";
import { RELEASE_PUBLIC_KEY, verifyRelease } from "../../../paperboard/papercrane/releaseSignature";

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

// Signs every platform entry with the offline release key. Daemons refuse
// an entry without a valid signature, so an unsigned record is never
// written; the signature is checked against the key clients ship before
// anything leaves this machine.
export function signRecord(
    record: PackageRecord,
    key: KeyObject,
    publicKey: string = RELEASE_PUBLIC_KEY,
): PackageRecord {
    const platforms: PackageRecord["platforms"] = {};
    for (const [platform, dl] of Object.entries(record.platforms)) {
        if (!dl) continue;
        const msg = releaseMessage.package(record.name, record.version, platform, dl.sha256);
        const signature = signRelease(key, msg);
        if (!verifyRelease(msg, signature, publicKey)) {
            throw new Error("the release signing key does not match RELEASE_PUBLIC_KEY; refusing to write records");
        }
        platforms[platform as PlatformKey] = { ...dl, signature };
    }
    return { ...record, platforms };
}

export async function putRecord(
    record: PackageRecord,
    key: KeyObject,
    run: CommandRunner = runCommand,
    publicKey: string = RELEASE_PUBLIC_KEY,
): Promise<void> {
    assertValidRecord(record);
    const signed = signRecord(record, key, publicKey);
    await run("bunx", wranglerPutArgs(signed.name, JSON.stringify(signed, null, 2)), ORIGAMI_DIR);
}
