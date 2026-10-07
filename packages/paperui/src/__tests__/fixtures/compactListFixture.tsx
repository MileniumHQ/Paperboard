import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import { PaperList, PaperListItem, PaperProvider } from "../../index";
import "../../styles/styles.css";

const NAMES = ["Alice", "Bob"];

const [compactOpen, setCompactOpen] = createSignal<string | undefined>();
const [plainOpen, setPlainOpen] = createSignal<string | undefined>();

const dispose = render(
    () => (
        <PaperProvider>
            {/* compact branch: suppress the hidden radio, open directly */}
            <div data-testid="compact">
                <PaperList
                    name="compact-list"
                    value={compactOpen()}
                    onValueChange={(v) => setCompactOpen(String(v))}
                >
                    <For each={NAMES}>
                        {(name) => (
                            <PaperListItem
                                value={name}
                                onClick={(e) => {
                                    e.preventDefault();
                                    setCompactOpen(name);
                                }}
                            >
                                {name}
                            </PaperListItem>
                        )}
                    </For>
                </PaperList>
            </div>

            {/* side-by-side branch: normal radio selection */}
            <div data-testid="plain">
                <PaperList
                    name="plain-list"
                    value={plainOpen()}
                    onValueChange={(v) => setPlainOpen(String(v))}
                >
                    <For each={NAMES}>
                        {(name) => (
                            <PaperListItem value={name}>{name}</PaperListItem>
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
    const compact = document.querySelector<HTMLElement>(
        '[data-testid="compact"]',
    )!;
    const compactRow = compact.querySelector<HTMLLabelElement>(
        'label[data-value="Alice"]',
    )!;
    const compactInput = compactRow.querySelector<HTMLInputElement>("input")!;
    compactRow.click();
    checks.compactFirstOpen = compactOpen() ?? null;
    setCompactOpen(undefined);
    checks.compactRadioCleared = compactInput.checked === false;
    compactRow.click();
    checks.compactReopen = compactOpen() ?? null;

    const plain = document.querySelector<HTMLElement>('[data-testid="plain"]')!;
    const plainRow = plain.querySelector<HTMLLabelElement>(
        'label[data-value="Alice"]',
    )!;
    plainRow.click();
    checks.plainFirstOpen = plainOpen() ?? null;
    setPlainOpen(undefined);
    plainRow.click();
    checks.plainReopen = plainOpen() ?? null;

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
