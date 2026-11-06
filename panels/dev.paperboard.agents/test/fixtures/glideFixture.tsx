// The onboarding's centered column (its own CSS) with a speaker over a
// step's content: when the content goes or comes, the column re-centers,
// and the speaker must be drawn where it was on that frame, then end up
// in its new place. Results are base64 JSON in #results.
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import "../../src/tokens.css";
import styles from "../../src/onboarding/Onboarding.module.css";
import { glideWhenRecentered } from "../../src/onboarding/glide";

const out = { checks: {} as Record<string, unknown>, error: "" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// a glide is played to its end rather than waited out
const finishGlide = async () => {
    const running = speaker.getAnimations();
    for (const glide of running) glide.finish();
    await sleep(50);
    return running.length > 0;
};
const publish = () => (document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify(out))}`);

const app = document.getElementById("app")!;
app.style.cssText = "display:flex;flex-direction:column;height:600px";
const flow = document.createElement("div");
flow.className = styles.flow!;
const above = document.createElement("div");
above.className = styles.above!;
const speaker = document.createElement("div");
speaker.className = styles.speaker!;
speaker.style.height = "64px";
const content = document.createElement("div");
content.style.height = "200px";
const below = document.createElement("div");
below.className = styles.below!;
flow.append(above, speaker, content, below);
app.append(flow);

// where the speaker is drawn on the frame the column re-centers: read in an
// observer made after the glide's, so it runs after it in the same frame
function drawnWhenRecentered(change: () => void): Promise<number> {
    return new Promise((resolve) => {
        const seen = new ResizeObserver(() => {
            seen.disconnect();
            resolve(speaker.getBoundingClientRect().bottom);
        });
        change();
        seen.observe(above);
    });
}

async function run() {
    const stop = glideWhenRecentered(above, () => speaker);
    await sleep(100);

    const before = speaker.getBoundingClientRect().bottom;
    const drawnGoing = await drawnWhenRecentered(() => content.remove());
    out.checks.stillWhereItWas = Math.abs(drawnGoing - before) < 2;
    out.checks.glidesDown = await finishGlide();
    const settled = speaker.getBoundingClientRect().bottom;
    out.checks.movedDown = settled - before > 50;
    out.checks.settledInPlace = Math.abs(settled - (speaker.offsetTop + speaker.offsetHeight)) < 1;

    const drawnComing = await drawnWhenRecentered(() => speaker.after(content));
    out.checks.stillWhereItWasBack = Math.abs(drawnComing - settled) < 2;
    out.checks.glidesBack = await finishGlide();
    out.checks.backInPlace = Math.abs(speaker.getBoundingClientRect().bottom - before) < 1;

    stop();
}

run()
    .catch((err) => (out.error = String(err?.stack ?? err)))
    .finally(publish);
