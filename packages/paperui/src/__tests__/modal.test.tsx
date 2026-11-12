import { describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { PaperModal } from "../index";

const escape = () => fireEvent.keyDown(window, { key: "Escape" });
const tab = (shiftKey = false) => fireEvent.keyDown(window, { key: "Tab", shiftKey });

// Inventory: PaperModal — Escape, stacking and focus.
describe("PaperModal keyboard, stacking and focus", () => {
    test("Escape closes only the top modal of a stack, then the one beneath", () => {
        const [lowerOpen, setLowerOpen] = createSignal(true);
        const [upperOpen, setUpperOpen] = createSignal(true);
        const closed: string[] = [];
        render(() => (
            <>
                <PaperModal open={lowerOpen()} onClose={() => (closed.push("lower"), setLowerOpen(false))} title="Lower">
                    lower body
                </PaperModal>
                <PaperModal open={upperOpen()} onClose={() => (closed.push("upper"), setUpperOpen(false))} title="Upper">
                    upper body
                </PaperModal>
            </>
        ));

        escape();
        expect(closed).toEqual(["upper"]);
        expect(lowerOpen()).toBe(true);

        escape();
        expect(closed).toEqual(["upper", "lower"]);
    });

    test("every open focuses the autofocus child, and closing returns focus to the opener", async () => {
        const [open, setOpen] = createSignal(false);
        render(() => (
            <>
                <button type="button" onClick={() => setOpen(true)}>
                    Open
                </button>
                <PaperModal open={open()} onClose={() => setOpen(false)} title="Rename">
                    <button type="button">Before</button>
                    <input aria-label="Name" autofocus />
                </PaperModal>
            </>
        ));
        const opener = screen.getByText("Open");

        for (let round = 0; round < 2; round++) {
            opener.focus();
            fireEvent.click(opener);
            await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Name")));
            escape();
            expect(open()).toBe(false);
            expect(document.activeElement).toBe(opener);
        }
    });

    test("Tab and Shift+Tab wrap inside the dialog", () => {
        render(() => (
            <PaperModal open onClose={() => undefined} title="Wrap">
                <button type="button">Middle</button>
                <button type="button">Last</button>
            </PaperModal>
        ));
        const first = screen.getByLabelText("Close modal");
        const last = screen.getByText("Last");

        last.focus();
        tab();
        expect(document.activeElement).toBe(first);

        tab(true);
        expect(document.activeElement).toBe(last);
    });

    test("a concealed modal keeps its children mounted, is aria-hidden and ignores Escape", () => {
        const [concealed, setConcealed] = createSignal(true);
        let closes = 0;
        render(() => (
            <PaperModal open concealed={concealed()} onClose={() => closes++} title="Carried">
                <span>held item</span>
            </PaperModal>
        ));
        const child = screen.getByText("held item");
        const backdrop = child.closest('[role="dialog"]')!.parentElement!;

        expect(backdrop.getAttribute("aria-hidden")).toBe("true");
        escape();
        expect(closes).toBe(0);

        setConcealed(false);
        // the same element: concealing never remounted it
        expect(screen.getByText("held item")).toBe(child);
        expect(backdrop.hasAttribute("aria-hidden")).toBe(false);
        escape();
        expect(closes).toBe(1);
    });

    test("a modal keeps what it showed while it leaves, even when its subject is cleared as it closes", () => {
        const [subject, setSubject] = createSignal<{ name: string } | undefined>({ name: "Desk" });
        const [open, setOpen] = createSignal(true);
        render(() => (
            <PaperModal open={open()} title={`Can't reach ${subject()?.name ?? "computer"}`} footer={<span>{subject()?.name} footer</span>}>
                <span>{subject() ? subject()!.name : "nothing"}</span>
            </PaperModal>
        ));
        expect(screen.getByText("Desk")).toBeTruthy();

        // the caller clears the subject in the same breath as it closes
        setOpen(false);
        setSubject(undefined);

        expect(screen.getByText("Desk")).toBeTruthy();
        expect(screen.getByText("Can't reach Desk")).toBeTruthy();
        expect(screen.getByText("Desk footer")).toBeTruthy();
    });
});
