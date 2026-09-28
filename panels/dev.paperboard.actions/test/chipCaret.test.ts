// Caret contract for inline variable chips (real browser).
//
// Inserting a variable used to jump the caret to the start of the field:
// the commit pass re-assigned innerHTML while the field was focused, which
// detached the selection nodes. This test bundles the real richText module,
// runs it in headless Chrome, and proves that (a) the caret stays after the
// inserted chip (typing appends there), and (b) a blurred commit still
// rebuilds chips. Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or
// PATH; without it the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

interface CaretResults {
    afterInsert: string;
    stillFocused: boolean;
    rebuiltBlurred: number;
    appended: string;
    error: string;
}

async function bundleRichText(dir: string): Promise<string> {
    // Bun's globalName option does not assign named exports, so the entry
    // exports the module onto globalThis explicitly
    const entry = join(dir, "richText-entry.ts");
    writeFileSync(
        entry,
        `import * as RichText from ${JSON.stringify(join(panelDir, "src/lib/richText.ts"))};\n(globalThis as any).RichText = RichText;\n`,
    );
    const result = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        format: "iife",
        minify: false,
    });
    if (!result.success || result.outputs.length === 0) {
        throw new Error("failed to bundle richText.ts for the caret test");
    }
    return await result.outputs[0].text();
}

function fixtureHtml(bundle: string): string {
    return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<span id="field" class="actionInput actionEditable" contenteditable="true"></span>
<span id="empty" class="actionInput actionEditable" contenteditable="true"></span>
<pre id="results"></pre>
<script>${bundle}</script>
<script>
    const out = { error: "" };
    try {
        const span = document.getElementById('field');
        span.innerHTML = RichText.renderHtmlWithChips('hello ');
        span.focus({ preventScroll: true });
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(span);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        RichText.insertVariableChip(span, selection.getRangeAt(0), {
            varId: 'blk1',
            label: 'Username',
            icon: 'person',
        });
        // the component's commit path while focused
        RichText.commitEditableDom(span, RichText.extractTextWithVariables(span), {
            focused: document.activeElement === span,
        });
        out.stillFocused = document.activeElement === span;
        document.execCommand('insertText', false, '!');
        out.afterInsert = RichText.extractTextWithVariables(span);

        // blurred commit still rebuilds chips from a raw value
        const off = document.createElement('span');
        off.textContent = 'a {{blk1:Username:person}} b';
        RichText.commitEditableDom(off, 'a {{blk1:Username:person}} b', { focused: false });
        out.rebuiltBlurred = off.querySelectorAll('.actionVariableChip').length;

        // the no-range path appends a chip and leaves the caret after it
        const empty = document.getElementById('empty');
        RichText.appendVariableChip(empty, {
            varId: 'blk2',
            label: 'Count',
            icon: 'tag',
        });
        document.execCommand('insertText', false, 'z');
        out.appended = RichText.extractTextWithVariables(empty);
    } catch (err) {
        out.error = String(err);
    }
    document.getElementById('results').textContent = 'RESULT:' + btoa(JSON.stringify(out));
</script>
</body></html>`;
}

const chrome = findChrome();
const caretTest = chrome ? test : test.skip;

describe("variable chip caret", () => {
    caretTest(
        chrome
            ? "inserting a variable keeps the caret after the chip (headless Chrome)"
            : "inserting a variable keeps the caret after the chip (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const dir = mkdtempSync(join(tmpdir(), "paperboard-actions-caret-"));
            const fixture = join(dir, "fixture.html");
            try {
                const bundle = await bundleRichText(dir);
                writeFileSync(fixture, fixtureHtml(bundle));
                const proc = Bun.spawnSync(
                    [
                        chrome,
                        "--headless=new",
                        "--disable-gpu",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--hide-scrollbars",
                        "--virtual-time-budget=3000",
                        "--dump-dom",
                        `file://${fixture}`,
                    ],
                    { stdout: "pipe", stderr: "pipe", timeout: 60_000 },
                );
                const dom = proc.stdout.toString();
                const match = dom.match(/RESULT:([A-Za-z0-9+/=]+)/);
                if (!match) {
                    throw new Error(
                        `headless Chrome produced no result (exit ${proc.exitCode}): ${proc.stderr
                            .toString()
                            .slice(0, 400)}`,
                    );
                }
                const results = JSON.parse(
                    Buffer.from(match[1], "base64").toString("utf8"),
                ) as CaretResults;
                expect(results.error).toBe("");
                expect(results.stillFocused).toBe(true);
                expect(results.afterInsert).toContain("{{blk1:Username:person}}");
                expect(
                    results.afterInsert,
                    `typed character landed at ${results.afterInsert}`,
                ).toBe("hello {{blk1:Username:person}}!");
                expect(results.rebuiltBlurred).toBe(1);
                expect(results.appended).toBe("{{blk2:Count:tag}}z");
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
        // a cold headless Chrome on a CI runner takes several seconds to start
        65_000,
    );
});
