// What is Paperboard's own stays out of a panel's reach: the registry merge,
// the store listing and the paint wait come from "@mileniumhq/paperapi/internal",
// which no panel imports, and the origins fetchPublic trusts are a test's
// setting alone, which no shipped code names (PaperAPI defines it, its docs
// describe it).
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as panelFacing from "../src/index";
import * as internalLists from "../src/internal";
import * as paint from "../src/paintReady";

const internal = { ...internalLists, ...paint };

const ROOT = join(import.meta.dir, "..", "..", "..");

function sources(): { file: string; text: string }[] {
    return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.ts", "*.tsx"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .flatMap((file) => {
            try {
                return [{ file, text: readFileSync(join(ROOT, file), "utf8") }];
            } catch (err) {
                // a file git lists but this checkout deleted is not a user
                if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
                throw err;
            }
        });
}

// a test, or a script only tests run
const isTest = (file: string) => /(^|\/)(tests?|__tests__)\//.test(file) || /\.test\.tsx?$/.test(file);

test("the panel-facing index has none of the internal subpath's exports", () => {
    const leaked = Object.keys(internal).filter((name) => Object.hasOwn(panelFacing, name));
    expect(leaked).toEqual([]);
    expect(Object.keys(internal)).toContain("mergeRegistryWithInstalled");
    expect(Object.keys(internal)).toContain("loadInstalledPanelMedia");
    expect(Object.keys(internal)).toContain("waitForContentPainted");
});

test("no panel imports the internal subpath", () => {
    const panels = sources().filter(({ file, text }) => /^(panels|packages\/create-panel)\//.test(file) && text.includes("@mileniumhq/paperapi/internal"));
    // (the paint wait's subpath, /internal/paint, is under it too)
    expect(panels.map(({ file }) => file)).toEqual([]);
});

test("only tests name the origins fetchPublic trusts", () => {
    const shipped = sources().filter(({ file, text }) =>
        !isTest(file) && file !== "packages/paperapi/src/net.ts" && !file.startsWith("apps/paperdocs/") && /PAPERAPI_TEST_TRUSTED_ORIGINS|TEST_TRUSTED_ORIGINS_ENV|trustedOrigins/.test(text));
    expect(shipped.map(({ file }) => file)).toEqual([]);
});
