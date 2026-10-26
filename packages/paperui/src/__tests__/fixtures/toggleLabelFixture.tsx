// Real-browser fixture for a PaperToggle inside a <label> (toggleLabel.browser.test.ts).
//
// A settings row wraps its switch in a label. Browsers send the label's
// activation on to the hidden checkbox after the switch's own click, unless
// that click was cancelled. jsdom treats the switch as interactive content
// and skips the activation, so only a real browser shows the double toggle.
import { render } from "solid-js/web";
import { PaperSettingList, PaperToggle } from "../../index";
import "../../styles/styles.css";

const out = { checks: {} as Record<string, unknown>, error: "" };
const heard: boolean[] = [];

const dispose = render(() => (
    <PaperSettingList autoHeight onValueChange={(next) => heard.push(next.reducedMotion)}>
        <label>
            Reduce motion
            <PaperToggle name="reducedMotion" />
        </label>
    </PaperSettingList>
), document.getElementById("app")!);

try {
    const toggle = document.querySelector<HTMLElement>('[role="switch"]')!;
    const input = toggle.querySelector("input")!;
    // a tap lands on the knob, not the switch's own box
    toggle.querySelector<HTMLElement>("div")!.click();
    out.checks.afterSwitch = { lastHeard: heard.at(-1), heardOld: heard.includes(false), checked: input.checked, ariaChecked: toggle.getAttribute("aria-checked") };
    heard.length = 0;
    // the row's text still toggles it, through the label
    document.querySelector("label")!.click();
    out.checks.afterLabelText = { lastHeard: heard.at(-1), checked: input.checked };
} catch (error) {
    out.error = String(error);
} finally {
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify(out))}`;
    dispose();
}
