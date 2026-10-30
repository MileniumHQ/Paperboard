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
                {/* too narrow for icons beside the title: centered once stacked */}
                <div data-testid="centered" style={{ width: "220px" }}>
                    <PaperPageHeader icon="smart_toy" title="Assistant" subtitle="Ready" centerWhenStacked>
                        <For each={["history", "add", "more_horiz"]}>
                            {(icon) => <PaperButton icon variant="text" aria-label={icon}>{icon}</PaperButton>}
                        </For>
                    </PaperPageHeader>
                </div>
                <div data-testid="stacked">
                    <PaperPageHeader title="Server" subtitle="Running" centerWhenStacked>
                        <For each={["Start", "Stop", "Restart", "Back up"]}>{(label) => <PaperButton>{label}</PaperButton>}</For>
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
// both rows' content sits on the header's center line, within a pixel
const centered = (testId: string) => {
    const header = document.querySelector<HTMLElement>(`[data-testid="${testId}"] > *`)!;
    const [heading, actions] = [...header.children] as HTMLElement[];
    const mid = (r: DOMRect) => (r.left + r.right) / 2;
    const center = mid(header.getBoundingClientRect());
    const span = (el: HTMLElement) => {
        const rects = [...el.children].map((c) => c.getBoundingClientRect());
        return mid(new DOMRect(
            Math.min(...rects.map((r) => r.left)), 0,
            Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)), 0,
        ));
    };
    return Math.abs(span(heading) - center) <= 1 && Math.abs(span(actions) - center) <= 1;
};
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
try {
    checks.iconsBeside = beside("icons");
    checks.wordsBeside = beside("words");
    checks.centeredStacked = centered("centered") && centered("stacked");
    checks.besideUncentered = !centered("icons");
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: "" }))}`;
} catch (error) {
    document.getElementById("results")!.textContent = `RESULT:${btoa(JSON.stringify({ checks, error: String(error) }))}`;
} finally {
    dispose();
}
