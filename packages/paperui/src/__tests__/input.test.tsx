import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperInput } from "../components/PaperInput";

describe("PaperInput - Controlled State & Input Handling Tests", () => {
    test("handles uncontrolled input typing and defaultValue", async () => {
        const { getByRole } = render(() => <PaperInput defaultValue="Initial" />);
        const input = getByRole("textbox") as HTMLInputElement;

        expect(input.value).toBe("Initial");

        await fireEvent.input(input, { target: { value: "Updated" } });
        expect(input.value).toBe("Updated");
    });

    test("handles controlled input state without desync", async () => {
        const [val, setVal] = createSignal("Controlled");
        const handleInput = vi.fn((e) => setVal(e.currentTarget.value));

        const { getByRole } = render(() => (
            <PaperInput value={val()} onInput={handleInput} />
        ));
        const input = getByRole("textbox") as HTMLInputElement;

        expect(input.value).toBe("Controlled");

        await fireEvent.input(input, { target: { value: "New Value" } });
        expect(handleInput).toHaveBeenCalled();
        expect(val()).toBe("New Value");
    });

    test("renders a textarea when multiline is set", () => {
        const { container } = render(() => <PaperInput multiline rows={6} defaultValue="Notes" />);

        const textarea = container.querySelector("textarea");
        expect(textarea).not.toBeNull();
        expect(textarea?.value).toBe("Notes");
        expect(textarea?.getAttribute("rows")).toBe("6");
        // the single-line element must not also render
        expect(container.querySelector("input")).toBeNull();
    });

    test("defaults multiline rows to four", () => {
        const { container } = render(() => <PaperInput multiline />);
        expect(container.querySelector("textarea")?.getAttribute("rows")).toBe("4");
    });

    test("keeps the same controlled value contract on a multiline field", async () => {
        const [val, setVal] = createSignal("First line");
        const handleInput = vi.fn((e) => setVal(e.currentTarget.value));

        const { container } = render(() => (
            <PaperInput multiline value={val()} onInput={handleInput} />
        ));
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;

        expect(textarea.value).toBe("First line");

        await fireEvent.input(textarea, { target: { value: "First line\nSecond line" } });
        expect(handleInput).toHaveBeenCalled();
        expect(val()).toBe("First line\nSecond line");
        expect(textarea.value).toBe("First line\nSecond line");
    });

    test("resize false marks the field as fixed size, resize true does not", () => {
        const fixed = render(() => <PaperInput multiline resize={false} />);
        expect(
            fixed.container.querySelector("[class*='PaperInput']")?.className.includes("fixedSize")
        ).toBe(true);

        const resizable = render(() => <PaperInput multiline />);
        expect(
            resizable.container.querySelector("[class*='PaperInput']")?.className.includes("fixedSize")
        ).toBe(false);
    });

    test("reports invalid state on a multiline field", () => {
        const { container } = render(() => <PaperInput multiline value="bad" validate={(v) => v === "good"} />);
        const wrapper = container.querySelector("[class*='PaperInput']");
        expect(wrapper?.className.includes("invalid")).toBe(true);
        expect(container.querySelector("textarea")?.getAttribute("aria-invalid")).toBe("true");
    });

    test("validates input using custom validate function", () => {
        const validateEmail = (v: string) => v.includes("@");
        const { container } = render(() => (
            <PaperInput value="invalid-email" validate={validateEmail} />
        ));

        const wrapper = container.querySelector("[class*='PaperInput']");
        expect(wrapper?.classList.contains("invalid") || wrapper?.className.includes("invalid")).toBe(true);
    });
});
