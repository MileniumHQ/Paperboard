// Real-browser fixture for PaperPresence (presence.browser.test.ts).
//
// jsdom runs no CSS animations, so only a browser shows that an element
// really animates in, stays mounted while it animates out, and leaves at
// once when motion is reduced.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperPresence } from "../../index";
import "../../styles/styles.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

// a short timer, not requestAnimationFrame: under --virtual-time-budget
// headless Chrome does not run animation frames
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const panel = () => document.getElementById("panel");

const [shown, setShown] = createSignal(false);

async function run(): Promise<void> {
    setShown(true);
    await nextFrame();
    const entering = panel();
    out.checks.enterAnimation = entering ? getComputedStyle(entering).animationName : "";
    await wait(600);
    // the preset's own (module-hashed) classes; the transition library keeps its s-* ones
    out.checks.enterClassesGone = !!panel() && !/_enter_|_slideEnd_/.test(panel()?.className ?? "");

    setShown(false);
    await nextFrame();
    out.checks.mountedWhileLeaving = !!panel();
    out.checks.exitDirection = panel() ? getComputedStyle(panel() as HTMLElement).animationDirection : "";
    await wait(600);
    out.checks.goneAfterLeaving = !panel();

    // Interrupt an enter without giving Chrome a rendering opportunity
    // between class removal and reapplication of the same keyframes. Exit
    // must own a fresh timeline, not inherit enter's elapsed time/end event.
    setShown(true);
    await Promise.resolve();
    const interruptedEnter = panel()?.getAnimations()[0];
    if (!interruptedEnter) throw new Error("interrupted enter had no CSS animation");
    interruptedEnter.currentTime = 150;
    setShown(false);
    const interruptedExit = panel()?.getAnimations()[0];
    out.checks.freshExitAnimation = !!interruptedExit && interruptedExit !== interruptedEnter;
    out.checks.exitStartsAtBeginning = interruptedExit?.currentTime === 0;
    await wait(600);
    out.checks.goneAfterInterruptedEnter = !panel();

    document.documentElement.dataset.paperuiMotion = "reduced";
    setShown(true);
    await nextFrame();
    setShown(false);
    await nextFrame();
    out.checks.reducedGoneAtOnce = !panel();
}

try {
    render(
        () => (
            <PaperPresence when={shown()} motion="slide-end">
                <div id="panel">panel</div>
            </PaperPresence>
        ),
        document.getElementById("app") as HTMLElement,
    );
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
