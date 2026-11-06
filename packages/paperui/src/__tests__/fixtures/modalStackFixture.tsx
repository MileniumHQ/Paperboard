// Real-browser fixture for a modal opened over another (modalStack.browser.test.ts).
//
// Each modal brought its own scrim, so a second one dimmed and blurred the page
// twice, with the first dialog still showing under it. The page is dimmed once:
// the modal underneath steps back out of sight and comes forward again when the
// one over it closes. jsdom computes no styles from the stylesheet, so it cannot see this.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperModal } from "../../index";
import "../../styles/styles.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };
const [first, setFirst] = createSignal(false);
const [second, setSecond] = createSignal(false);

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

// the harness runs on virtual time, which moves timers but not animations: each wait ends them
const wait = async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    for (const animation of document.getAnimations()) animation.finish();
};
const dialog = (title: string) => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) => d.textContent?.includes(title))!;
const backdrop = (title: string) => dialog(title).parentElement!;

function Fixture() {
    return (
        <div>
            <PaperModal open={first()} onClose={() => setFirst(false)} title="Choose one">
                <p>First</p>
            </PaperModal>
            <PaperModal open={second()} onClose={() => setSecond(false)} title="Name it">
                <p>Second</p>
            </PaperModal>
        </div>
    );
}

async function run(): Promise<void> {
    setFirst(true);
    await wait(400);
    const scrim = getComputedStyle(backdrop("Choose one")).backgroundColor;
    out.checks.firstDims = scrim !== "rgba(0, 0, 0, 0)";

    setSecond(true);
    await wait(400);
    const top = getComputedStyle(backdrop("Name it"));
    out.checks.secondAddsNoScrim = top.backgroundColor === "rgba(0, 0, 0, 0)" && (top.backdropFilter === "none" || top.backdropFilter === "");
    out.checks.firstStillDims = getComputedStyle(backdrop("Choose one")).backgroundColor === scrim;
    out.checks.firstSteppedBack = getComputedStyle(dialog("Choose one")).opacity === "0" && getComputedStyle(backdrop("Choose one")).pointerEvents === "none";
    out.checks.secondShown = getComputedStyle(dialog("Name it")).opacity === "1";

    // Escape closes the one on top; the first comes forward again
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wait(400);
    out.checks.secondClosed = !second() && first();
    out.checks.firstForward = getComputedStyle(dialog("Choose one")).opacity === "1" && getComputedStyle(backdrop("Choose one")).pointerEvents !== "none";
}

try {
    render(() => <Fixture />, document.getElementById("app") as HTMLElement);
    setTimeout(() => {
        run()
            .then(report)
            .catch((err: unknown) => {
                out.error = err instanceof Error ? err.stack ?? err.message : String(err);
                report();
            });
    }, 0);
} catch (err) {
    out.error = err instanceof Error ? err.stack ?? err.message : String(err);
    report();
}
