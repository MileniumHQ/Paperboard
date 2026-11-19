// What every publish flow shares: where things are, the version being
// published, how a flow stops, running a command, hashing, and the console
// output (tables, progress bars).
import * as p from "@clack/prompts";
import { Presets, SingleBar } from "cli-progress";
import { readFileSync } from "fs";
import { join } from "path";
import type { KeyObject } from "node:crypto";
import { signRelease } from "./releaseSigning";
import { RELEASE_PUBLIC_KEY, verifyRelease } from "../../packages/release/src";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const APP_DIR = join(REPO_ROOT, "apps", "paperboard");
export const ORIGAMI_DIR = join(REPO_ROOT, "services", "origami");
export const ORIGAMI_URL = process.env.ORIGAMI_URL || "https://origami.ariapis.com";

// the app and the server always release under the app's version
export const version = (
    JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")) as {
        version: string;
    }
).version;

export function cancelled(): never {
    p.cancel("Cancelled — nothing was uploaded.");
    process.exit(0);
}

export function checkCancel<T>(v: T | symbol): T {
    if (p.isCancel(v)) cancelled();
    return v as T;
}

// Ends the run at once. Never inside a try with a finally that cleans up:
// exiting skips it, so throw there instead.
export function fail(msg: string): never {
    p.cancel(msg);
    process.exit(1);
}

export const hex = (b: ArrayBuffer) =>
    Array.from(new Uint8Array(b))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");

export const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

// Run a command. Loud (inherited stdio) for long builds so their own
// progress shows; quiet (captured) for plumbing where only the exit code
// and output matter. argv arrays only — never a shell string.
export async function sh(
    cmd: string[],
    opts: { cwd?: string; quiet?: boolean; interactive?: boolean } = {},
): Promise<string> {
    const quiet = opts.quiet ?? false;
    const proc = Bun.spawn(cmd, {
        cwd: opts.cwd ?? APP_DIR,
        // interactive commands (npm's sign-in) need the terminal's stdin
        stdin: opts.interactive ? "inherit" : "ignore",
        stdout: quiet ? "pipe" : "inherit",
        stderr: quiet ? "pipe" : "inherit",
    });
    const out = quiet && proc.stdout ? await new Response(proc.stdout).text() : "";
    const errText =
        quiet && proc.stderr ? await new Response(proc.stderr).text() : "";
    const code = await proc.exited;
    if (code !== 0) {
        throw new Error(
            `\`${cmd.join(" ")}\` exited ${code}${errText.trim() ? `\n${errText.trim()}` : ""}`,
        );
    }
    return out.trim();
}

export async function cmdOk(cmd: string[], cwd?: string): Promise<boolean> {
    try {
        const code = await Bun.spawn(cmd, {
            cwd: cwd ?? APP_DIR,
            stdout: "ignore",
            stderr: "ignore",
        }).exited;
        return code === 0;
    } catch (err) {
        // Spawn itself failed (binary missing, not a non-zero exit):
        // false is the honest answer, and the trace stays in the log.
        console.debug(`probe ${cmd[0]} unavailable:`, String(err));
        return false;
    }
}

export async function hashFile(
    path: string,
): Promise<{ sha256: string; sha512: string; size: number }> {
    const bytes = await Bun.file(path).arrayBuffer();
    const [sha256, sha512] = await Promise.all([
        crypto.subtle.digest("SHA-256", bytes).then(hex),
        crypto.subtle.digest("SHA-512", bytes).then(hex),
    ]);
    return { sha256, sha512, size: bytes.byteLength };
}

export function printTable(rows: string[][]): void {
    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    for (const r of rows) {
        console.log(
            `  ${r.map((c, i) => c.padEnd(widths[i])).join("   ")}`,
        );
    }
}

export function bar(total: number): SingleBar {
    const b = new SingleBar(
        { format: "  {bar} {percentage}% | {value}/{total} | {task}" },
        Presets.shades_classic,
    );
    b.start(total, 0, { task: "" });
    return b;
}

// signs one release fact and proves the signature verifies against the
// public key clients ship with, before anything uploads
export function signVerified(key: KeyObject, msg: Buffer, what: string): string {
    const signature = signRelease(key, msg);
    if (!verifyRelease(msg, signature, RELEASE_PUBLIC_KEY)) {
        fail(`The release key does not match RELEASE_PUBLIC_KEY in packages/release/src/signature.ts; refusing to publish ${what}.`);
    }
    return signature;
}
