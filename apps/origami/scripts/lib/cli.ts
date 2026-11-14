import type { KeyObject } from "node:crypto";
import { putRecord, readPublished, type PublishedReader } from "./kv";
import type { CommandRunner } from "./wrangler";
import { loadReleaseSigningKey } from "../../../../scripts/releaseSigning";
import type { PackageRecord } from "./records";
import { messageOf } from "./errors";

export interface UpdateOutcome {
    written: string[];
    /** built cleanly and already served exactly as built: nothing written */
    unchanged: string[];
    errors: Record<string, string>;
}

/**
 * Writes every built record; a failed build or write is reported and the
 * run exits non-zero. Records that built cleanly are still written — one
 * bad Java feature release must not freeze the others.
 */
export async function writeRecords(
    built: { key: string; record?: PackageRecord; error?: string }[],
    opts: { dryRun: boolean; run?: CommandRunner; key?: KeyObject; publicKey?: string; published?: PublishedReader },
): Promise<UpdateOutcome> {
    const outcome: UpdateOutcome = { written: [], unchanged: [], errors: {} };
    // a real write needs the offline release key; a dry run signs nothing
    const signingKey = opts.dryRun ? undefined : (opts.key ?? loadReleaseSigningKey());
    for (const { key, record, error } of built) {
        if (!record) {
            outcome.errors[key] = error ?? "no record built";
            continue;
        }
        if (opts.dryRun) {
            console.log(`[dry-run] ${key}:\n${JSON.stringify(record, null, 2)}`);
            outcome.written.push(key);
            continue;
        }
        try {
            const result = await putRecord(record, signingKey!, opts.run, opts.publicKey, opts.published ?? readPublished);
            outcome[result].push(key);
        } catch (err) {
            outcome.errors[key] = messageOf(err);
        }
    }
    return outcome;
}

export function report(outcome: UpdateOutcome, dryRun: boolean): number {
    const verb = dryRun ? "would write" : "wrote";
    for (const key of outcome.written) console.log(`${verb} ${key}`);
    for (const key of outcome.unchanged) console.log(`unchanged ${key}`);
    for (const [key, message] of Object.entries(outcome.errors)) {
        console.error(`FAILED ${key}: ${message}`);
    }
    return Object.keys(outcome.errors).length > 0 ? 1 : 0;
}

export type BuiltEntry = { key: string; record?: PackageRecord; error?: string };

/** One record, or the failure that stopped it, keyed for writeRecords. */
export async function settle(key: string, build: () => Promise<PackageRecord>): Promise<BuiltEntry> {
    try {
        return { key, record: await build() };
    } catch (err) {
        return { key, error: messageOf(err) };
    }
}

/** Records built together: one failure fails every key, and a built record is keyed by its name. */
export async function settleAll(keys: string[], build: () => Promise<PackageRecord[]>): Promise<BuiltEntry[]> {
    try {
        return (await build()).map((record) => ({ key: record.name, record }));
    } catch (err) {
        const error = messageOf(err);
        return keys.map((key) => ({ key, error }));
    }
}

/** An updater's entry point: builds from argv, writes (or prints with --dry-run), and exits non-zero on any failure. */
export function runUpdater(build: (argv: string[]) => Promise<BuiltEntry[]>): void {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes("--dry-run");
    build(argv)
        .then((built) => writeRecords(built, { dryRun }))
        .then(
            (outcome) => process.exit(report(outcome, dryRun)),
            (err) => {
                console.error(messageOf(err));
                process.exit(1);
            },
        );
}
