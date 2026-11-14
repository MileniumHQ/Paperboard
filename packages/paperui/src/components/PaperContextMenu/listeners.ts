// What an open context menu listens to, one installer per job. Each runs
// inside the menu's open effect and removes what it added when the menu
// closes (its own onCleanup).
import { onCleanup } from "solid-js";
import { forgetFocusBeforeMenu, rememberFocusBeforeMenu } from "../shared/menuFocus";
import { escapeAttributeValue } from "../../utils/selector";
import { pointInside } from "./position";

const LEVEL_SELECTOR = "[data-context-level]";

export interface SubMenuHandle {
    open: () => void;
    close: () => void;
}

/** The open menu, as its listeners see it. */
export interface OpenMenu {
    /** marks every element of this menu, including portaled submenu panels */
    rootId: string;
    rootSelector: string;
    /** the root panel, once it is mounted */
    panel: () => HTMLDivElement | undefined;
    /** submenu panels are portaled out of the menu, so "inside" is membership by id, never DOM containment */
    inMenu: (node: Node | null) => boolean;
    findItem: (value: string | number) => HTMLElement | null;
    highlightedItem: () => string | number | null;
    setHighlightedItem: (value: string | number | null) => void;
    scrollHighlightedIntoView: () => void;
    subHandles: Map<string, SubMenuHandle>;
    /** the element the menu was opened from, when it was opened from one */
    anchor: () => HTMLElement | null;
    overlay: () => boolean;
    closeOnEsc: () => boolean;
    close: () => void;
    reposition: () => void;
}

/**
 * What had focus goes back to having it when the menu closes, unless focus
 * has moved on to something else meanwhile.
 */
export function installFocusReturn(menu: OpenMenu) {
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement && active !== document.body && !menu.inMenu(active) ? active : null;
    if (returnTo) rememberFocusBeforeMenu(menu.rootId, returnTo);
    onCleanup(() => {
        forgetFocusBeforeMenu(menu.rootId);
        const now = document.activeElement;
        if (returnTo?.isConnected && (now === null || now === document.body || menu.inMenu(now))) {
            returnTo.focus({ preventScroll: true });
        }
    });
}

/**
 * Each menu level (the root and every open submenu panel) is its own list:
 * arrows move within the level of the highlighted item, Right/Enter descend
 * into a submenu, Left/Escape climb back out.
 */
