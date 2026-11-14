import { expect, test } from "bun:test";
import { join } from "node:path";

// A subcommand publish.ts does not have (a typo, or a script naming a flow
// that is gone) says so, instead of opening the publisher menu.
test("publish.ts refuses an unknown subcommand by name", () => {
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "publish.ts"), "ci-buld"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    expect(run.stderr.toString()).toContain('unknown subcommand "ci-buld"');
    expect(run.exitCode).toBe(2);
});
