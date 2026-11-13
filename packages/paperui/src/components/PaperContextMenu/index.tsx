import styles from "./index.module.css";
import menuStyles from "../shared/menu.module.css";
import { MenuItem } from "../shared/MenuItem";
import {
    createContext,
    useContext,
    createSignal,
    createEffect,
    createUniqueId,
    children as resolveChildren,
    onCleanup,
    splitProps,
    Show,
    on,
    type ParentProps,
    type JSX,
} from "solid-js";
import { contextMenuDismissals } from "../shared/contextMenuDismiss";
import { Portal } from "solid-js/web";
import { PaperIcon } from "../PaperIcon";

export type ContextMenuTarget =
    | MouseEvent
    | PointerEvent
    | HTMLElement
    | Event
    | { clientX: number; clientY: number }
    | { x: number; y: number }
    | null;

export type ContextMenuPlacement =
    | "mouse"
    | "below"
    | "below-left"
    | "below-right"
    | "above"
    | "above-left"
    | "above-right";

export interface PaperContextMenuProps extends JSX.HTMLAttributes<HTMLDivElement> {
    x?: number;
    y?: number;
    target?: ContextMenuTarget;
    placement?: ContextMenuPlacement;
    open?: boolean;
    onClose?: () => void;
    closeOnEsc?: boolean;
    closeOnClick?: boolean;
    /**
     * Keeps the panel mounted while closed (display:none) so children that
     * register themselves — dropdown options labeling their trigger — survive
     * dismissal.
     */
    keepMounted?: boolean;
    /**
     * Makes the panel at least as wide as its target element (dropdowns
     * matching their trigger), still growing for wider items like
     * descriptions.
     */
    matchTargetWidth?: boolean;
    /** Item highlighted as soon as the menu opens (dropdowns start on the chosen value). */
    initialHighlight?: string | number | null;
    /**
     * Covers the page with a transparent click-catcher while open (default).
     * A menu bar turns it off: its other labels must stay reachable so
     * hovering one can switch menus. Outside presses still dismiss.
     */
    overlay?: boolean;
    /**
     * Smaller items: tighter padding, small text and icons. For dense
     * surfaces like a canvas's right-click menu or a toolbar's dropdowns;
     * its submenus open compact too.
     */
    compact?: boolean;
}

export function positionFromTarget(
    target: ContextMenuTarget,
    placement: ContextMenuPlacement = "mouse",
): { x: number; y: number } | null {
    if (!target) return null;

    if (
        "x" in target &&
        typeof target.x === "number" &&
        "y" in target &&
        typeof target.y === "number" &&
        !("getBoundingClientRect" in target)
    ) {
        return { x: target.x, y: target.y };
    }

    const resolvedEl = elementFromTarget(target);

    if (resolvedEl && placement !== "mouse") {
        return getElementPosition(resolvedEl, placement);
    }

    if (
        "clientX" in target &&
        "clientY" in target &&
        typeof (target as any).clientX === "number"
    ) {
        if (placement === "mouse") {
            return { x: (target as any).clientX, y: (target as any).clientY };
        }
    }

    if (resolvedEl) {
        return getElementPosition(resolvedEl, placement);
    }

    return null;
}

function pointInside(el: Element, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function elementFromTarget(target: ContextMenuTarget): HTMLElement | null {
    if (!target) return null;
    if (target instanceof HTMLElement) return target;
    if (typeof target === "object" && ("currentTarget" in target || "target" in target)) {
        const el = ((target as any).currentTarget ||
            (target as any).target) as HTMLElement | null;
        return el && typeof el.getBoundingClientRect === "function" ? el : null;
    }
    return null;
}

function getElementPosition(
    el: HTMLElement,
    placement: ContextMenuPlacement,
): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    switch (placement) {
        case "below-right":
            return { x: rect.right, y: rect.bottom };
        case "above":
        case "above-left":
            return { x: rect.left, y: rect.top };
        case "above-right":
            return { x: rect.right, y: rect.top };
        case "below":
        case "below-left":
        default:
            return { x: rect.left, y: rect.bottom };
    }
}

