// The KV version record holds every release ever published. Publishing reads
// it, merges the new version in and writes it back, so an unreadable record
// must stop the publish: written over, every earlier version is gone. These
// run the real read-merge-write against a fake `wrangler` on PATH.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLOUD = join(import.meta.dir, "cloud.ts");
const LIB = join(import.meta.dir, "publishLib.ts");

// list/get answer from files; put records its args and the value file it was handed
const FAKE_WRANGLER = `#!/bin/sh
dir="$(dirname "$0")"
case "$1 $2 $3" in
  "--version  ") exit 0 ;;
  "kv key list") cat "$dir/listed.json" ;;
  "kv key get") cat "$dir/record.json" ;;
  "kv key put")
    echo "$@" >> "$dir/put.log"
    while [ $# -gt 0 ]; do
      if [ "$1" = "--path" ]; then cp "$2" "$dir/put.json"; fi
      shift
    done ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`;

const dirs: string[] = [];
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function publishOver(record: string): Promise<{ code: number; stderr: string; bin: string }> {
    const bin = mkdtempSync(join(tmpdir(), "paperboard-kvrecord-"));
    dirs.push(bin);
    writeFileSync(join(bin, "wrangler"), FAKE_WRANGLER);
    chmodSync(join(bin, "wrangler"), 0o755);
    writeFileSync(join(bin, "listed.json"), JSON.stringify([{ name: "dl/pb" }]));
    writeFileSync(join(bin, "record.json"), record);
    const driver = join(bin, "driver.ts");
    writeFileSync(
        driver,
        `import { kvReadRecord, kvWriteRecord } from ${JSON.stringify(CLOUD)};
import { mergeVersionRecord } from ${JSON.stringify(LIB)};
const prev = await kvReadRecord("pb");
await kvWriteRecord("pb", mergeVersionRecord(prev, "9.9.9", [{ file: "new.AppImage", sha256: "${"c".repeat(64)}", size: 1 }]));
`,
    );
    const proc = Bun.spawn([process.execPath, driver], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { code, stderr, bin };
}

describe("publishing over the KV version record", () => {
    test.each([
        ["invalid JSON", "{not json"],
        ["the wrong shape", JSON.stringify({ versions: [] })],
    ])("a record holding %s stops the publish before anything is written", async (_label, record) => {
        const { code, bin } = await publishOver(record);
        expect(code).not.toBe(0);
        expect(existsSync(join(bin, "put.log"))).toBe(false);
    });

    test("a readable record keeps every earlier version and is written from a file", async () => {
        const old = { latest: "1.0.0", versions: { "1.0.0": { files: [{ file: "old.AppImage", sha256: "a".repeat(64), size: 1 }] } } };
        const { code, stderr, bin } = await publishOver(JSON.stringify(old));
        expect(stderr).toBe("");
        expect(code).toBe(0);
        const written = JSON.parse(readFileSync(join(bin, "put.json"), "utf8"));
        expect(Object.keys(written.versions).sort()).toEqual(["1.0.0", "9.9.9"]);
        expect(written.latest).toBe("9.9.9");
        // the value goes by --path, never as one argv string (128 KiB cap)
        expect(readFileSync(join(bin, "put.log"), "utf8")).not.toContain("old.AppImage");
    });
});
