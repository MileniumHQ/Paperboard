// Layout contract for the action block's editable fields (real browser).
//
// Single-line pills are capped at a short width and ellipsize while blurred;
// editing one pops it out of the flow (position: absolute) so it grows to the
// side of the card instead of widening the flow. The builtin Text action's
// multiline field is the one exception: it is a wrapping full-width block
// that grows downwards inside the card. Wrapping a single-line pill used to
// grow the card and shove the options and footer rows around; "the class is
// present" cannot catch that, and jsdom has no layout engine, so this test
// lays the real panel stylesheet out in headless Chrome.
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

// the blurred single-line cap: min(12rem, 100%) at the default 16px root
const BLURRED_CAP_PX = 12 * 16 + 4;

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
        `<span class="actionEditableWrap"><span class="actionInput actionEditable" contenteditable="true">${text}</span></span>`;
    const multiline = (text: string) =>
        `<span class="actionEditableWrap isMultiline"><span class="actionInput actionEditable actionEditableMultiline" contenteditable="true">${text}</span></span>`;
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
                        <span class="optionLabel" style="flex:1;min-width:0;font-weight:500">Content</span>
                        ${editable(value)}
                    </div>
                </div>
            </div>
        </div>`;
    const multilineCase = (name: string, value: string) => `
        <div class="case" data-name="${name}">
            <div class="action" style="flex-direction:column;align-items:stretch;gap:12px">
                <div class="PaperFlex actionHeaderRow" style="display:flex;flex-direction:row;align-items:center;gap:6px;width:100%">
                    <span class="actionHeaderIcon">i</span>
                    <span class="actionText" contenteditable="false">Text</span>
                </div>
                <div class="actionMultilineRow" style="width:100%">${multiline(value)}</div>
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
${multilineCase("multiline-text", LONG_SENTENCE)}
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
    const out = { cases: {}, focusError: "" };
    const pillsOf = (c) => [...c.querySelectorAll('.actionEditable')];
    // subpixel layout can leave a fraction of a pixel between client and
    // scroll width; a clipped value is off by hundreds, so 2px is still a
    // strict contract
    const clipped = (pill) => pill.scrollWidth > pill.clientWidth + 2;
    const measure = (pill) => {
        const rect = pill.getBoundingClientRect();
        return {
            h: Math.round(rect.height),
            overflowY: Math.round(pill.scrollHeight - pill.clientHeight),
            clipped: clipped(pill),
            client: pill.clientWidth,
            scroll: pill.scrollWidth,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            position: getComputedStyle(pill).position,
            wrapLeft: Math.round(pill.parentElement.getBoundingClientRect().left),
            wrapWidth: Math.round(pill.parentElement.getBoundingClientRect().width),
        };
    };
    const measureCard = (action) => ({
        w: action.clientWidth,
        overflowX: Math.round(action.scrollWidth - action.clientWidth),
        right: Math.round(action.getBoundingClientRect().right),
        bottom: Math.round(action.getBoundingClientRect().bottom),
    });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // headless Chrome's document focus is racy at startup, and :focus styles
    // do not apply to an unfocused document even when activeElement is set.
    // Wait for the document to gain focus (virtual time drives the timers)
    // instead of measuring a layout the user never sees.
    const waitForDocumentFocus = async () => {
        for (let i = 0; i < 100; i++) {
            if (document.hasFocus()) return true;
            await sleep(8);
        }
        return document.hasFocus();
    };
    const finish = () => {
        document.getElementById('results').textContent = 'RESULT:' + btoa(JSON.stringify(out));
    };
    const run = async () => {
        for (const c of document.querySelectorAll('.case')) {
            const action = c.querySelector('.action');
            out.cases[c.dataset.name] = {
                blurredCard: measureCard(action),
                blurred: pillsOf(c).map(measure),
            };
            const label = c.querySelector('.optionLabel');
            if (label) {
                const r = label.getBoundingClientRect();
                out.cases[c.dataset.name].labelCenter = Math.round((r.top + r.bottom) / 2);
            }
            const chip = c.querySelector('.actionVariableChip');
            if (chip) {
                const chipRect = chip.getBoundingClientRect();
                const pillRect = c.querySelector('.actionEditable').getBoundingClientRect();
                out.cases[c.dataset.name].chip = {
                    h: Math.round(chipRect.height),
                    topGap: Math.round(chipRect.top - pillRect.top),
                    bottomGap: Math.round(pillRect.bottom - chipRect.bottom),
                };
            }
        }
        if (!(await waitForDocumentFocus())) {
            throw new Error('the document never gained focus');
        }
        // editing pass: focus each pill and re-measure the layout
        for (const c of document.querySelectorAll('.case')) {
            const action = c.querySelector('.action');
            const focusedAll = [];
            for (const pill of pillsOf(c)) {
                const wrap = pill.parentElement;
                const isMultiline = wrap.classList.contains('isMultiline');
                // the component locks the wrap at its blurred width on focus
                if (!isMultiline) wrap.style.width = wrap.getBoundingClientRect().width + 'px';
                pill.focus({ preventScroll: true });
                // force the :focus style/layout pass before measuring
                void document.body.offsetHeight;
                if (document.activeElement !== pill) {
                    throw new Error('focus did not land on the editable pill for ' + c.dataset.name);
                }
                const m = measure(pill);
                // typing a long value must not move anything in the row
                if (!isMultiline) {
                    const before = measureCard(action);
                    const wrapBefore = wrap.getBoundingClientRect().width;
                    const saved = pill.innerHTML;
                    pill.append(' and a much longer typed value that runs past the cap');
                    void document.body.offsetHeight;
                    const after = measureCard(action);
                    m.typedWrapDelta = Math.abs(wrap.getBoundingClientRect().width - wrapBefore);
                    m.typedCardDelta = Math.abs(after.w - before.w) + Math.abs(after.bottom - before.bottom);
                    pill.innerHTML = saved;
                }
                focusedAll.push(m);
                if (focusedAll.length === 1) {
                    out.cases[c.dataset.name].focusedCard = measureCard(action);
                }
                pill.blur();
                if (!isMultiline) wrap.style.width = '';
                void document.body.offsetHeight;
            }
            out.cases[c.dataset.name].focused = focusedAll[0];
            out.cases[c.dataset.name].focusedAll = focusedAll;
        }
    };
    run()
        .catch((err) => {
            out.focusError = String(err);
        })
        .finally(finish);