/**
 * Horizontal placement for a floating menu: anchored by its left edge to the
 * target's left edge. When the menu would run past the right edge of the
 * viewport, it is anchored by its right edge to the target's right edge
 * instead. Clamping to the viewport is the last resort — a menu with no room
 * on either side of its target, or a mouse-positioned menu with no target
 * edge to anchor to.
 */
export function resolveMenuLeft(
    targetLeft: number,
    targetRight: number | null,
    menuWidth: number,
    viewportWidth: number,
    padding = 12,
): number {
    let left = targetLeft;
    if (left + menuWidth > viewportWidth - padding) {
        left =
            targetRight === null
                ? viewportWidth - menuWidth - padding
                : targetRight - menuWidth;
    }
    return Math.max(padding, left);
}

function resolveTargetElement(
    e: MouseEvent | PointerEvent | HTMLElement | Event | ContextMenuTarget,
): ContextMenuTarget {
    if (!e) return null;
    if (e instanceof HTMLElement) return e;

    if (typeof e === "object" && ("currentTarget" in e || "target" in e)) {
        const evt = e as any;
        const el = (evt.currentTarget || evt.target) as HTMLElement | null;
        if (el && typeof el.getBoundingClientRect === "function") {
            return el;
        }
    }

    return e as ContextMenuTarget;
}

export function useContextMenuState(
    initialPlacement: ContextMenuPlacement = "mouse",
) {
    const [target, setTarget] = createSignal<ContextMenuTarget>(null);
    const [placement, setPlacement] =
        createSignal<ContextMenuPlacement>(initialPlacement);

    const openAtMouse = (e: MouseEvent | PointerEvent) => {
        if ("preventDefault" in e && typeof e.preventDefault === "function") {
            e.preventDefault();
        }
        setPlacement("mouse");
        setTarget(e);
    };

    const openBelow = (
        e: MouseEvent | PointerEvent | HTMLElement | Event,
        options?: { align?: "left" | "right" },
    ) => {
        setPlacement(options?.align === "right" ? "below-right" : "below");
        setTarget(resolveTargetElement(e));
    };

    const openAbove = (
        e: MouseEvent | PointerEvent | HTMLElement | Event,
        options?: { align?: "left" | "right" },
    ) => {
        setPlacement(options?.align === "right" ? "above-right" : "above");
        setTarget(resolveTargetElement(e));
    };

    const close = () => setTarget(null);

    return {
        target,
        placement,
        isOpen: () => target() !== null,
        openAtMouse,
        openAtCursor: openAtMouse,
        openBelow,
        openAbove,
        close,
        setTarget,
        setPlacement,
    };
}

const LEVEL_SELECTOR = "[data-context-level]";

/** The bottom of what's on screen: above a phone's keyboard, which covers the page without shrinking the window. */
function visibleHeight(): number {
    return Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
}

/**
 * Where a fixed box at 0, 0 shows up, in the coordinates getBoundingClientRect gives. It's 0, 0 until a browser's
 * fixed layer and its measurements part: iOS Safari scrolls the page for a keyboard and measures from what's visible,
 * while fixed boxes stay on the page. A menu placed by its target's measurements is moved back by this.
 */
function fixedOrigin(host: HTMLElement): { x: number; y: number } {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none";
    host.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { x: r.left, y: r.top };
}

interface SubMenuHandle {
    open: () => void;
    close: () => void;
}

interface ContextMenuContextType {
    /** Marks every element of this menu, including portaled submenu panels. */
    rootId: string;
    closeMenu: () => void;
    /** Lets the keyboard handler open and close a submenu by its item id. */
    registerSub: (id: string, handle: SubMenuHandle) => () => void;
    highlightedItem: () => string | number | null;
    setHighlightedItem: (val: string | number | null) => void;
    /** the menu is compact, so its portaled submenus are too */
    compact: () => boolean;
}

