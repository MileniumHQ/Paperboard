// Real-browser fixture for the labelled PaperInput (inputLabel.browser.test.ts).
//
// The label must sit on the field's top border, inside the notch the legend
// cuts, and the border must turn primary while the field has focus. jsdom
// lays nothing out, so only a real browser can see either.
import { render } from "solid-js/web";
import { PaperInput } from "../../index";
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

function Fixture() {
    return (
        <div class="paperui-root" style={{ padding: "40px", width: "320px" }}>
            <PaperInput label="Access key" fullWidth />
        </div>
    );
}

// layout and computed style are read synchronously: no frame is awaited, so
// the result does not depend on headless Chrome scheduling animation frames
function run(): void {
    const input = document.querySelector("input") as HTMLInputElement;
    const label = document.querySelector("label") as HTMLLabelElement;
    const fieldset = document.querySelector("fieldset") as HTMLFieldSetElement;
    const legend = fieldset.querySelector("legend") as HTMLElement;

    const labelBox = label.getBoundingClientRect();
    const legendBox = legend.getBoundingClientRect();
    const fieldsetBox = fieldset.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    const borderTop = fieldsetBox.top + legendBox.height / 2;

    out.checks.labelText = label.textContent;
    out.checks.labelFor = label.htmlFor === input.id && input.id !== "";
    // the border line runs through the label's middle
    out.checks.labelStraddlesBorder = labelBox.top < borderTop && labelBox.bottom > borderTop;
    // the label stays inside the notch, so the border does not strike it
    out.checks.labelInsideNotch = labelBox.left >= legendBox.left - 1 && labelBox.right <= legendBox.right + 1;
    // the border line is the input's top edge, so the text box is not covered
    out.checks.borderAtInputTop = Math.abs(borderTop - inputBox.top) <= 1;
    out.checks.labelVisible = getComputedStyle(label).visibility === "visible" && labelBox.width > 0;

    const idleBorder = getComputedStyle(fieldset).borderTopColor;
    input.focus();
    // transitions would report the starting colour; read the target
    fieldset.style.transition = "none";
    label.style.transition = "none";
    const focusedBorder = getComputedStyle(fieldset).borderTopColor;
    const probe = document.createElement("div");
    probe.style.color = "var(--paper-primary)";
    document.querySelector(".paperui-root")?.appendChild(probe);
    out.checks.focusBorderIsPrimary = focusedBorder === getComputedStyle(probe).color && focusedBorder !== idleBorder;
    out.checks.focusLabelIsPrimary = getComputedStyle(label).color === getComputedStyle(probe).color;
}

try {
    render(() => <Fixture />, document.getElementById("app") as HTMLElement);
    setTimeout(() => {
        try {
            run();
        } catch (err) {
            out.error = err instanceof Error ? err.stack ?? err.message : String(err);
        }
        report();
    }, 0);
} catch (err) {
    out.error = err instanceof Error ? err.stack ?? err.message : String(err);
    report();
}
