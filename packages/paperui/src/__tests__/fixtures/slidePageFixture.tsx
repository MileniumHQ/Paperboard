import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider, PaperSlidePage } from "../../index";
import "../../styles/styles.css";

const [enabled, setEnabled] = createSignal(false);
const [open, setOpen] = createSignal(false);

const dispose = render(
    () => (
        <PaperProvider>
            <div style={{ position: "relative", width: "400px", height: "600px" }}>
                <PaperSlidePage enabled={enabled()} open={open()} title="Page" onBack={() => setOpen(false)}>
                    <p>content</p>
                </PaperSlidePage>
            </div>
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

// a short timer, not requestAnimationFrame: under --virtual-time-budget frames don't run
const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const moving = (page: Element) => page.getAnimations().filter((a) => a.playState === "running").length > 0;

const checks: Record<string, unknown> = {};
async function run() {

    await frame();
    // the wide layout becoming the phone layout: the closed page is already off-screen, not leaving
    setEnabled(true);
    await frame();
    const region = document.querySelector<HTMLElement>('[role="region"]')!;
    checks.switchSlides = moving(region);
    await frame();
    await frame();
    checks.switchSlidesLater = moving(region);
    // opening still slides in
    setOpen(true);
    await frame();
    checks.openSlides = moving(region);

}
run()
    .then(() => "", (error: unknown) => String(error))
    .then((error) => {
        document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error }))}`;
        dispose();
    });