</script>
</body></html>`;
}

interface PillResult {
    h: number;
    overflowY: number;
    clipped: boolean;
    client: number;
    scroll: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    position: string;
    typedWrapDelta?: number;
    typedCardDelta?: number;
}

interface CardResult {
    w: number;
    overflowX: number;
    right: number;
    bottom: number;
}

interface CaseResult {
    blurredCard: CardResult;
    focusedCard: CardResult;
    blurred: PillResult[];
    focused: PillResult;
    focusedAll: PillResult[];
    labelCenter?: number;
    chip?: { h: number; topGap: number; bottomGap: number };
}

interface LayoutResults {
    cases: Record<string, CaseResult>;
    focusError: string;
}

function measureInChrome(chrome: string): LayoutResults {
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
                "--virtual-time-budget=5000",
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

describe("action input long-value layout", () => {
    layoutTest(
        chrome
            ? "single-line values ellipsize at a short cap and expand outside the card while editing (headless Chrome)"
            : "single-line values ellipsize at a short cap and expand outside the card while editing (skipped: no Chrome)",
        () => {
            if (!chrome) return;
            const results = measureInChrome(chrome);
            expect(results.focusError, "the fixture could not focus an editable pill").toBe("");
            const cases = results.cases;
            expect(Object.keys(cases).length).toBe(6);

            const singleLine = ["header-word", "header-sentence", "options-word", "options-sentence"];
            for (const name of singleLine) {
                const r = cases[name];
                expect(r, `${name} case missing`).toBeDefined();
                for (const [index, pill] of r.blurred.entries()) {
                    expect(pill.overflowY, `${name} pill ${index} wrapped while blurred`).toBeLessThanOrEqual(1);
                    expect(pill.h, `${name} pill ${index} is not one line while blurred`).toBeLessThanOrEqual(24);
                }
                // the long value is clipped earlier now: the pill must not
                // consume the card (or its own line) before ellipsizing
                expect(
                    r.blurred[0].client,
                    `${name} blurred pill is not capped short (client ${r.blurred[0].client})`,
                ).toBeLessThanOrEqual(BLURRED_CAP_PX);
                expect(
                    r.blurred[0].clipped,
                    `${name} long value was not ellipsized (client ${r.blurred[0].client}, scroll ${r.blurred[0].scroll})`,
                ).toBe(true);

                // editing keeps the pill in the row: fully visible, on one
                // line, and spilling past the card only beyond the cap
                expect(r.focused.position, `${name} focused pill floated out of the row`).not.toBe("absolute");
                expect(r.focused.overflowY, `${name} pill wrapped while focused`).toBeLessThanOrEqual(1);
                expect(r.focused.h, `${name} pill is not one line while focused`).toBeLessThanOrEqual(24);
                expect(
                    r.focused.clipped,
                    `${name} focused value stayed clipped (client ${r.focused.client}, scroll ${r.focused.scroll})`,
                ).toBe(false);
                expect(
                    r.focused.right,
                    `${name} focused pill did not expand past the card (pill ${r.focused.right}, card ${r.blurredCard.right})`,
                ).toBeGreaterThan(r.blurredCard.right);
                // it grows from its own place, not from the row's edge
                expect(
                    Math.abs(r.focused.left - r.blurred[0].left),
                    `${name} focused pill jumped (${r.blurred[0].left} -> ${r.focused.left})`,
                ).toBeLessThanOrEqual(2);
                // ...and the flow itself did not widen to make room
                expect(
                    r.focusedCard.w,
                    `${name} card widened while editing (${r.blurredCard.w} -> ${r.focusedCard.w})`,
                ).toBeLessThanOrEqual(r.blurredCard.w + 2);
                // ...nor shrank: a hidden long value must not have been
                // widening the blurred card in the first place
                expect(
                    r.focusedCard.w,
                    `${name} card width changed on focus (${r.blurredCard.w} -> ${r.focusedCard.w})`,
                ).toBeGreaterThanOrEqual(r.blurredCard.w - 2);
                expect(r.blurredCard.overflowX, `${name} card overflows horizontally`).toBeLessThanOrEqual(1);

                // every pill keeps at least its blurred box while focused:
                // no collapse, no vertical jump
                for (const [index, pill] of r.focusedAll.entries()) {
                    const blurred = r.blurred[index];
                    expect(
                        pill.right - pill.left,
                        `${name} pill ${index} shrank while focused (${blurred.right - blurred.left} -> ${pill.right - pill.left})`,
                    ).toBeGreaterThanOrEqual(blurred.right - blurred.left - 1);
                    expect(
                        Math.abs(pill.top - blurred.top),
                        `${name} pill ${index} moved vertically while focused (${blurred.top} -> ${pill.top})`,
                    ).toBeLessThanOrEqual(1);
                    expect(Math.abs(pill.left - blurred.left), `${name} pill ${index} jumped sideways`).toBeLessThanOrEqual(1);
                    // its footprint in the row stays the blurred one while typing
                    expect(pill.typedWrapDelta, `${name} pill ${index} footprint changed while typing`).toBeLessThanOrEqual(1);
                    expect(pill.typedCardDelta, `${name} card reflowed while typing in pill ${index}`).toBeLessThanOrEqual(1);
                }

                // a pill sits on its row's center line, like its label
                if (r.labelCenter !== undefined) {
                    const center = (r.blurred[0].top + r.blurred[0].bottom) / 2;
                    expect(
                        Math.abs(center - r.labelCenter),
                        `${name} pill is off its row's center (pill ${center}, label ${r.labelCenter})`,
                    ).toBeLessThanOrEqual(1);
                }
            }

            // the one multiline field wraps in place and grows downwards
            const multiline = cases["multiline-text"];
            expect(multiline, "multiline-text case missing").toBeDefined();
            expect(multiline.blurred[0].h, "multiline value did not wrap onto multiple lines").toBeGreaterThan(40);
            expect(multiline.blurred[0].overflowY, "multiline value is vertically clipped").toBeLessThanOrEqual(1);
            expect(multiline.blurred[0].clipped, "multiline value is horizontally clipped").toBe(false);
            expect(multiline.blurredCard.overflowX, "multiline card overflows horizontally").toBeLessThanOrEqual(1);
            expect(
                multiline.focused.position,
                "multiline field must stay in the flow while editing",
            ).not.toBe("absolute");
            expect(multiline.focused.h, "multiline field collapsed to one line while editing").toBeGreaterThan(40);

            // chips ride the pill's top edge, not shoved down into its border
            const chipCase = cases["editable-chip"];
            expect(typeof chipCase?.chip, "editable-chip chip missing").toBe("object");
            if (chipCase?.chip) {
                expect(
                    chipCase.chip.topGap,
                    `chip sits ${chipCase.chip.topGap}px below the pill's top edge`,
                ).toBeLessThanOrEqual(0);
                expect(
                    chipCase.chip.bottomGap,
                    `chip clips ${-chipCase.chip.bottomGap}px past the pill's bottom edge`,
                ).toBeGreaterThanOrEqual(0);
                expect(
                    Math.abs((chipCase.blurred[0].h ?? 0) - chipCase.chip.h),
                    "variable chip must fill the editable pill's line height",
                ).toBeLessThanOrEqual(1);
            }
        },
    );
});
