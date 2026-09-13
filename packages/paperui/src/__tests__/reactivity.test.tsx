import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { SelectionProvider, useSelectionItem } from "../components/contexts/selection";
import { createSignal } from "solid-js";

function TestItem(props: { value: string; onRender: (val: string) => void }) {
    const { isSelected, select } = useSelectionItem(props.value);
    props.onRender(props.value);

    return (
        <button
            data-testid={`item-${props.value}`}
            data-selected={isSelected() ? "true" : "false"}
            onClick={select}
        >
            Item {props.value}
        </button>
    );
}

describe("SelectionProvider - O(1) Fine-Grained Reactivity Tests", () => {
    test("only re-evaluates selected and unselected items upon selection change", async () => {
        const renderTracker = vi.fn();
        const [selectedVal, setSelectedVal] = createSignal("1");

        const { getByTestId } = render(() => (
            <SelectionProvider name="perf-test" value={selectedVal()} onValueChange={setSelectedVal}>
                <TestItem value="1" onRender={renderTracker} />
                <TestItem value="2" onRender={renderTracker} />
                <TestItem value="3" onRender={renderTracker} />
                <TestItem value="4" onRender={renderTracker} />
            </SelectionProvider>
        ));

        expect(getByTestId("item-1").getAttribute("data-selected")).toBe("true");
        expect(getByTestId("item-2").getAttribute("data-selected")).toBe("false");

        renderTracker.mockClear();

        await fireEvent.click(getByTestId("item-3"));

        expect(getByTestId("item-1").getAttribute("data-selected")).toBe("false");
        expect(getByTestId("item-3").getAttribute("data-selected")).toBe("true");

        const renderedItems = renderTracker.mock.calls.map((call) => call[0]);
        expect(renderedItems).not.toContain("2");
        expect(renderedItems).not.toContain("4");
    });
});
