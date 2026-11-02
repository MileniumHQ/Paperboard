// Writes records to the production PACKAGES namespace through wrangler,
// authenticated as the operator (`wrangler login`). No worker route can
// write package records: the only writer is someone holding the account.
import { execFile } from "node:child_process";
import path from "node:path";
import type { KeyObject } from "node:crypto";
import { assertValidRecord, type PackageRecord, type PlatformKey } from "./records";
import { releaseMessage, signRelease } from "../../../../scripts/releaseSigning";
import { RELEASE_PUBLIC_KEY, verifyRelease } from "../../../paperboard/papercrane/releaseSignature";
import { parsePackageRecipe, recipeDigest } from "../../../paperboard/papercrane/packageRecipe";

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
        const recipe = dl.recipe === undefined ? undefined : recipeDigest(parsePackageRecipe(dl.recipe));
        const msg = releaseMessage.package(record.name, record.version, platform, dl.sha256, recipe);
        const signature = signRelease(key, msg);
        if (!verifyRelease(msg, signature, publicKey)) {
            throw new Error("the release signing key does not match RELEASE_PUBLIC_KEY; refusing to write records");
        }
        platforms[platform as PlatformKey] = { ...dl, signature };
    }
    return { ...record, platforms };
}

/** The record the registry serves now, or undefined when it serves none. */
export type PublishedReader = (name: string) => Promise<unknown>;

// Reads through the public route, not wrangler: the same bytes daemons see,
// and no account call for a record that has not changed.
export const readPublished: PublishedReader = async (name) => {
    const res = await fetch(`https://origami.ariapis.com/package/${encodeURIComponent(name)}.json`, {
        headers: { "cache-control": "no-cache" },
    });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`reading the published ${name} record failed: HTTP ${res.status}`);
    return res.json();
};

// Key order differs between the written JSON and the worker's re-serialized
// response, so records compare by sorted keys.
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

export async function putRecord(
    record: PackageRecord,
    key: KeyObject,
    run: CommandRunner = runCommand,
    publicKey: string = RELEASE_PUBLIC_KEY,
    published?: PublishedReader,
): Promise<"written" | "unchanged"> {
    assertValidRecord(record);
    const signed = signRecord(record, key, publicKey);
    // ed25519 signatures are deterministic, so an unchanged upstream release
    // signs to the record already served. A failed read is not a reason to
    // skip: the write goes ahead.
    if (published) {
        const live = await published(signed.name).catch((err) => {
            console.warn(err instanceof Error ? err.message : String(err));
            return undefined;
        });
        if (live !== undefined && canonical(live) === canonical(signed)) return "unchanged";
    }
    await run("bunx", wranglerPutArgs(signed.name, JSON.stringify(signed, null, 2)), ORIGAMI_DIR);
    return "written";
}
