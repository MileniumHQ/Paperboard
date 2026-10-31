// Real-browser fixture for the icon font gate (iconFont.browser.test.ts).
//
// Icons are ligatures in the icon font. A fresh document that paints before
// the font loads shows every icon blank, then shifts each row as the glyphs
// land. jsdom loads no fonts, so only a real browser can see it.
import { render } from "solid-js/web";
import { PaperIcon, PaperProvider } from "../../index";
import "../../styles/styles.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };
const ICON_FONT = '1em "Material Symbols Rounded"';

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

// a short timer, not requestAnimationFrame: under --virtual-time-budget
// animation frames never fire
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 4));

async function start(): Promise<void> {
    out.checks.loadedBeforeRender = document.fonts.check(ICON_FONT);
    render(
        () => (
            <PaperProvider>
                <PaperIcon>home</PaperIcon>
            </PaperProvider>
        ),
        document.getElementById("app") as HTMLElement,
    );
    const root = document.querySelector<HTMLElement>(".paperui-root")!;
    // from the render on, before the first paint and every few ms after:
    // was the provider on screen, and was the font there
    const blankFrames: number[] = [];
    let shownAt = -1;
    for (let i = 0; i < 500 && shownAt < 0; i++) {
        if (i > 0) await tick();
        const visible = getComputedStyle(root).opacity !== "0";
        if (visible && !document.fonts.check(ICON_FONT)) blankFrames.push(i);
        if (visible && document.fonts.check(ICON_FONT)) shownAt = i;
    }
    out.checks.blankFrames = blankFrames;
    out.checks.shown = shownAt >= 0;
}

start()
    .catch((err) => {
        out.error = err instanceof Error ? err.stack ?? err.message : String(err);
    })
    .finally(report);
