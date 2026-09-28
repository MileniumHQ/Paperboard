import { describe, test, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperToggle } from "../components/PaperToggle";

describe("PaperToggle - Accessibility & State Tests", () => {
    test("renders with role='switch' and correct initial aria-checked state", () => {
        const { getByRole } = render(() => <PaperToggle defaultChecked={true} />);
        const toggle = getByRole("switch");
        expect(toggle).toBeDefined();
        expect(toggle.getAttribute("aria-checked")).toBe("true");
        expect(toggle.getAttribute("tabindex")).toBe("0");
    });

    test("toggles state on click when uncontrolled", async () => {
        const handleChange = vi.fn();
        const { getByRole } = render(() => <PaperToggle onChange={handleChange} />);
        const toggle = getByRole("switch");

        expect(toggle.getAttribute("aria-checked")).toBe("false");

        await fireEvent.click(toggle);

        expect(toggle.getAttribute("aria-checked")).toBe("true");
        expect(handleChange).toHaveBeenCalledWith(true);
    });

    test("supports keyboard navigation via Space and Enter keys", async () => {
        const handleChange = vi.fn();
        const { getByRole } = render(() => <PaperToggle onChange={handleChange} />);
        const toggle = getByRole("switch");

        await fireEvent.keyDown(toggle, { key: " " });
        expect(toggle.getAttribute("aria-checked")).toBe("true");

        await fireEvent.keyDown(toggle, { key: "Enter" });
        expect(toggle.getAttribute("aria-checked")).toBe("false");
        expect(handleChange).toHaveBeenCalledTimes(2);
    });

    test("respects controlled checked prop without internal desync", async () => {
        const [checked, setChecked] = createSignal(false);
        const handleChange = vi.fn((val) => setChecked(val));

        const { getByRole } = render(() => (
            <PaperToggle checked={checked()} onChange={handleChange} />
        ));
        const toggle = getByRole("switch");

        expect(toggle.getAttribute("aria-checked")).toBe("false");

        await fireEvent.click(toggle);

        expect(handleChange).toHaveBeenCalledWith(true);
        expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    test("toggles once when wrapped in a label", async () => {
        // the label forwards its activation to the hidden checkbox, whose
        // click bubbles back; that must not cancel the toggle
        const handleChange = vi.fn();
        const { getByRole } = render(() => (
            <label>
                <PaperToggle onChange={handleChange} />
                Think
            </label>
        ));
        const toggle = getByRole("switch");

        await fireEvent.click(toggle);

        expect(handleChange).toHaveBeenCalledTimes(1);
        expect(handleChange).toHaveBeenCalledWith(true);
        expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    test("prevents interaction when disabled", async () => {
        const handleChange = vi.fn();
        const { getByRole } = render(() => <PaperToggle disabled onChange={handleChange} />);
        const toggle = getByRole("switch");

        expect(toggle.getAttribute("tabindex")).toBe("-1");

        await fireEvent.click(toggle);
        expect(handleChange).not.toHaveBeenCalled();
        expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
});
