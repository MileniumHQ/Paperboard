import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperSelector, PaperSelectorItem } from "../components/PaperSelector";

describe("PaperSelector & SelectionRadioInput Accessibility Tests", () => {
    test("radio input is accessible in DOM tree without display:none breaking screen readers", () => {
        render(() => (
            <PaperSelector name="test-group" defaultValue="opt1">
                <PaperSelectorItem value="opt1">Option 1</PaperSelectorItem>
                <PaperSelectorItem value="opt2">Option 2</PaperSelectorItem>
            </PaperSelector>
        ));

        const radios = screen.getAllByRole("radio") as HTMLInputElement[];
        expect(radios.length).toBe(2);
        expect(radios[0].checked).toBe(true);
        expect(radios[1].checked).toBe(false);

        expect(radios[0].style.display).not.toBe("none");
    });

    test("changes selection when clicking radio item label", async () => {
        const handleChange = vi.fn();
        const [val, setVal] = createSignal("opt1");

        render(() => (
            <PaperSelector name="test-group" value={val()} onValueChange={(v) => { setVal(String(v)); handleChange(v); }}>
                <PaperSelectorItem value="opt1">Option 1</PaperSelectorItem>
                <PaperSelectorItem value="opt2">Option 2</PaperSelectorItem>
            </PaperSelector>
        ));

        const radios = screen.getAllByRole("radio") as HTMLInputElement[];
        expect(radios[0].checked).toBe(true);

        await fireEvent.click(screen.getByText("Option 2"));

        expect(handleChange).toHaveBeenCalledWith("opt2");
        expect(radios[1].checked).toBe(true);
    });

    test("supports horizontal layout and reverse item layout props", () => {
        const { container } = render(() => (
            <PaperSelector name="test-group" horizontal defaultValue="opt1">
                <PaperSelectorItem value="opt1" icon="star" reverse>Option 1</PaperSelectorItem>
                <PaperSelectorItem value="opt2">Option 2</PaperSelectorItem>
            </PaperSelector>
        ));

        const selector = container.querySelector('[class*="PaperSelector"]');
        expect(selector?.className).toContain("horizontal");

        const firstItem = container.querySelector('[class*="PaperSelectorItem"]');
        expect(firstItem?.className).toContain("reverse");
    });

    test("multiple chooses any number of items, and choosing one again unchooses it", async () => {
        const [values, setValues] = createSignal<(string | number)[]>([]);
        render(() => (
            <PaperSelector name="test-group" multiple values={values()} onValuesChange={setValues}>
                <PaperSelectorItem value="opt1">Option 1</PaperSelectorItem>
                <PaperSelectorItem value="opt2">Option 2</PaperSelectorItem>
            </PaperSelector>
        ));

        const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
        expect(boxes.length).toBe(2);
        await fireEvent.click(screen.getByText("Option 1"));
        await fireEvent.click(screen.getByText("Option 2"));
        expect(values()).toEqual(["opt1", "opt2"]);
        expect(boxes.map((b) => b.checked)).toEqual([true, true]);
        await fireEvent.click(screen.getByText("Option 1"));
        expect(values()).toEqual(["opt2"]);
        expect(boxes[0].checked).toBe(false);
    });
    test("an item with href is a link, with no radio input", () => {
        const { container } = render(() => (
            <PaperSelector name="pager" horizontal>
                <PaperSelectorItem value="next" href="/next/" description="Next page">
                    Next
                </PaperSelectorItem>
            </PaperSelector>
        ));
        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe("/next/");
        expect(link?.textContent).toContain("Next page");
        expect(container.querySelector("input[type=radio]")).toBeNull();
    });

    test("a selected link item marks the current page", () => {
        const { container } = render(() => (
            <PaperSelector name="pages" value="b">
                <PaperSelectorItem value="a" href="/a/">A</PaperSelectorItem>
                <PaperSelectorItem value="b" href="/b/">B</PaperSelectorItem>
            </PaperSelector>
        ));
        const links = container.querySelectorAll("a");
        expect(links[0].getAttribute("aria-current")).toBeNull();
        expect(links[1].getAttribute("aria-current")).toBe("page");
    });
});
