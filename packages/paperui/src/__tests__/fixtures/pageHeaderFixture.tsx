import { For } from "solid-js";
import { render } from "solid-js/web";
import { PaperButton, PaperPageHeader, PaperProvider } from "../../index";
import "../../styles/styles.css";

// A phone-width page (a 402px screen less a panel's padding): a few icon
// actions stay beside the title; a row of text actions too wide for that
// still moves under it.
const dispose = render(
    () => (
        <PaperProvider>
            <div style={{ width: "378px" }}>
                <div data-testid="icons">
                    <PaperPageHeader title="Assistant" subtitle="Ready">
                        <For each={["history", "add", "more_horiz"]}>
                            {(icon) => <PaperButton icon variant="text" aria-label={icon}>{icon}</PaperButton>}
                        </For>
                    </PaperPageHeader>
                </div>
                <div data-testid="words">
                    <PaperPageHeader title="Server" subtitle="Running">
                        <For each={["Start", "Stop", "Restart", "Back up"]}>{(label) => <PaperButton>{label}</PaperButton>}</For>
                    </PaperPageHeader>
                </div>
            </div>
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

const checks: Record<string, unknown> = {};
const beside = (testId: string) => {
    const header = document.querySelector<HTMLElement>(`[data-testid="${testId}"] > *`)!;
    const [heading, actions] = [...header.children] as HTMLElement[];
    const a = heading.getBoundingClientRect();
    const b = actions.getBoundingClientRect();
    // on one row: the actions start after the heading ends, inside its height
    return b.left >= a.right && b.top < a.bottom;
};
try {
    checks.iconsBeside = beside("icons");
    checks.wordsBeside = beside("words");
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: "" }))}`;
} catch (error) {
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: String(error) }))}`;
} finally {
    dispose();
}