const ContextMenuContext = createContext<ContextMenuContextType>();

export function useContextMenu() {
    return useContext(ContextMenuContext);
}

interface SubMenuLevelContextType {
    activeSubMenu: () => string | null;
    setActiveSubMenu: (id: string | null) => void;
}

const SubMenuLevelContext = createContext<SubMenuLevelContextType>();

function escapeAttributeValue(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
}

export function PaperContextMenu(props: ParentProps<PaperContextMenuProps>) {
    let menuRef: HTMLDivElement | undefined;

    const [local, rest] = splitProps(props, [
        "x",
        "y",
        "target",
        "placement",
        "open",
        "onClose",
        "closeOnEsc",
        "closeOnClick",
        "keepMounted",
        "matchTargetWidth",
        "initialHighlight",
        "overlay",
        "compact",
        "class",
        "classList",
        "children",
    ]);

    const [coords, setCoords] = createSignal({ left: 0, top: 0 });
    const [highlightedItem, setHighlightedItem] = createSignal<
        string | number | null
    >(null);
    const [activeSubMenu, setActiveSubMenu] = createSignal<string | null>(null);
    // one entry per mounted submenu; each removes itself on cleanup
    const subHandles = new Map<string, SubMenuHandle>();
    // Submenu panels are portaled out of the scrolling menu, so "inside this
    // menu" is membership by id, never DOM containment.
    const rootId = createUniqueId();
    const rootSelector = `[data-context-root="${rootId}"]`;
    const inMenu = (node: Node | null) => {
        const el = node instanceof Element ? node : (node?.parentElement ?? null);
        return !!el?.closest(rootSelector);
    };
    const findItem = (value: string | number) =>
        document.querySelector<HTMLElement>(
            `${rootSelector} [data-context-item="${escapeAttributeValue(String(value))}"]`,
        );
    let isDraggingGesture = false;

    const updatePosition = () => {
        if (!menuRef) return;

        const resolvedEl = elementFromTarget(local.target ?? null);
        if (local.matchTargetWidth && resolvedEl) {
            // a floor, not a fixed width: the panel still grows for wider
            // items (descriptions), it just never looks narrower than the
            // control it belongs to
            const width = Math.max(
                160,
                Math.round(resolvedEl.getBoundingClientRect().width),
            );
            menuRef.style.minWidth = `${width}px`;
        }

        let targetX = local.x;
        let targetY = local.y;

        if (targetX === undefined || targetY === undefined) {
            const defaultPlacement: ContextMenuPlacement =
                local.target &&
                "clientX" in (local.target as any) &&
                !("currentTarget" in (local.target as any))
                    ? "mouse"
                    : "below";
            const pos = positionFromTarget(
                local.target ?? null,
                local.placement ?? defaultPlacement,
            );
            targetX = pos?.x ?? 0;
            targetY = pos?.y ?? 0;
        }

        const rect = menuRef.getBoundingClientRect();
        const targetRect = resolvedEl?.getBoundingClientRect() ?? null;
        const padding = 12;

        const placementMode = local.placement || "mouse";
        // "-right" placements line the menu's right edge up with the
        // target's; anchoring its left edge there would open it diagonally
        // off the target's corner
        const anchorX =
            targetRect && placementMode.endsWith("-right")
                ? targetRect.right - rect.width
                : targetX;

        const left = resolveMenuLeft(
            anchorX,
            targetRect?.right ?? null,
            rect.width,
            window.innerWidth,
            padding,
        );
        let top = targetY;

        const isBelowMode = placementMode.startsWith("below");
        const bottom = visibleHeight();

        if (isBelowMode && top + rect.height > bottom - padding) {
            if (resolvedEl) {
                const elRect = resolvedEl.getBoundingClientRect();
                top = Math.max(padding, elRect.top - rect.height);
            } else {
                top = Math.max(
                    padding,
                    bottom - rect.height - padding,
                );
            }
        } else if (top + rect.height > bottom - padding) {
            top = Math.max(padding, top - rect.height);
        }

        if (top < padding) {
            top = padding;
        }

        const origin = fixedOrigin(menuRef.parentElement ?? document.body);
        setCoords({ left: left - origin.x, top: top - origin.y });
    };

    const handleClose = () => {
        setHighlightedItem(null);
        setActiveSubMenu(null);
        local.onClose?.();
    };

    // the item it was opened on was picked up and carried away
    createEffect(on(contextMenuDismissals, () => {
        if (local.open) handleClose();
    }, { defer: true }));

    const scrollHighlightedIntoView = () => {
        const value = highlightedItem();
        if (value === null) return;
        findItem(value)?.scrollIntoView?.({ block: "nearest" });
    };

    createEffect(() => {
        if (!local.open) {
            setActiveSubMenu(null);
            return;
        }

        const initial = local.initialHighlight;
        setHighlightedItem(initial === undefined || initial === null ? null : String(initial));
        requestAnimationFrame(() => {
            updatePosition();
            scrollHighlightedIntoView();
        });

        let pointerMoveRaf: number | null = null;

        // Each menu level (the root and every open submenu panel) is its
        // own list: arrows move within the level of the highlighted item,
        // Right/Enter descend into a submenu, Left/Escape climb back out.
        const levelItems = (level: Element) =>
            Array.from(
                level.querySelectorAll<HTMLElement>(
                    "[data-context-item]:not([data-disabled='true'])",
                ),
            ).filter((el) => el.closest(LEVEL_SELECTOR) === level);

        const highlightIn = (items: HTMLElement[], index: number) => {
            const value = items[index]?.getAttribute("data-context-item");
            if (value) setHighlightedItem(value);
            scrollHighlightedIntoView();
        };

        const openSub = (subEl: HTMLElement) => {
            const id = subEl.getAttribute("data-context-sub");
            if (!id) return;
            subHandles.get(id)?.open();
            const panel = document.querySelector(
                `${rootSelector}[data-context-parent="${escapeAttributeValue(id)}"]`,
            );
            if (panel) highlightIn(levelItems(panel), 0);
        };

        const leaveLevel = (level: Element) => {
            const id = level.getAttribute("data-context-parent");
            if (!id) return;
            subHandles.get(id)?.close();
            setHighlightedItem(id);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!menuRef) {
                if ((local.closeOnEsc ?? true) && e.key === "Escape") handleClose();
                return;
            }

            const currentHighlight = highlightedItem();
            const current = currentHighlight === null ? null : findItem(currentHighlight);
            const level = current?.closest(LEVEL_SELECTOR) ?? menuRef;
            const inSub = level !== menuRef;

            if (e.key === "Escape") {
                if (inSub) {
                    e.preventDefault();
                    leaveLevel(level);
                } else if (local.closeOnEsc ?? true) {
                    handleClose();
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

        const handleGlobalPointerMove = (e: PointerEvent) => {
            if (!menuRef) return;
            if (e.buttons === 1) {
                isDraggingGesture = true;
            }

            if (isDraggingGesture && !pointerMoveRaf) {
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
                        if (itemVal) setHighlightedItem(itemVal);
                    } else {
                        setHighlightedItem(null);
                    }
                });
            }
        };

        const handleGlobalPointerUp = () => {
            if (isDraggingGesture) {
                isDraggingGesture = false;
            }
        };

        // pointerdown, not just the overlay click: a menu must dismiss on the
        // press that starts elsewhere even when the press never becomes a click
        const handleOutsidePointerDown = (e: PointerEvent) => {
            if (!menuRef) return;
            const target = e.target instanceof Node ? e.target : null;
            if (target) {
                if (inMenu(target)) return;
                // A dropdown's anchor is part of the menu it opens: the press
                // on its trigger must reach the trigger's click, which owns
                // the open/close decision (a select's toggle, a picker's
                // reopen). Dismissing on that press instead would close the
                // menu before the click arrives.
                const anchor = local.target instanceof HTMLElement ? local.target : null;
                if (anchor?.contains(target)) return;
                // A press on the overlay over the trigger is a second tap on
                // the trigger: the overlay's own click closes the menu. Closing
                // here would take the overlay away first, and a touch's click
                // then lands on the trigger beneath and opens it again.
                if (anchor && local.overlay !== false && pointInside(anchor, e.clientX, e.clientY)) return;
            }
            handleClose();
        };

        const handleScroll = (e: Event) => {
            const targetNode = e.target instanceof Node ? e.target : null;
            if (!menuRef || (targetNode && inMenu(targetNode))) return;
            // A phone's keyboard rising for a text field in the menu (a select's search) scrolls the page to keep
            // the field in view. Closing then would take the field away and drop the keyboard again: the menu
            // follows its target instead.
            const typing = document.activeElement;
            const pageScrolled = targetNode === document || targetNode === document.scrollingElement;
            if (pageScrolled && (typing instanceof HTMLInputElement || typing instanceof HTMLTextAreaElement) && inMenu(typing)) {
                updatePosition();
                return;
            }
            handleClose();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        window.addEventListener("pointerup", handleGlobalPointerUp);
        window.addEventListener("scroll", handleScroll, true);
        document.addEventListener("pointerdown", handleOutsidePointerDown, true);
        // a keyboard coming or going changes what's visible, and a search changes the menu's height: it stays by its target
        const viewport = window.visualViewport;
        viewport?.addEventListener("resize", updatePosition);
        viewport?.addEventListener("scroll", updatePosition);
        const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => updatePosition());
        if (menuRef) resized?.observe(menuRef);

        onCleanup(() => {
            viewport?.removeEventListener("resize", updatePosition);
            viewport?.removeEventListener("scroll", updatePosition);
            resized?.disconnect();
            if (pointerMoveRaf) cancelAnimationFrame(pointerMoveRaf);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
            window.removeEventListener("pointerup", handleGlobalPointerUp);
            window.removeEventListener("scroll", handleScroll, true);
            document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
        });
    });

    const contextValue: ContextMenuContextType = {
        rootId,
        compact: () => Boolean(local.compact),
        registerSub: (id, handle) => {
            subHandles.set(id, handle);
            return () => {
                if (subHandles.get(id) === handle) subHandles.delete(id);
            };
        },
        closeMenu: () => {
            if (local.closeOnClick ?? true) {
                handleClose();
            }
        },
        highlightedItem,
        setHighlightedItem,
    };

    const subMenuContextValue: SubMenuLevelContextType = {
        activeSubMenu,
        setActiveSubMenu,
    };

    const style = (): JSX.CSSProperties => {
        const c = coords();
        return {
            left: `${c.left}px`,
            top: `${c.top}px`,
        };
    };

    const activeDescendantId = () => {
        const item = highlightedItem();
        return item ? `paper-menuitem-${item}` : undefined;
    };

    return (
        <Show when={local.open || local.keepMounted}>
            <Portal>
                <Show when={local.open && (local.overlay ?? true)}>
                    <div class={styles.contextMenuOverlay} onClick={handleClose} />
                </Show>
                <SubMenuLevelContext.Provider value={subMenuContextValue}>
                    <ContextMenuContext.Provider value={contextValue}>
                        <div
                            ref={(el) => {
                                menuRef = el;
                                updatePosition();
                            }}
                            role="menu"
                            data-context-level=""
                            data-context-root={rootId}
                            tabIndex={-1}
                            aria-activedescendant={activeDescendantId()}
                            aria-hidden={!local.open}
                            {...rest}
                            class={[menuStyles.menu, local.compact ? menuStyles.compact : "", local.open ? "" : menuStyles.closed, local.class]
                                .filter(Boolean)
                                .join(" ")}
                            classList={local.classList}
                            style={style()}
                        >
                            {local.children}
                        </div>
                    </ContextMenuContext.Provider>
                </SubMenuLevelContext.Provider>
            </Portal>
        </Show>
    );
}

