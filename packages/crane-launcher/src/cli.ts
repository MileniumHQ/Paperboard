#!/usr/bin/env node
// npx @mileniumhq/paperboard <papercrane command and flags>
//
// Every argument goes to papercrane as is, so `npx @mileniumhq/paperboard
// serve --port 45465` is `papercrane serve --port 45465`. The launcher's
// own lines go to stderr, so `status --json` stays parseable.
import pkg from "../package.json";
import { DEFAULT_REGISTRY, ensureCrane, runCrane } from "./launcher";

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    // the same registry override the desktop app honours outside
    // production; the release key still decides what runs
    const registry = process.env.ORIGAMI_REGISTRY_URL || DEFAULT_REGISTRY;
    const crane = await ensureCrane({
        registry,
        minVersion: pkg.version,
        log: (line) => process.stderr.write(`${line}\n`),
    });
    return runCrane(crane.binary, args);
}

main().then(
    (code) => process.exit(code),
    (err) => {
        process.stderr.write(`paperboard: ${(err as Error)?.message || String(err)}\n`);
        process.exit(1);
    },
);
