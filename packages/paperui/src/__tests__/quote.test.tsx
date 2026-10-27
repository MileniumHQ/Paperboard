import { render, fireEvent } from "@solidjs/testing-library";
import { describe, test, expect, vi } from "vitest";
import { PaperQuote } from "../components/PaperQuote";

describe("PaperQuote dismiss", () => {
    test("onDismiss adds a close button that calls it", () => {
        const dismiss = vi.fn();
        const { getByRole } = render(() => (
            <PaperQuote variant="danger" title="Tab not opened" onDismiss={dismiss}>
                The shell could not start
            </PaperQuote>
        ));
        fireEvent.click(getByRole("button", { name: "Dismiss" }));
        expect(dismiss).toHaveBeenCalledTimes(1);
    });

    test("without onDismiss a quote has no button", () => {
        const { queryByRole } = render(() => <PaperQuote title="Back up first">Worlds may not survive</PaperQuote>);
        expect(queryByRole("button")).toBeNull();
    });
});
