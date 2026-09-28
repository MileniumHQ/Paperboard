// Behavior contract for ActionBlock's editable fields (real browser).
//
// The panel's own components are bundled with Vite (PaperUI aliased to a DOM
// stub) and mounted in headless Chrome; the fixture drives clicks, variable
// insertion, Backspace and Enter and reports what happened. This is the only
// harness that can prove the picker is requested on a chip click, that one
// Backspace removes a chip's invisible anchors with it, and that the builtin
// Text action alone gets a multiline field.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const panelDir = resolve(import.meta.dir, "..");

function findChrome(): string | null {
    const candidates = [
        process.env.PAPERBOARD_CHROME,
        process.env.CHROME_BIN,
        "google-chrome-stable",
        "google-chrome",
        "chromium",
        "chromium-browser",
    ].filter((c): c is string => Boolean(c));
    for (const candidate of candidates) {
        if (candidate.includes("/")) {
            if (existsSync(candidate)) return candidate;
            continue;
        }
        const found = Bun.which(candidate);
        if (found) return found;
    }
    return null;
}

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

async function buildFixture(outDir: string): Promise<void> {
    const { build } = await import("vite");
    const solidPlugin = (await import("vite-plugin-solid")).default;
    await build({
        root: panelDir,
        configFile: false,
        logLevel: "error",
        plugins: [solidPlugin()],
        resolve: {
            alias: {
                "@paperboard-dev/paperui": join(
                    panelDir,
                    "test/fixtures/paperuiStub.tsx",
                ),
            },
        },
        build: {
            outDir,
            emptyOutDir: true,
            minify: false,
            rollupOptions: {
                input: join(panelDir, "test/fixtures/actionBlockFixture.html"),
            },
            codeSplitting: false,
        },
    });
}

async function runFixture(chrome: string): Promise<FixtureResults> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-actions-behavior-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
        await buildFixture(dist);
        server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(request) {
                const url = new URL(request.url);
                const file = join(dist, url.pathname);
                if (!file.startsWith(dist + "/")) {
                    return new Response("not found", { status: 404 });
                }
                const blob = Bun.file(file);
                if (blob.size === 0) return new Response("not found", { status: 404 });
                return new Response(blob);
            },
        });
        // serve while Chrome runs: spawn must not block this event loop
        const proc = Bun.spawn(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--no-first-run",
                "--hide-scrollbars",
                "--window-size=1280,800",
                "--virtual-time-budget=8000",
                "--dump-dom",
                `http://127.0.0.1:${server.port}/test/fixtures/actionBlockFixture.html`,
            ],
            { stdout: "pipe", stderr: "pipe" },
        );
        const killTimer = setTimeout(() => proc.kill(), 60_000);
        const [dom, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        clearTimeout(killTimer);
        const match = dom.match(/RESULT:([A-Za-z0-9+/=]+)/);
        if (!match) {
            throw new Error(
                `headless Chrome produced no result (exit ${exitCode}): ${stderr.slice(0, 400)}`,
            );
        }
        return JSON.parse(
            Buffer.from(match[1], "base64").toString("utf8"),
        ) as FixtureResults;
    } finally {
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("action editable field behavior", () => {
    behaviorTest(
        chrome
            ? "the picker stays reachable, chips delete cleanly, and Text is the only multiline field (headless Chrome)"
            : "the picker stays reachable, chips delete cleanly, and Text is the only multiline field (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runFixture(chrome);
            expect(results.error, "the fixture threw").toBe("");
            const checks = results.checks;

            expect(checks.multilineFieldFound, "Text action field is not multiline").toBe(true);
            expect(checks.multilineEnterKeptFocus, "Enter blurred the multiline field").toBe(true);
            expect(
                checks.multilineAfterEnterDom,
                "Enter did not put a line break in the field",
            ).toContain("\\n");
            expect(
                checks.multilineCommittedValue,
                "the multiline value lost its line break",
            ).toBe("one\ntwo");

            expect(checks.joinFieldMultiline, "Join Text field must be single-line").toBe(false);
            expect(
                checks.lockedWrapWidth,
                "focus did not lock the field's footprint in the row",
            ).toMatch(/^[\d.]+px$/);
            expect(checks.singleLineEnterBlurred, "Enter must commit a single-line field").toBe(true);
            expect(checks.releasedWrapWidth, "blur left the row width locked").toBe("");

            expect(
                checks.pickerRequestsAfterFocus,
                "focusing the field did not request the picker",
            ).toBe(1);
            expect(
                checks.pickerRequestsAfterFieldClick,
                "a click must not request the picker twice",
            ).toBe(1);
            expect(checks.pickerAnchorIsField, "the picker was not anchored to its field").toBe(true);
            expect(checks.chipInserted, "inserting the variable produced no chip").toBe(true);
            expect(checks.chipCommittedValue).toBe("{{blk1:Username:person}}");
            expect(
                checks.pickerRequestsAfterChipClick,
                "clicking the chip did not request the picker",
            ).toBe(2);

            expect(checks.backspacePrevented, "the component ignored Backspace").toBe(true);
            expect(checks.chipRemoved, "one Backspace did not remove the chip").toBe(true);
            expect(
                checks.zeroWidthResidue,
                "invisible anchor characters survived the chip deletion",
            ).toBe(0);
            expect(checks.cleanCommittedValue).toBe("");
            expect(
                checks.selectionDeleteResidue,
                "deleting a selected chip stranded invisible anchor characters",
            ).toBe(0);

            expect(
                checks.clearableStartsUnselected,
                "a clearable options input did not start unselected",
            ).toBe(true);
            expect(
                checks.clearablePickerValues,
                "the picker did not offer the unselected entry first",
            ).toEqual([null, "qwen3:8b", "llama3:8b"]);
            expect(
                checks.clearableSelectedValue,
                "the unselected entry was not the picker's current value",
            ).toBe(true);
            expect(
                checks.clearableAnchorIsPill,
                "the option picker was not anchored to its pill",
            ).toBe(true);
            expect(checks.clearableChosenValue, "choosing an option did not set its value").toBe(
                "qwen3:8b",
            );
            expect(
                checks.clearableClearsToUndefined,
                "choosing the empty entry did not clear the value",
            ).toBe(true);
            expect(
                checks.clearableBackToEmptyLabel,
                "the pill did not return to its empty label after clearing",
            ).toBe(true);
            expect(
                checks.plainOptionsDefault,
                "a non-clearable options input stopped defaulting to its first option",
            ).toBe(true);

            expect(
                checks.anchorPointerDownCloseCalls,
                "pointerdown inside the picker's field closed the menu",
            ).toBe(0);
            expect(
                checks.outsidePointerDownCloseCalls,
                "pointerdown outside the menu did not close it",
            ).toBe(1);
        },
        60_000,
    );
});
