import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { PaperChip } from "../components/PaperChip";

describe("PaperChip", () => {
    test("exposes its selected state to assistive tech", () => {
        render(() => (
            <PaperChip selected count={3}>
                Online
            </PaperChip>
        ));
        const chip = screen.getByRole("button", { name: /Online/ });
        expect(chip.getAttribute("aria-pressed")).toBe("true");
        expect(chip.textContent).toContain("3");
    });

    test("is not pressed by default and toggles through onClick", async () => {
        const onClick = vi.fn();
        render(() => <PaperChip onClick={onClick}>Banned</PaperChip>);
        const chip = screen.getByRole("button", { name: "Banned" });
        expect(chip.getAttribute("aria-pressed")).toBe("false");
        await fireEvent.click(chip);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    test("renders an icon as an accessible-free glyph beside the label", () => {
        render(() => (
            <PaperChip icon="block" selected>
                Banned
            </PaperChip>
        ));
        expect(screen.getByText("block")).toBeDefined();
    });
});
