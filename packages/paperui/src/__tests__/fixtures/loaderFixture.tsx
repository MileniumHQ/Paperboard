// Real-browser fixture for PaperLoader (loader.browser.test.ts).
//
// jsdom runs no CSS animations, so only a browser shows that a loader eases
// in when it appears instead of popping onto the page.
import { render } from "solid-js/web";
import { PaperLoader } from "../../index";
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
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run(): Promise<void> {
    const app = document.getElementById("app")!;
    render(() => (
        <>
            <PaperLoader id="delayed" loaderStatus="indeterminate" delay={50} label="Loading servers" />
            <PaperLoader id="waiting" loaderStatus="waiting" label="Waiting" />
        </>
    ), app);
    await wait(80);
    const delayed = document.getElementById("delayed")!;
    // the entrance's first keyframe, read from the running animation
    const entrance = delayed.getAnimations().find((animation) => animation instanceof CSSAnimation);
    out.checks.delayedEntrance = entrance ? (entrance as CSSAnimation).animationName : "";
    const first = (entrance?.effect as KeyframeEffect | undefined)?.getKeyframes()[0];
    out.checks.startsHidden = first?.opacity === "0";
    // headless Chrome's virtual time does not tick CSS animations, so jump
    // each to its end and read where it settles
    const settle = (element: HTMLElement) => {
        element.getAnimations().forEach((animation) => animation.effect?.getTiming().iterations !== Infinity && animation.finish());
        return getComputedStyle(element).opacity;
    };
    out.checks.settledOpacity = settle(delayed);
    out.checks.waitingOpacity = settle(document.getElementById("waiting")!);

    document.documentElement.dataset.paperuiMotion = "reduced";
    render(() => <PaperLoader id="reduced" loaderStatus="indeterminate" label="Reduced" />, app);
    await wait(30);
    // virtual time never ticks even a near-zero animation, so read its length
    out.checks.reducedDuration = parseFloat(getComputedStyle(document.getElementById("reduced")!).animationDuration);
}

run()
    .catch((err) => {
        out.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    })
    .finally(report);
