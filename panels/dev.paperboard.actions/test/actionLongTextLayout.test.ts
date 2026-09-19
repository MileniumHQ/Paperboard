// Long-value layout contract for the action block (real browser).
//
// The editable pills are inline-flex with a fixed height and no overflow-wrap,
// so a long value either refuses to shrink (the card scrolls horizontally
// past its 30rem cap) or wraps to more lines than the pill box allows
// (vertical spill over the options/header rows). No jsdom suite can catch
// this: it has no layout engine, and "the class is present" is not the
// contract. This test lays the real panel stylesheet out in headless Chrome
// and fails if any action/pill overflows its box.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const panelDir = resolve(import.meta.dir, "..");
const repoRoot = resolve(panelDir, "..", "..");
const paperStylesDir = resolve(repoRoot, "packages/paperui/src/styles");

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

function readStyle(name: string): string {
    return readFileSync(join(paperStylesDir, name), "utf8");
}

// Rebuild the exact cascade the panel ships: PaperUI tokens/rules followed by
// the panel stylesheet. @import lines are resolved here so the fixture does not
// depend on a build or on the font files being present.
function fixtureCss(): string {
    const styles = readStyle("styles.css").replace(/^\s*@import\s+[^;]+;\s*$/gm, "");
    const panel = readFileSync(join(panelDir, "src/style.css"), "utf8");
    return [readStyle("colors.css"), readStyle("effects.css"), readStyle("rules.css"), styles, panel].join(
        "\n",
    );
}

const LONG_WORDS = "kkadasdkldkaLDKLADKLADkaldkladKLADKLADKASLdkiasdkLADEND";
const LONG_SENTENCE = "kkad asdkld kaLD KLA DKLAD kald klad kLA DKLAD KASLd kiasd kLAD END";

function fixtureHtml(): string {
    const editable = (text: string) =>
        `<span class="actionInput actionEditable" contenteditable="true">${text}</span>`;
    const chip =
        '<span class="actionVariableChip" contenteditable="false"><span class="chipIcon">p</span><span class="chipLabel">Username</span></span>';
    const header = (name: string, value: string) => `
        <div class="case" data-name="${name}">
            <div class="action" style="flex-direction:column;align-items:stretch;gap:12px">
                <div class="PaperFlex actionHeaderRow" style="display:flex;flex-direction:row;align-items:center;gap:6px;width:100%">
                    <span class="actionHeaderIcon">i</span>
                    <span class="actionText" contenteditable="false">Send DM ${editable(value)} to ${editable("User")}</span>
                </div>
            </div>
        </div>`;
    const options = (name: string, value: string) => `
        <div class="case" data-name="${name}">
            <div class="action" style="flex-direction:column;align-items:stretch;gap:12px">
                <div class="PaperFlex actionHeaderRow" style="display:flex;flex-direction:row;align-items:center;gap:6px;width:100%">
                    <span class="actionHeaderIcon">i</span>
                    <span class="actionText" contenteditable="false">Send DM</span>
                </div>
                <div class="actionMoreOptions" style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;width:100%">
                    <div class="actionMoreOptionsRow" style="display:flex;flex-direction:row;align-items:center;gap:6px;width:100%">
                        <span style="flex:1;min-width:0;font-weight:500">Content</span>
                        ${editable(value)}
                    </div>
                </div>
            </div>
        </div>`;

    return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${fixtureCss()}</style>
</head>
<body class="paperui-root" style="padding:40px">
${header("header-word", LONG_WORDS)}
${header("header-sentence", LONG_SENTENCE)}
${options("options-word", LONG_WORDS)}
${options("options-sentence", LONG_SENTENCE)}
<div class="case" data-name="editable-chip">
    <div class="action" style="flex-direction:column;align-items:stretch;gap:12px">
        <div class="PaperFlex actionHeaderRow" style="display:flex;flex-direction:row;align-items:center;gap:6px;width:100%">
            <span class="actionHeaderIcon">i</span>
            <span class="actionText" contenteditable="false">Send DM ${editable(`${chip} hello`)} to ${editable("User")}</span>
        </div>
    </div>
</div>
<pre id="results"></pre>
<script>
    const out = {};
    document.querySelectorAll('.case').forEach((c) => {
        const action = c.querySelector('.action');
        const pill = c.querySelector('.actionEditable');
        out[c.dataset.name] = {
            actionOverflowX: Math.round(action.scrollWidth - action.clientWidth),
            pillOverflowX: Math.round(pill.scrollWidth - pill.clientWidth),
            pillOverflowY: Math.round(pill.scrollHeight - pill.clientHeight),
        };
        const chip = c.querySelector('.actionVariableChip');
        if (chip) {
            out[c.dataset.name].chipH = Math.round(chip.getBoundingClientRect().height);
            out[c.dataset.name].pillH = Math.round(pill.getBoundingClientRect().height);
        }
    });
    document.getElementById('results').textContent = 'RESULT:' + btoa(JSON.stringify(out));
</script>
</body></html>`;
}

interface CaseResult {
    actionOverflowX: number;
    pillOverflowX: number;
    pillOverflowY: number;
    chipH?: number;
    pillH?: number;
}

function measureInChrome(chrome: string): Record<string, CaseResult> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-actions-layout-"));
    const fixture = join(dir, "fixture.html");
    writeFileSync(fixture, fixtureHtml());
    try {
        const proc = Bun.spawnSync(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--hide-scrollbars",
                "--window-size=1280,800",
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
                `headless Chrome produced no measurement (exit ${proc.exitCode}): ${proc.stderr
                    .toString()
                    .slice(0, 400)}`,
            );
        }
        return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const chrome = findChrome();
const layoutTest = chrome ? test : test.skip;

describe("action long text layout", () => {
    layoutTest(
        chrome
            ? "long action values stay inside their card and pill (headless Chrome)"
            : "long action values stay inside their card and pill (skipped: no Chrome)",
        () => {
            if (!chrome) return;
            const results = measureInChrome(chrome);
            expect(Object.keys(results).length).toBe(5);
            for (const [name, r] of Object.entries(results)) {
                expect(r.actionOverflowX, `${name} card overflows horizontally`).toBeLessThanOrEqual(1);
                expect(r.pillOverflowX, `${name} pill content overflows horizontally`).toBeLessThanOrEqual(1);
                expect(r.pillOverflowY, `${name} pill content overflows vertically`).toBeLessThanOrEqual(1);
            }
            const chipCase = results["editable-chip"];
            expect(typeof chipCase?.pillH, "editable-chip pill missing").toBe("number");
            expect(typeof chipCase?.chipH, "editable-chip chip missing").toBe("number");
            expect(
                Math.abs((chipCase.pillH ?? 0) - (chipCase.chipH ?? 0)),
                "variable chip must fill the editable pill's line height",
            ).toBeLessThanOrEqual(1);
        },
    );
});
