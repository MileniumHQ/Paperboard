import { describe, test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import { PaperMenuBar, PaperMenuBarMenu } from "../components/PaperMenuBar";
import { PaperContextMenuItem, PaperContextMenuSub } from "../components/PaperContextMenu";
import { PaperSeparator } from "../components/PaperSeparator";

function renderBar(handlers: { onNew?: () => void; onUndo?: () => void } = {}) {
    return render(() => (
        <>
            <div data-testid="outside" />
            <PaperMenuBar aria-label="Project">
                <PaperMenuBarMenu label="File">
                    <PaperContextMenuItem value="new" icon="add" keybind="Ctrl+N" onClick={handlers.onNew}>
                        New
                    </PaperContextMenuItem>
                    <PaperContextMenuItem value="rename" disabled>
                        Rename
                    </PaperContextMenuItem>
                    <PaperSeparator role="separator" />
                    <PaperContextMenuItem value="delete" danger>
                        Delete
                    </PaperContextMenuItem>
                </PaperMenuBarMenu>
                <PaperMenuBarMenu label="Edit">
                    <PaperContextMenuItem value="undo" onClick={handlers.onUndo}>
                        Undo
                    </PaperContextMenuItem>
                    <PaperContextMenuSub label="Paste as">
                        <PaperContextMenuItem value="plain">Plain text</PaperContextMenuItem>
                    </PaperContextMenuSub>
                </PaperMenuBarMenu>
                <PaperMenuBarMenu label="View" disabled>
                    <PaperContextMenuItem value="zoom">Zoom</PaperContextMenuItem>
                </PaperMenuBarMenu>
            </PaperMenuBar>
        </>
    ));
}

const label = (name: string) => screen.getByRole("menuitem", { name });
const openMenus = () => screen.queryAllByRole("menu");
const highlighted = () =>
    document.querySelector("[role='menu']")?.getAttribute("aria-activedescendant");

describe("PaperMenuBar", () => {
    test("the bar is a menubar whose labels are menu items that start closed", () => {
        renderBar();

        expect(screen.getByRole("menubar", { name: "Project" })).toBeDefined();
        const file = label("File");
        expect(file.getAttribute("aria-haspopup")).toBe("menu");
        expect(file.getAttribute("aria-expanded")).toBe("false");
        expect(openMenus()).toHaveLength(0);
    });

    test("a click opens the label's menu, named after the label, with its items", () => {
        renderBar();

        fireEvent.click(label("File"));

        expect(label("File").getAttribute("aria-expanded")).toBe("true");
        const menu = screen.getByRole("menu", { name: "File" });
        expect(menu.querySelectorAll("[role='menuitem']")).toHaveLength(3);
        expect(screen.getByText("Ctrl+N")).toBeDefined();
        expect(screen.getByText("add")).toBeDefined();
        expect(screen.getByRole("separator")).toBeDefined();
    });

    test("clicking the open label closes its menu", () => {
        renderBar();

        fireEvent.click(label("File"));
        fireEvent.click(label("File"));

        expect(openMenus()).toHaveLength(0);
        expect(label("File").getAttribute("aria-expanded")).toBe("false");
    });

    test("choosing an item runs it and closes the menu", () => {
        const onNew = vi.fn();
        renderBar({ onNew });

        fireEvent.click(label("File"));
        fireEvent.click(screen.getByText("New"));

        expect(onNew).toHaveBeenCalledTimes(1);
        expect(openMenus()).toHaveLength(0);
    });

    test("a disabled item does nothing and leaves the menu open", () => {
        renderBar();

        fireEvent.click(label("File"));
        fireEvent.click(screen.getByText("Rename"));

        expect(openMenus()).toHaveLength(1);
    });

    test("hovering another label while a menu is open switches to it", () => {
        renderBar();

        fireEvent.click(label("File"));
        fireEvent.pointerEnter(label("Edit"), { pointerType: "mouse" });

        expect(label("File").getAttribute("aria-expanded")).toBe("false");
        expect(label("Edit").getAttribute("aria-expanded")).toBe("true");
        expect(screen.getAllByRole("menu")).toHaveLength(1);
        expect(screen.getByRole("menu", { name: "Edit" })).toBeDefined();
    });

    test("hovering a label while every menu is closed opens nothing", () => {
        renderBar();

        fireEvent.pointerEnter(label("Edit"), { pointerType: "mouse" });

        expect(openMenus()).toHaveLength(0);
    });

    test("a touch passing over a label does not switch menus", () => {
        renderBar();

        fireEvent.click(label("File"));
        fireEvent.pointerEnter(label("Edit"), { pointerType: "touch" });

        expect(label("File").getAttribute("aria-expanded")).toBe("true");
    });

    test("a disabled menu never opens, by click or hover", () => {
        renderBar();

        fireEvent.click(label("View"));
        fireEvent.click(label("File"));
        fireEvent.pointerEnter(label("View"), { pointerType: "mouse" });

        expect(label("View").getAttribute("aria-expanded")).toBe("false");
        expect(label("File").getAttribute("aria-expanded")).toBe("true");
    });

    test("Escape closes the menu and returns focus to its label", async () => {
        renderBar();
        label("File").focus();

        fireEvent.click(label("File"));
        await fireEvent.keyDown(window, { key: "Escape" });

        expect(openMenus()).toHaveLength(0);
        expect(document.activeElement).toBe(label("File"));
    });

    test("a press outside closes the menu", () => {
        renderBar();

        fireEvent.click(label("File"));
        fireEvent.pointerDown(screen.getByTestId("outside"));

        expect(openMenus()).toHaveLength(0);
    });

    test("the open menu leaves the rest of the page reachable: no click-catching overlay", () => {
        renderBar();

        fireEvent.click(label("File"));

        expect(document.querySelector("[class*='contextMenuOverlay']")).toBeNull();
    });

    test("Left and Right move an open menu between labels, wrapping and skipping disabled ones", async () => {
        renderBar();
        fireEvent.click(label("File"));

        await fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(label("Edit").getAttribute("aria-expanded")).toBe("true");
        expect(label("File").getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(label("Edit"));

        // View is disabled, so the next label wraps around to File
        await fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(label("File").getAttribute("aria-expanded")).toBe("true");

        await fireEvent.keyDown(window, { key: "ArrowLeft" });
        expect(label("Edit").getAttribute("aria-expanded")).toBe("true");
    });

    test("Up and Down move the highlight within the open menu and Enter activates it", async () => {
        const onNew = vi.fn();
        renderBar({ onNew });
        fireEvent.click(label("File"));

        await fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(highlighted()).toBe("paper-menuitem-new");

        // Rename is disabled, so Down lands on Delete
        await fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(highlighted()).toBe("paper-menuitem-delete");

        await fireEvent.keyDown(window, { key: "ArrowUp" });
        expect(highlighted()).toBe("paper-menuitem-new");

        await fireEvent.keyDown(window, { key: "Enter" });
        expect(onNew).toHaveBeenCalledTimes(1);
        expect(openMenus()).toHaveLength(0);
    });

    test("Right on a submenu row opens the submenu instead of changing menus", async () => {
        renderBar();
        fireEvent.click(label("Edit"));

        await fireEvent.keyDown(window, { key: "ArrowDown" });
        await fireEvent.keyDown(window, { key: "ArrowDown" });
        await fireEvent.keyDown(window, { key: "ArrowRight" });

        expect(label("Edit").getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByText("Plain text")).toBeDefined();
    });

    test("Down on a focused label opens its menu on the first item", () => {
        renderBar();
        label("File").focus();

        fireEvent.keyDown(label("File"), { key: "ArrowDown" });

        expect(label("File").getAttribute("aria-expanded")).toBe("true");
        expect(highlighted()).toBe("paper-menuitem-new");
    });

    test("Up on a focused label opens its menu on the last item", () => {
        renderBar();
        label("File").focus();

        fireEvent.keyDown(label("File"), { key: "ArrowUp" });

        expect(highlighted()).toBe("paper-menuitem-delete");
    });

    test("Left and Right on a focused label move focus between labels without opening", () => {
        renderBar();
        label("File").focus();

        fireEvent.keyDown(label("File"), { key: "ArrowRight" });

        expect(document.activeElement).toBe(label("Edit"));
        expect(openMenus()).toHaveLength(0);
    });

    test("the bar is one tab stop that follows focus", () => {
        renderBar();

        expect(label("File").tabIndex).toBe(0);
        expect(label("Edit").tabIndex).toBe(-1);

        label("Edit").focus();

        expect(label("File").tabIndex).toBe(-1);
        expect(label("Edit").tabIndex).toBe(0);
    });

    test("a menu outside a PaperMenuBar fails loudly", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() =>
            render(() => (
                <PaperMenuBarMenu label="File">
                    <PaperContextMenuItem value="new">New</PaperContextMenuItem>
                </PaperMenuBarMenu>
            )),
        ).toThrow("PaperMenuBarMenu must be rendered inside a PaperMenuBar");
    });
});
