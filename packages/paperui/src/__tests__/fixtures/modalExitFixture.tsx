// Real-browser fixture for a closing modal (modalExit.browser.test.ts).
//
// A closed modal stays mounted for a frame and then its fade. Its backdrop
// covered the page the whole time, so a press made then landed on the
// backdrop and the control under the pointer never heard it. jsdom does no
// hit testing, so it cannot see this.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperModal, PaperButton } from "../../index";
import "../../styles/styles.css";

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

const out: FixtureResults = { checks: {}, error: "" };
const [open, setOpen] = createSignal(false);

function report(): void {
    const results = document.getElementById("results");
    if (results) results.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Fixture() {
    return (
        <div>
            <PaperButton id="behind">Behind the modal</PaperButton>
            <PaperModal open={open()} onClose={() => setOpen(false)} title="Fixture dialog">
                <p>Modal content</p>
            </PaperModal>
        </div>
    );
}

async function run(): Promise<void> {
    const behind = document.getElementById("behind") as HTMLElement;
    const rect = behind.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    setOpen(true);
    await wait(400);
    out.checks.openCovers = document.elementFromPoint(x, y) !== behind && !behind.contains(document.elementFromPoint(x, y));

    setOpen(false);
    await wait(20);
    out.checks.stillMounted = !!document.querySelector('[role="dialog"]');
    const hit = document.elementFromPoint(x, y);
    out.checks.pressReachesPage = !!hit && (hit === behind || behind.contains(hit));
    out.checks.hit = `${hit?.tagName}.${hit?.className} ${hit ? getComputedStyle(hit).pointerEvents : ""}`;
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
