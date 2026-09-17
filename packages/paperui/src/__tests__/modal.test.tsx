import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PaperModal } from "../components/PaperModal";
import { PaperButton } from "../components/PaperButton";

describe("PaperModal - Accessibility & Focus Trapping Tests", () => {
    test("renders dialog with role='dialog' and aria-modal='true'", () => {
        render(() => (
            <PaperModal open={true} title="Test Dialog">
                <p>Modal content</p>
            </PaperModal>
        ));

        const dialog = screen.getByRole("dialog", { name: "Test Dialog" });
        expect(dialog).toBeDefined();
        expect(dialog.getAttribute("aria-modal")).toBe("true");
        expect(screen.getByText("Test Dialog")).toBeDefined();
    });

    test("dismisses when Escape key is pressed", async () => {
        const handleClose = vi.fn();
        render(() => (
            <PaperModal open={true} onClose={handleClose} title="Escape Test">
                <p>Content</p>
            </PaperModal>
        ));

        await fireEvent.keyDown(window, { key: "Escape" });
        expect(handleClose).toHaveBeenCalledTimes(1);
    });

    test("restores focus to trigger element upon closing", async () => {
        const [open, setOpen] = createSignal(false);

        const { getByText } = render(() => (
            <div>
                <PaperButton onClick={() => setOpen(true)}>Open Dialog</PaperButton>
                <PaperModal open={open()} onClose={() => setOpen(false)} title="Focus Restoration">
                    <button onClick={() => setOpen(false)}>Close</button>
                </PaperModal>
            </div>
        ));

        const trigger = getByText("Open Dialog");
        trigger.focus();
        expect(document.activeElement).toBe(trigger);

        await fireEvent.click(trigger);
        expect(open()).toBe(true);

        setOpen(false);
        expect(open()).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });

    test("focus traversal skips disabled first and last controls", async () => {
        render(() => <PaperModal open title="Enabled controls">
            <button disabled>Unavailable first</button><button>Enabled first</button>
            <button>Enabled last</button><button disabled>Unavailable last</button>
        </PaperModal>);
        const first = screen.getByText("Enabled first");
        const last = screen.getByText("Enabled last");
        last.focus();
        await fireEvent.keyDown(window, { key: "Tab" });
        expect(document.activeElement).toBe(first);
        await fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
        expect(document.activeElement).toBe(last);
    });
});
