// The untyped page-to-service calls (serviceApi, createPanelBridge's call,
// calls and on, and a service's `calls` without a contract) stay only until
// Game Server and Agents use their contracts; then they are removed. Nothing
// new may adopt them: a file not listed here that uses them fails, and a
// listed file that has moved onto its contract must leave the list.
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

const STILL_UNTYPED = [
    "apps/paperboard/dev/api-demo/src/panel.ts",
    "apps/paperboard/dev/widget-demo/src/panel.ts",
    "apps/paperboard/dev/widget-demo/src/widgets.ts",
    "packages/testkit/src/panels.ts",
    "apps/paperboard/tests/shell/support/problems-panel/src/panel.ts",
    "apps/paperboard/tests/shell/support/problems-panel/src/service.ts",
    "panels/dev.paperboard.actions/src/projects/state.ts",
    "panels/dev.paperboard.actions/src/widgets.tsx",
    "panels/dev.paperboard.actions/test/fixtures/canvasSyncApi.ts",
    "panels/dev.paperboard.ai/src/lib/state.ts",
    "panels/dev.paperboard.ai/src/widget/state.ts",
];

// PaperAPI itself and its docs name them to define and deprecate them
const OWNERS = /^(packages\/paperapi|apps\/paperdocs)\//;
const UNTYPED = /\b(serviceApi|createPanelBridge|untypedCalls)\b/;

function untyped(source: string): boolean {
    if (UNTYPED.test(source)) return true;
    // a service with calls and no contract declares them untyped
    return /\bdefinePanelService\(/.test(source) && /\bcalls:/.test(source) && !/\bcontract:/.test(source);
}

test("nothing new reaches a service by untyped calls", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter((file) => file && !OWNERS.test(file));
    const found = files.filter((file) => {
        try {
            return untyped(readFileSync(join(ROOT, file), "utf8"));
        } catch (err) {
            // a file git lists but this checkout deleted is not a user
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw err;
        }
    });
    expect(found.sort()).toEqual([...STILL_UNTYPED].sort());
});
