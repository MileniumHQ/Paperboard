// Real-browser fixture for button heights (buttonHeight.browser.test.ts).
//
// An icon glyph is larger than the label beside it, and its line box used to
// make a button with an icon taller than a text-only button of the same size,
// so the two never lined up in a row. jsdom loads no fonts and lays nothing
// out, so only a real browser can see it.
import { For, render } from "solid-js/web";
import { PaperButton, PaperIcon, type PaperButtonSize } from "../../index";
import "../../styles/styles.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };
const sizes: PaperButtonSize[] = ["tiny", "small", "medium", "large"];

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

function Fixture() {
    return (
        <div class="paperui-root" style={{ padding: "40px" }}>
            <For each={sizes}>
                {(size) => (
                    <div data-size={size} style={{ display: "flex", "align-items": "flex-start", gap: "8px" }}>
                        <PaperButton size={size}>Kick</PaperButton>
                        <PaperButton size={size} variant="danger"><PaperIcon>block</PaperIcon>Ban</PaperButton>
                        <PaperButton size={size} variant="text"><PaperIcon>download</PaperIcon>Download</PaperButton>
                        <PaperButton size={size}><PaperIcon>add</PaperIcon></PaperButton>
                    </div>
                )}
            </For>
        </div>
    );
}

// each size reports its buttons' heights: text, icon and label, text variant, icon alone
function run(): void {
    for (const row of document.querySelectorAll<HTMLElement>("[data-size]")) {
        out.checks[row.dataset.size!] = [...row.children].map((button) => Math.round(button.getBoundingClientRect().height));
    }
    const glyph = document.querySelector("[data-size=large] [class*=PaperIcon]")!.getBoundingClientRect();
    const button = document.querySelector("[data-size=large] button:nth-child(2)")!.getBoundingClientRect();
    // the glyph keeps its own size and stays centred on the label's line
    out.checks.glyphCentred = Math.abs(glyph.top + glyph.height / 2 - (button.top + button.height / 2)) <= 1;
}

async function start(): Promise<void> {
    render(() => <Fixture />, document.getElementById("app") as HTMLElement);
    await document.fonts.load('22px "Material Symbols Rounded"', "block");
    await document.fonts.ready;
    run();
}

start()
    .catch((err) => {
        out.error = err instanceof Error ? err.stack ?? err.message : String(err);
    })
    .finally(report);
