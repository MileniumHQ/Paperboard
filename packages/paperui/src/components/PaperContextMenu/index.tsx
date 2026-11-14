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
import { escapeAttributeValue } from "../../utils/selector";
import {
    installDragHighlight,
    installFocusReturn,
    installMenuKeyboard,
    installOutsideDismiss,
    installReposition,
    type OpenMenu,
    type SubMenuHandle,
} from "./listeners";
import {
    elementFromTarget,
    placeMenu,
    placeSubmenu,
    type ContextMenuPlacement,
    type ContextMenuTarget,
} from "./position";
import { cx } from "../../utils/cx";

export { positionFromTarget, resolveMenuLeft, type ContextMenuPlacement, type ContextMenuTarget } from "./position";

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
        setTarget(elementFromTarget(e) ?? e);
    };

    const openAbove = (
        e: MouseEvent | PointerEvent | HTMLElement | Event,
        options?: { align?: "left" | "right" },
    ) => {
        setPlacement(options?.align === "right" ? "above-right" : "above");
        setTarget(elementFromTarget(e) ?? e);
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
    // a drag in progress, across openings
    const drag = { active: false };

    const updatePosition = () => {
        if (!menuRef) return;
        setCoords(placeMenu(menuRef, local));
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

    const openMenu: OpenMenu = {
        rootId,
        rootSelector,
        panel: () => menuRef,
        inMenu,
        findItem,
        highlightedItem,
        setHighlightedItem,
        scrollHighlightedIntoView,
        subHandles,
        anchor: () => (local.target instanceof HTMLElement ? local.target : null),
        overlay: () => local.overlay !== false,
        closeOnEsc: () => local.closeOnEsc ?? true,
        close: handleClose,
        reposition: updatePosition,
    };

    // runs as the menu opens and closes, and on nothing else: a parent that
    // changes initialHighlight (a select's value) while the menu is open must
    // not hand focus back to the trigger and rebuild every listener
    createEffect(on(() => local.open, (open) => {
        if (!open) {
            setActiveSubMenu(null);
            return;
        }

        installFocusReturn(openMenu);

        const initial = local.initialHighlight;
        setHighlightedItem(initial === undefined || initial === null ? null : String(initial));
        requestAnimationFrame(() => {
            updatePosition();
            scrollHighlightedIntoView();
        });

        installMenuKeyboard(openMenu);
        installDragHighlight(openMenu, drag);
        installOutsideDismiss(openMenu);
        installReposition(openMenu);
    }));

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
                            class={cx(menuStyles.menu, local.compact ? menuStyles.compact : "", local.open ? "" : menuStyles.closed, local.class)}
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
    const subLabel = resolveChildren(() => local.label || local.title || "");
    const icon = resolveChildren(() => local.icon);
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

    // The panel is portaled and fixed: placed beside its row, then placed
    // again once it is measured, flipped if it would leave what's visible.
    const place = () => {
        if (!rowRef) return;
        const placed = placeSubmenu(rowRef, subRef);
        setFlipX(placed.flipX);
        setFlipY(placed.flipY);
        setCoords({ left: placed.left, top: placed.top });
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
        cx(
            menuStyles.subMenuPanel,
            ctx?.compact() ? menuStyles.compact : "",
            flipX() ? menuStyles.flipX : "",
            flipY() ? menuStyles.flipY : "",
        );

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
            class={cx(
                menuStyles.item,
                isHighlighted() ? menuStyles.highlighted : "",
                local.class,
            )}
            classList={local.classList}
            onPointerEnter={() => {
                ctx?.setHighlightedItem(subId);
                open();
            }}
            onPointerLeave={scheduleClose}
            // touch has no hover: a tap on the row opens it
            onClick={open}
        >
            <Show when={icon()}>
                {typeof icon() === "string" ? (
                    <PaperIcon class={menuStyles.itemIcon}>{icon()}</PaperIcon>
                ) : (
                    <span class={menuStyles.itemIcon}>{icon()}</span>
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
        cx(menuStyles.header, local.class);

    return (
        <div {...rest} class={className()} classList={local.classList}>
            {local.children}
        </div>
    );
}
