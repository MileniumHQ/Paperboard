import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    PaperContextMenuSub,
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

describe("PaperContextMenu - submenu keyboard navigation", () => {
    const highlighted = () =>
        document.querySelector("[role='menu']")?.getAttribute("aria-activedescendant");
    const idOf = (text: string) =>
        screen.getByText(text).closest("[data-context-item]")!.id;

    function renderWithSub(onPick = vi.fn(), onClose = vi.fn()) {
        render(() => (
            <PaperContextMenu open={true} x={10} y={10} onClose={onClose}>
                <PaperContextMenuItem value="first">First</PaperContextMenuItem>
                <PaperContextMenuSub label="More">
                    <PaperContextMenuItem value="a" onClick={() => onPick("a")}>A</PaperContextMenuItem>
                    <PaperContextMenuItem value="b" onClick={() => onPick("b")}>B</PaperContextMenuItem>
                </PaperContextMenuSub>
                <PaperContextMenuItem value="last">Last</PaperContextMenuItem>
            </PaperContextMenu>
        ));
        return { onPick, onClose };
    }

    const key = (k: string) => fireEvent.keyDown(window, { key: k });

    test("a submenu is a reachable menuitem that announces its popup", async () => {
        renderWithSub();
        await key("ArrowDown");
        await key("ArrowDown");
        const sub = screen.getByText("More").closest("[data-context-item]")!;
        expect(highlighted()).toBe(sub.id);
        expect(sub.getAttribute("role")).toBe("menuitem");
        expect(sub.getAttribute("aria-haspopup")).toBe("menu");
        expect(sub.getAttribute("aria-expanded")).toBe("false");
    });

    test("ArrowRight opens the submenu and arrows stay inside it", async () => {
        renderWithSub();
        await key("ArrowDown");
        await key("ArrowDown");
        await key("ArrowRight");
        expect(screen.getByText("More").closest("[data-context-item]")!.getAttribute("aria-expanded")).toBe("true");
        expect(highlighted()).toBe(idOf("A"));
        await key("ArrowDown");
        expect(highlighted()).toBe(idOf("B"));
        // wraps within the submenu, never onto the parent's Last item
        await key("ArrowDown");
        expect(highlighted()).toBe(idOf("A"));
    });

    test("Enter picks a submenu item and closes the whole menu", async () => {
        const { onPick, onClose } = renderWithSub();
        await key("ArrowDown");
        await key("ArrowDown");
        await key("Enter");
        expect(highlighted()).toBe(idOf("A"));
        await key("ArrowDown");
        await key("Enter");
        expect(onPick).toHaveBeenCalledWith("b");
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("ArrowLeft and Escape leave the submenu without closing the menu", async () => {
        const { onClose } = renderWithSub();
        await key("ArrowDown");
        await key("ArrowDown");
        const subId = idOf("More");
        await key("ArrowRight");
        await key("ArrowLeft");
        expect(screen.queryByText("A")).toBeNull();
        expect(highlighted()).toBe(subId);

        await key("ArrowRight");
        await key("Escape");
        expect(screen.queryByText("A")).toBeNull();
        expect(highlighted()).toBe(subId);
        expect(onClose).not.toHaveBeenCalled();

        await key("Escape");
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test("the submenu panel renders outside the scrolling menu instead of inside it", async () => {
        renderWithSub();
        await key("ArrowDown");
        await key("ArrowDown");
        await key("ArrowRight");
        const root = document.querySelector("[role='menu'][data-context-root]")!;
        const panel = screen.getByRole("menu", { name: "More" });
        expect(root.contains(panel)).toBe(false);
        expect(root.contains(screen.getByText("A"))).toBe(false);
    });

    test("pressing and scrolling inside the portaled submenu keeps the menu open", async () => {
        const { onPick, onClose } = renderWithSub();
        fireEvent.pointerEnter(screen.getByText("More").closest("[data-context-item]")!);
        const a = screen.getByText("A");
        fireEvent.pointerDown(a);
        fireEvent.scroll(screen.getByRole("menu", { name: "More" }));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(a);
        expect(onPick).toHaveBeenCalledWith("a");
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("PaperContextMenu - anchored placement", () => {
    function openAt(placement: "below" | "below-right") {
        const target = document.createElement("button");
        document.body.appendChild(target);
        const rect = (r: { left: number; top: number; width: number; height: number }) =>
            ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r }) as DOMRect;
        const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            if (this === target) return rect({ left: 500, top: 100, width: 40, height: 32 });
            if (this.getAttribute("role") === "menu") return rect({ left: 0, top: 0, width: 200, height: 100 });
            return rect({ left: 0, top: 0, width: 0, height: 0 });
        });
        render(() => (
            <PaperContextMenu open={true} target={target} placement={placement}>
                <PaperContextMenuItem value="a">A</PaperContextMenuItem>
            </PaperContextMenu>
        ));
        return {
            menu: () => document.querySelector<HTMLElement>("[role='menu'][data-context-root]")!,
            cleanup: () => {
                spy.mockRestore();
                target.remove();
            },
        };
    }

    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

    test("below opens under the target with the left edges aligned", async () => {
        const { menu, cleanup } = openAt("below");
        try {
            await frame();
            expect(menu().style.left).toBe("500px");
            expect(menu().style.top).toBe("132px");
        } finally {
            cleanup();
        }
    });

    test("below-right aligns right edges instead of opening off the target's corner", async () => {
        const { menu, cleanup } = openAt("below-right");
        try {
            await frame();
            // target right edge 540 minus menu width 200; the old anchor put
            // the menu's left edge at 540, diagonal to the target
            expect(menu().style.left).toBe("340px");
            expect(menu().style.top).toBe("132px");
        } finally {
            cleanup();
        }
    });
});
