import { putRecord, type CommandRunner } from "./kv";
import type { PackageRecord } from "./records";

export interface UpdateOutcome {
    written: string[];
    errors: Record<string, string>;
}

/**
 * Writes every built record; a failed build or write is reported and the
 * run exits non-zero. Records that built cleanly are still written — one
 * bad Java feature release must not freeze the others.
 */
export async function writeRecords(
    built: { key: string; record?: PackageRecord; error?: string }[],
    opts: { dryRun: boolean; run?: CommandRunner },
): Promise<UpdateOutcome> {
    const outcome: UpdateOutcome = { written: [], errors: {} };
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
            await putRecord(record, opts.run);
            outcome.written.push(key);
        } catch (err) {
            outcome.errors[key] = err instanceof Error ? err.message : String(err);
        }
    }
    return outcome;
}

export function report(outcome: UpdateOutcome, dryRun: boolean): number {
    const verb = dryRun ? "would write" : "wrote";
    for (const key of outcome.written) console.log(`${verb} ${key}`);
    for (const [key, message] of Object.entries(outcome.errors)) {
        console.error(`FAILED ${key}: ${message}`);
    }
    return Object.keys(outcome.errors).length > 0 ? 1 : 0;
}
