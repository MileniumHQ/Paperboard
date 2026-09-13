import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { PaperContextMenu, PaperContextMenuItem } from "../components/PaperContextMenu";

describe("PaperContextMenu - Keyboard & Scroll Dismissal Tests", () => {
    test("renders menu with role='menu' and menuitem roles", () => {
        render(() => (
            <PaperContextMenu open={true} x={100} y={100}>
                <PaperContextMenuItem value="item1">Item 1</PaperContextMenuItem>
                <PaperContextMenuItem value="item2">Item 2</PaperContextMenuItem>
            </PaperContextMenu>
        ));

        const menu = screen.getByRole("menu");
        expect(menu).toBeDefined();
        const items = screen.getAllByRole("menuitem");
        expect(items.length).toBe(2);
    });

    test("dismisses menu when Escape key is pressed", async () => {
        const handleClose = vi.fn();
        render(() => (
            <PaperContextMenu open={true} onClose={handleClose}>
                <PaperContextMenuItem value="item1">Item 1</PaperContextMenuItem>
            </PaperContextMenu>
        ));

        await fireEvent.keyDown(window, { key: "Escape" });
        expect(handleClose).toHaveBeenCalledTimes(1);
    });

    test("dismisses menu when parent window/container scrolls", async () => {
        const handleClose = vi.fn();
        render(() => (
            <PaperContextMenu open={true} onClose={handleClose}>
                <PaperContextMenuItem value="item1">Item 1</PaperContextMenuItem>
            </PaperContextMenu>
        ));

        await fireEvent.scroll(window);
        expect(handleClose).toHaveBeenCalledTimes(1);
    });
});
