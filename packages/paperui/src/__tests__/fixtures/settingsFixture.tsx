import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { PaperInput, PaperSettingItem, PaperSettingList, PaperProvider } from "../../index";
import "../../styles/styles.css";

const [multiline, setMultiline] = createSignal(false);
const dispose = render(() => <PaperProvider><PaperSettingList autoHeight style={{ width: "600px" }}>
    <PaperSettingItem title="Instructions" data-testid="row"><PaperInput aria-label="Instructions" multiline={multiline()} fullWidth rows={8} /></PaperSettingItem>
</PaperSettingList></PaperProvider>, document.getElementById("app")!);
const checks: Record<string, unknown> = {};
try {
    const row = document.querySelector<HTMLElement>('[data-testid="row"]')!;
    checks.singleLineDirection = getComputedStyle(row).flexDirection;
    setMultiline(true);
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Instructions"]')!;
    checks.multilineDirection = getComputedStyle(row).flexDirection;
    checks.fullWidth = textarea.getBoundingClientRect().width > row.getBoundingClientRect().width * 0.8;
    textarea.focus();
    checks.focusable = document.activeElement === textarea;
    setMultiline(false);
    checks.restoredDirection = getComputedStyle(row).flexDirection;
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: "" }))}`;
} catch (error) {
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: String(error) }))}`;
} finally {
    dispose();
}
