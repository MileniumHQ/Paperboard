import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    resolveMenuLeft,
} from "../components/PaperContextMenu";

describe("menu horizontal placement", () => {
    test("anchors to the target's left edge while the menu fits", () => {
        expect(resolveMenuLeft(100, 300, 200, 1000)).toBe(100);
    });

    test("anchors to the target's right edge when the menu would overflow", () => {
        // trigger 700..900, menu 400 wide, viewport 960: 700+400 overflows
        expect(resolveMenuLeft(700, 900, 400, 960)).toBe(500);
    });

    test("clamps to the viewport when even the right anchor has no room", () => {
        // trigger 300..480, menu 600 wide: anchoring right starts off-screen
        expect(resolveMenuLeft(300, 480, 600, 700)).toBe(12);
    });

    test("clamps to the viewport when a mouse menu has no target edge", () => {
        expect(resolveMenuLeft(900, null, 400, 960)).toBe(548);
    });
});

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

    test("dismisses on the pointerdown that starts an outside press", () => {
        const handleClose = vi.fn();
        render(() => (
            <>
                <div data-testid="outside" />
                <PaperContextMenu open={true} onClose={handleClose}>
                    <PaperContextMenuItem value="item1">Item 1</PaperContextMenuItem>
                </PaperContextMenu>
            </>
        ));

        fireEvent.pointerDown(screen.getByTestId("outside"));
        expect(handleClose).toHaveBeenCalledTimes(1);
    });

    test("keepMounted keeps the panel in the DOM but hidden while closed", () => {
        render(() => (
            <PaperContextMenu open={false} keepMounted>
                <PaperContextMenuItem value="item1">Item 1</PaperContextMenuItem>
            </PaperContextMenu>
        ));

        const menu = screen.getByRole("menu", { hidden: true });
        expect(menu.getAttribute("aria-hidden")).toBe("true");
        // hidden, not absent: a visible-only query must not see it
        expect(screen.queryByRole("menu")).toBeNull();
    });

    test("a checked item renders its check mark", () => {
        render(() => (
            <PaperContextMenu open={true}>
                <PaperContextMenuItem value="b" checked>
                    Beta
                </PaperContextMenuItem>
            </PaperContextMenu>
        ));

        expect(screen.getByText("check")).toBeDefined();
    });
});
