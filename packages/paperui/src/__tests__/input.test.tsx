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

    test("validates input using custom validate function", () => {
        const validateEmail = (v: string) => v.includes("@");
        const { container } = render(() => (
            <PaperInput value="invalid-email" validate={validateEmail} />
        ));

        const wrapper = container.querySelector("[class*='PaperInput']");
        expect(wrapper?.classList.contains("invalid") || wrapper?.className.includes("invalid")).toBe(true);
    });
});
