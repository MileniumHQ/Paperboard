// Store listing check: a panel's manifest `store` block, and every file it
// names, pass the same validation the publisher runs before an upload. A
// listing the registry would refuse fails the panel's gate, not its publish.
//
// Usage: bun scripts/gate/check-store-listing.ts <panel dir>...
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { storeUploadParts } from "../publish/publishLib";

const dirs = process.argv.slice(2);
if (!dirs.length) {
    console.error("usage: check-store-listing.ts <panel dir>...");
    process.exit(2);
}

let failed = false;
for (const arg of dirs) {
    const dir = resolve(arg);
    try {
        const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
        storeUploadParts(manifest.store, (rel) => readFileSync(join(dir, rel)));
    } catch (err) {
        console.error(`FAIL: ${arg} store listing: ${err instanceof Error ? err.message : String(err)}`);
        failed = true;
    }
}
process.exit(failed ? 1 : 0);