export interface PaperContextMenuItemProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value?: string | number;
    icon?: JSX.Element | string;
    description?: JSX.Element | string;
    keybind?: string;
    shortcut?: string;
    danger?: boolean;
    disabled?: boolean;
    /** Trailing check mark, for menus that choose the current value. */
    checked?: boolean;
}

export function PaperContextMenuItem(
    props: ParentProps<PaperContextMenuItemProps>,
) {
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "description",
        "keybind",
        "shortcut",
        "danger",
        "disabled",
        "checked",
        "class",
        "classList",
        "onClick",
        "children",
    ]);

    const ctx = useContextMenu();
    const subCtx = useContext(SubMenuLevelContext);
    // resolved once: the label is rendered from this, and read for the value
    const label = resolveChildren(() => local.children);
    // a label that is not text has no readable identity: the item gets an id
    const generatedValue = `item-${createUniqueId()}`;
    const itemValue = () => {
        if (local.value !== undefined) return String(local.value);
        const text = label();
        return typeof text === "string" || typeof text === "number" ? String(text) : generatedValue;
    };

    const isHighlighted = () => ctx?.highlightedItem() === itemValue();

    const handleClick: JSX.EventHandler<HTMLDivElement, MouseEvent> = (e) => {
        if (local.disabled) return;

        if (typeof local.onClick === "function") {
            (local.onClick as any)(e);
        }

        ctx?.closeMenu();
    };

    const keybindText = () => local.keybind ?? local.shortcut;

    return (
        <MenuItem
            id={`paper-menuitem-${itemValue()}`}
            role={local.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={local.checked === undefined ? undefined : local.checked}
            data-context-item={itemValue()}
            data-disabled={local.disabled ? "true" : "false"}
            tabIndex={-1}
            {...rest}
            icon={local.icon}
            description={local.description}
            keybind={keybindText()}
            danger={local.danger}
            disabled={local.disabled}
            highlighted={isHighlighted()}
            checked={local.checked}
            class={local.class}
            classList={local.classList}
            onClick={handleClick}
            onPointerEnter={() => {
                ctx?.setHighlightedItem(itemValue());
                subCtx?.setActiveSubMenu(null);
            }}
            onPointerLeave={() => {
                if (ctx?.highlightedItem() === itemValue()) {
                    ctx?.setHighlightedItem(null);
                }
            }}
        >
            {label()}
        </MenuItem>
    );
}

