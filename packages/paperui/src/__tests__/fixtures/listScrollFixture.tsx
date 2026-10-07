import { For } from "solid-js";
import { render } from "solid-js/web";
import { PaperList, PaperListItem, PaperProvider } from "../../index";
import "../../styles/styles.css";

const ITEMS = 40;
const indices = Array.from({ length: ITEMS }, (_, i) => i);

const dispose = render(
    () => (
        <PaperProvider>
            <div
                data-testid="vertical-wrap"
                style={{ height: "200px", display: "flex" }}
            >
                <PaperList name="vertical-list" data-testid="vertical-list">
                    <For each={indices}>
                        {(i) => (
                            <PaperListItem value={`v${i}`}>
                                {`Item ${i}`}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </div>

            <div data-testid="horizontal-wrap" style={{ width: "300px" }}>
                <PaperList
                    name="horizontal-list"
                    data-testid="horizontal-list"
                    horizontal
                >
                    <For each={indices}>
                        {(i) => (
                            <PaperListItem value={`h${i}`}>
                                {`Tab ${i}`}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </div>
        </PaperProvider>
    ),
    document.getElementById("app")!,
);

const checks: Record<string, unknown> = {};
try {
    const vertical = document.querySelector<HTMLElement>(
        '[data-testid="vertical-list"]',
    )!;
    const verticalItem = vertical.querySelector<HTMLElement>(
        "label[data-value]",
    )!;
    checks.verticalOverflow = getComputedStyle(vertical).overflowY;
    checks.verticalFits =
        Math.round(verticalItem.getBoundingClientRect().height) >=
        verticalItem.scrollHeight - 1;
    checks.verticalScrolls = vertical.scrollHeight > vertical.clientHeight + 1;

    const horizontal = document.querySelector<HTMLElement>(
        '[data-testid="horizontal-list"]',
    )!;
    const horizontalItem = horizontal.querySelector<HTMLElement>(
        "label[data-value]",
    )!;
    checks.horizontalOverflow = getComputedStyle(horizontal).overflowX;
    checks.horizontalFits =
        Math.round(horizontalItem.getBoundingClientRect().width) >=
        horizontalItem.scrollWidth - 1;
    checks.horizontalScrolls =
        horizontal.scrollWidth > horizontal.clientWidth + 1;

    document.getElementById("results")!.textContent = `RESULT:${btoa(
        JSON.stringify({ checks, error: "" }),
    )}`;
} catch (error) {
    document.getElementById("results")!.textContent = `RESULT:${btoa(
        JSON.stringify({ checks, error: String(error) }),
    )}`;
} finally {
    dispose();
}
