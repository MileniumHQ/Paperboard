import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { PaperMenu, PaperMenuAction, PaperMenuItem } from "../index";

describe("PaperMenu", () => {
    test("a right-click on an entry, a link entry included, reaches its onContextMenu", () => {
        const onItem = vi.fn((e: MouseEvent) => e.preventDefault());
        const onLink = vi.fn();
        render(() => (
            <PaperMenu name="menu" value="a">
                <PaperMenuItem value="a" onContextMenu={onItem}>
                    Photos
                </PaperMenuItem>
                <PaperMenuItem value="b" href="#b" onContextMenu={onLink}>
                    Docs
                </PaperMenuItem>
            </PaperMenu>
        ));
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        screen.getByText("Photos").dispatchEvent(event);
        expect(onItem).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
        fireEvent.contextMenu(screen.getByText("Docs"));
        expect(onLink).toHaveBeenCalledTimes(1);
    });

    test("an action runs on a click and is never the menu's value", () => {
        const onValueChange = vi.fn();
        const onClick = vi.fn();
        render(() => (
            <PaperMenu name="menu" value="a" onValueChange={onValueChange}>
                <PaperMenuItem value="a">Photos</PaperMenuItem>
                <PaperMenuAction icon="add" onClick={onClick}>
                    Link a folder
                </PaperMenuAction>
            </PaperMenu>
        ));
        fireEvent.click(screen.getByRole("button", { name: /Link a folder/ }));
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onValueChange).not.toHaveBeenCalled();
    });
});