export function installMenuKeyboard(menu: OpenMenu) {
    const levelItems = (level: Element) =>
        Array.from(
            level.querySelectorAll<HTMLElement>(
                "[data-context-item]:not([data-disabled='true'])",
            ),
        ).filter((el) => el.closest(LEVEL_SELECTOR) === level);

    const highlightIn = (items: HTMLElement[], index: number) => {
        const value = items[index]?.getAttribute("data-context-item");
        if (value) menu.setHighlightedItem(value);
        menu.scrollHighlightedIntoView();
    };

    const openSub = (subEl: HTMLElement) => {
        const id = subEl.getAttribute("data-context-sub");
        if (!id) return;
        menu.subHandles.get(id)?.open();
        const panel = document.querySelector(
            `${menu.rootSelector}[data-context-parent="${escapeAttributeValue(id)}"]`,
        );
        if (panel) highlightIn(levelItems(panel), 0);
    };

    const leaveLevel = (level: Element) => {
        const id = level.getAttribute("data-context-parent");
        if (!id) return;
        menu.subHandles.get(id)?.close();
        menu.setHighlightedItem(id);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        const root = menu.panel();
        if (!root) {
            if (menu.closeOnEsc() && e.key === "Escape") menu.close();
            return;
        }

        const currentHighlight = menu.highlightedItem();
        const current = currentHighlight === null ? null : menu.findItem(currentHighlight);
        const level = current?.closest(LEVEL_SELECTOR) ?? root;
        const inSub = level !== root;

        if (e.key === "Escape") {
            if (inSub) {
                e.preventDefault();
                leaveLevel(level);
            } else if (menu.closeOnEsc()) {
                menu.close();
            }
            return;
        }

        // a text field in the menu (a select's search) keeps its own editing keys: space types a space,
        // Home/End and the side arrows move the caret; Up/Down and Enter still work the list
        const editing =
            e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (editing && [" ", "Home", "End", "ArrowLeft", "ArrowRight"].includes(e.key)) return;

        const items = levelItems(level);
        if (items.length === 0) return;
        const currentIndex = current ? items.indexOf(current) : -1;
        const isSub = !!current?.hasAttribute("data-context-sub");

        if (e.key === "ArrowDown") {
            e.preventDefault();
            highlightIn(items, (currentIndex + 1) % items.length);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            highlightIn(
                items,
                currentIndex <= 0 ? items.length - 1 : currentIndex - 1,
            );
        } else if (e.key === "Home") {
            e.preventDefault();
            highlightIn(items, 0);
        } else if (e.key === "End") {
            e.preventDefault();
            highlightIn(items, items.length - 1);
        } else if (e.key === "ArrowRight") {
            if (current && isSub) {
                e.preventDefault();
                openSub(current);
            }
        } else if (e.key === "ArrowLeft") {
            if (inSub) {
                e.preventDefault();
                leaveLevel(level);
            }
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (current && isSub) openSub(current);
            else if (current && currentIndex >= 0) current.click();
        }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
}

/**
 * A press dragged across the menu highlights the item under the pointer.
 * `drag` outlives one opening: a drag that began while the menu was open
 * ends on its pointerup, whenever that comes.
 */
export function installDragHighlight(menu: OpenMenu, drag: { active: boolean }) {
    let pointerMoveRaf: number | null = null;

    const handlePointerMove = (e: PointerEvent) => {
        if (!menu.panel()) return;
        if (e.buttons === 1) {
            drag.active = true;
        }

        if (drag.active && !pointerMoveRaf) {
            pointerMoveRaf = requestAnimationFrame(() => {
                pointerMoveRaf = null;
                const hitEl = document.elementFromPoint(
                    e.clientX,
                    e.clientY,
                );
                const itemEl = hitEl?.closest<HTMLElement>(
                    "[data-context-item]",
                );
                if (itemEl) {
                    const itemVal =
                        itemEl.getAttribute("data-context-item");
                    if (itemVal) menu.setHighlightedItem(itemVal);
                } else {
                    menu.setHighlightedItem(null);
                }
            });
        }
    };

    const handlePointerUp = () => {
        drag.active = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    onCleanup(() => {
        if (pointerMoveRaf) cancelAnimationFrame(pointerMoveRaf);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
    });
}

/**
 * Closes the menu on the pointer-down of a press outside it, not just the
 * overlay's click: a menu must dismiss on a press that starts elsewhere even
 * when the press never becomes a click.
 */
export function installOutsideDismiss(menu: OpenMenu) {
    const handlePointerDown = (e: PointerEvent) => {
        if (!menu.panel()) return;
        const target = e.target instanceof Node ? e.target : null;
        if (target) {
            if (menu.inMenu(target)) return;
            // A dropdown's anchor is part of the menu it opens: the press
            // on its trigger must reach the trigger's click, which owns
            // the open/close decision (a select's toggle, a picker's
            // reopen). Dismissing on that press instead would close the
            // menu before the click arrives.
            const anchor = menu.anchor();
            if (anchor?.contains(target)) return;
            // A press on the overlay over the trigger is a second tap on
            // the trigger: the overlay's own click closes the menu. Closing
            // here would take the overlay away first, and a touch's click
            // then lands on the trigger beneath and opens it again.
            if (anchor && menu.overlay() && pointInside(anchor, e.clientX, e.clientY)) return;
        }
        menu.close();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    onCleanup(() => document.removeEventListener("pointerdown", handlePointerDown, true));
}

/**
 * Keeps the menu by its target: something scrolling under it closes it, a
 * keyboard coming or going and the menu's own size changing (a search) move
 * it. The one scroll that moves it instead is the page following a text
 * field in the menu.
 */
export function installReposition(menu: OpenMenu) {
    const handleScroll = (e: Event) => {
        const targetNode = e.target instanceof Node ? e.target : null;
        if (!menu.panel() || (targetNode && menu.inMenu(targetNode))) return;
        // A phone's keyboard rising for a text field in the menu (a select's search) scrolls the page to keep
        // the field in view. Closing then would take the field away and drop the keyboard again: the menu
        // follows its target instead.
        const typing = document.activeElement;
        const pageScrolled = targetNode === document || targetNode === document.scrollingElement;
        if (pageScrolled && (typing instanceof HTMLInputElement || typing instanceof HTMLTextAreaElement) && menu.inMenu(typing)) {
            menu.reposition();
            return;
        }
        menu.close();
    };

    window.addEventListener("scroll", handleScroll, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", menu.reposition);
    viewport?.addEventListener("scroll", menu.reposition);
    const panel = menu.panel();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => menu.reposition());
    if (panel) resized?.observe(panel);
    onCleanup(() => {
        window.removeEventListener("scroll", handleScroll, true);
        viewport?.removeEventListener("resize", menu.reposition);
        viewport?.removeEventListener("scroll", menu.reposition);
        resized?.disconnect();
    });
}