export interface PaperContextMenuSubProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    label?: JSX.Element | string;
    title?: JSX.Element | string;
    icon?: JSX.Element | string;
}

export function PaperContextMenuSub(
    props: ParentProps<PaperContextMenuSubProps>,
) {
    let subRef: HTMLDivElement | undefined;
    let rowRef: HTMLDivElement | undefined;
    let closeTimeout: number | undefined;
    let flipRaf: number | undefined;

    const [local, rest] = splitProps(props, [
        "label",
        "title",
        "icon",
        "class",
        "classList",
        "children",
    ]);

    // An id, not the label: two submenus may share a label, and the id is
    // also this row's item value for keyboard highlight and activedescendant.
    const subId = `sub-${createUniqueId()}`;
    const subLabel = () => local.label || local.title || "";
    const ctx = useContextMenu();
    const subCtx = useContext(SubMenuLevelContext);
    const [childActiveSubMenu, setChildActiveSubMenu] = createSignal<string | null>(null);
    const childSubMenuContextValue: SubMenuLevelContextType = {
        activeSubMenu: childActiveSubMenu,
        setActiveSubMenu: setChildActiveSubMenu,
    };

    const isOpen = () => subCtx?.activeSubMenu() === subId;
    const isHighlighted = () => isOpen() || ctx?.highlightedItem() === subId;

    const [flipX, setFlipX] = createSignal(false);
    const [flipY, setFlipY] = createSignal(false);
    const [coords, setCoords] = createSignal({ left: 0, top: 0 });

    const cancelClose = () => {
        if (closeTimeout) {
            clearTimeout(closeTimeout);
            closeTimeout = undefined;
        }
    };

    const scheduleClose = () => {
        cancelClose();
        closeTimeout = window.setTimeout(() => {
            if (subCtx?.activeSubMenu() === subId) {
                subCtx?.setActiveSubMenu(null);
            }
        }, 150);
    };

    // The panel is portaled and fixed: placed at the row's right edge (CSS
    // margins supply the gap), then flipped once measured if it would leave
    // the viewport.
    const place = () => {
        if (!rowRef) return;
        const row = rowRef.getBoundingClientRect();
        const panel = subRef?.getBoundingClientRect();
        const pad = 12;
        const fitsRight = !panel || row.right + panel.width <= window.innerWidth - pad;
        const fitsBelow = !panel || row.top + panel.height <= window.innerHeight - pad;
        setFlipX(!fitsRight);
        setFlipY(!fitsBelow);
        setCoords({
            left: fitsRight ? row.right : row.left - (panel?.width ?? 0),
            top: fitsBelow
                ? row.top
                : Math.max(pad, window.innerHeight - pad - (panel?.height ?? 0)),
        });
    };

    const open = () => {
        cancelClose();
        subCtx?.setActiveSubMenu(subId);
        place();
        if (flipRaf) cancelAnimationFrame(flipRaf);
        flipRaf = requestAnimationFrame(() => {
            flipRaf = undefined;
            place();
        });
    };

    const close = () => {
        cancelClose();
        if (subCtx?.activeSubMenu() === subId) subCtx.setActiveSubMenu(null);
    };

    const unregister = ctx?.registerSub(subId, { open, close });

    onCleanup(() => {
        cancelClose();
        if (flipRaf) cancelAnimationFrame(flipRaf);
        unregister?.();
    });

    const subClassName = () =>
        [
            menuStyles.subMenuPanel,
            ctx?.compact() ? menuStyles.compact : "",
            flipX() ? menuStyles.flipX : "",
            flipY() ? menuStyles.flipY : "",
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            ref={rowRef}
            id={`paper-menuitem-${subId}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={isOpen()}
            tabIndex={-1}
            {...rest}
            data-context-item={subId}
            data-context-sub={subId}
            class={[
                menuStyles.item,
                isHighlighted() ? menuStyles.highlighted : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
            onPointerEnter={() => {
                ctx?.setHighlightedItem(subId);
                open();
            }}
            onPointerLeave={scheduleClose}
            // touch has no hover: a tap on the row opens it
            onClick={open}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={menuStyles.itemIcon}>{local.icon}</PaperIcon>
                ) : (
                    <span class={menuStyles.itemIcon}>{local.icon}</span>
                )}
            </Show>

            <span class={menuStyles.itemLabel}>{subLabel()}</span>
            <PaperIcon class={menuStyles.subMenuIndicator} zeroHeight>chevron_right</PaperIcon>

            <Show when={isOpen()}>
                <Portal>
                    <SubMenuLevelContext.Provider value={childSubMenuContextValue}>
                        <div
                            ref={subRef}
                            role="menu"
                            data-context-level=""
                            data-context-root={ctx?.rootId}
                            data-context-parent={subId}
                            aria-label={typeof subLabel() === "string" ? (subLabel() as string) : undefined}
                            class={subClassName()}
                            style={{ left: `${coords().left}px`, top: `${coords().top}px` }}
                            onPointerEnter={cancelClose}
                            onPointerLeave={scheduleClose}
                        >
                            {local.children}
                        </div>
                    </SubMenuLevelContext.Provider>
                </Portal>
            </Show>
        </div>
    );
}

export interface PaperContextMenuHeaderProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function PaperContextMenuHeader(props: ParentProps<PaperContextMenuHeaderProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    const className = () =>
        [menuStyles.header, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            {local.children}
        </div>
    );
}
