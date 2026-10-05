// Real-browser fixture for modal focus styling (modalFocus.browser.test.ts).
//
// The dialog element receives focus to trap focus and as the fallback when it
// has no focusable children. It is not an actionable control, so it must not
// paint the UA focus ring: without `outline: none` Chrome matches
// :focus-visible on the container and paints `outline: auto 1px` in the system
// accent (orange on Ubuntu), which wrapped the whole modal. jsdom cannot see
// this because it does not apply the bundled CSS.
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperModal, PaperButton } from "../../index";
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

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function Fixture() {
    const [open, setOpen] = createSignal(false);

    return (
        <div>
            <PaperButton onClick={() => setOpen(true)}>Open modal</PaperButton>
            <PaperModal
                open={open()}
                onClose={() => setOpen(false)}
                title="Fixture dialog"
            >
                <p>Modal content</p>
            </PaperModal>
        </div>
    );
}

async function run(): Promise<void> {
    const trigger = document.querySelector("button") as HTMLButtonElement;
    trigger.click();
    // open runs synchronously; focus is applied on the following frame
    await nextFrame();
    await nextFrame();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
    out.checks.dialogPresent = !!dialog;
    out.checks.focusedOnDialog = document.activeElement === dialog;
    if (dialog) {
        out.checks.outlineStyle = getComputedStyle(dialog).outlineStyle;
    }
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
