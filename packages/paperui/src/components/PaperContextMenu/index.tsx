import styles from "./index.module.css";
import {
    createContext,
    useContext,
    createSignal,
    createEffect,
    createUniqueId,
    onCleanup,
    splitProps,
    Show,
    type ParentProps,
    type JSX,
} from "solid-js";
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

    const resolvedEl =
        target instanceof HTMLElement
            ? target
            : typeof target === "object" &&
                ("currentTarget" in target || "target" in target)
              ? (((target as any).currentTarget ||
                    (target as any).target) as HTMLElement | null)
              : null;

    if (resolvedEl && typeof resolvedEl.getBoundingClientRect === "function") {
        if (placement !== "mouse") {
            return getElementPosition(resolvedEl, placement);
        }
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

    if (resolvedEl && typeof resolvedEl.getBoundingClientRect === "function") {
        return getElementPosition(resolvedEl, placement);
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

interface ContextMenuContextType {
    closeMenu: () => void;
    highlightedItem: () => string | number | null;
    setHighlightedItem: (val: string | number | null) => void;
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
        "class",
        "classList",
        "children",
    ]);

    const [coords, setCoords] = createSignal({ left: 0, top: 0 });
    const [highlightedItem, setHighlightedItem] = createSignal<
        string | number | null
    >(null);
    const [activeSubMenu, setActiveSubMenu] = createSignal<string | null>(null);
    let isDraggingGesture = false;

    const updatePosition = () => {
        if (!menuRef) return;

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
        const padding = 12;

        let left = targetX;
        let top = targetY;

        const placementMode = local.placement || "mouse";
        const isBelowMode = placementMode.startsWith("below");

        if (left + rect.width > window.innerWidth - padding) {
            left = Math.max(padding, window.innerWidth - rect.width - padding);
        }
        if (left < padding) {
            left = padding;
        }

        if (isBelowMode && top + rect.height > window.innerHeight - padding) {
            if (local.target) {
                const evt = local.target as any;
                const el = (evt?.currentTarget ||
                    evt?.target ||
                    (local.target instanceof HTMLElement
                        ? local.target
                        : null)) as HTMLElement | null;
                if (el && typeof el.getBoundingClientRect === "function") {
                    const elRect = el.getBoundingClientRect();
                    top = Math.max(padding, elRect.top - rect.height);
                } else {
                    top = Math.max(padding, top - rect.height);
                }
            } else {
                top = Math.max(
                    padding,
                    window.innerHeight - rect.height - padding,
                );
            }
        } else if (top + rect.height > window.innerHeight - padding) {
            top = Math.max(padding, top - rect.height);
        }

        if (top < padding) {
            top = padding;
        }

        setCoords({ left, top });
    };

    const handleClose = () => {
        setHighlightedItem(null);
        setActiveSubMenu(null);
        local.onClose?.();
    };

    createEffect(() => {
        if (!local.open) return;

        requestAnimationFrame(updatePosition);

        let pointerMoveRaf: number | null = null;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((local.closeOnEsc ?? true) && e.key === "Escape") {
                handleClose();
                return;
            }

            if (!menuRef) return;
            const items = Array.from(
                menuRef.querySelectorAll<HTMLElement>(
                    "[data-context-item]:not([data-disabled='true'])",
                ),
            );
            if (items.length === 0) return;

            const currentHighlight = highlightedItem();
            const currentIndex = items.findIndex(
                (el) =>
                    el.getAttribute("data-context-item") === currentHighlight,
            );

            if (e.key === "ArrowDown") {
                e.preventDefault();
                const nextIdx = (currentIndex + 1) % items.length;
                const nextVal =
                    items[nextIdx].getAttribute("data-context-item");
                if (nextVal) setHighlightedItem(nextVal);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const prevIdx =
                    currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
                const prevVal =
                    items[prevIdx].getAttribute("data-context-item");
                if (prevVal) setHighlightedItem(prevVal);
            } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (currentIndex >= 0) {
                    items[currentIndex].click();
                }
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

        const handleScroll = (e: Event) => {
            const targetNode = e.target instanceof Node ? e.target : null;
            if (menuRef && (!targetNode || !menuRef.contains(targetNode))) {
                handleClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        window.addEventListener("pointerup", handleGlobalPointerUp);
        window.addEventListener("scroll", handleScroll, true);

        onCleanup(() => {
            if (pointerMoveRaf) cancelAnimationFrame(pointerMoveRaf);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
            window.removeEventListener("pointerup", handleGlobalPointerUp);
            window.removeEventListener("scroll", handleScroll, true);
        });
    });

    const contextValue: ContextMenuContextType = {
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
        <Show when={local.open}>
            <Portal>
                <div class={styles.contextMenuOverlay} onClick={handleClose} />
                <SubMenuLevelContext.Provider value={subMenuContextValue}>
                    <ContextMenuContext.Provider value={contextValue}>
                        <div
                            ref={(el) => {
                                menuRef = el;
                                updatePosition();
                            }}
                            role="menu"
                            tabIndex={-1}
                            aria-activedescendant={activeDescendantId()}
                            {...rest}
                            class={[styles.PaperContextMenu, local.class]
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
        "class",
        "classList",
        "onClick",
        "children",
    ]);

    const ctx = useContextMenu();
    const subCtx = useContext(SubMenuLevelContext);
    const itemValue = () => String(local.value ?? local.children);

    const isHighlighted = () => ctx?.highlightedItem() === itemValue();

    const handleClick: JSX.EventHandler<HTMLDivElement, MouseEvent> = (e) => {
        if (local.disabled) return;

        if (typeof local.onClick === "function") {
            (local.onClick as any)(e);
        }

        ctx?.closeMenu();
    };

    const keybindText = () => local.keybind ?? local.shortcut;

    const className = () =>
        [
            styles.PaperContextMenuItem,
            local.danger ? styles.danger : "",
            local.disabled ? styles.disabled : "",
            isHighlighted() ? styles.highlighted : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            id={`paper-menuitem-${itemValue()}`}
            role="menuitem"
            data-context-item={itemValue()}
            data-disabled={local.disabled ? "true" : "false"}
            tabIndex={-1}
            {...rest}
            class={className()}
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
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={styles.itemIcon}>{local.icon}</PaperIcon>
                ) : (
                    <span class={styles.itemIcon}>{local.icon}</span>
                )}
            </Show>

            <div class={styles.itemContent}>
                <span class={styles.itemLabel}>{local.children}</span>
                <Show when={local.description}>
                    <span class={styles.itemDescription}>{local.description}</span>
                </Show>
            </div>

            <Show when={keybindText()}>
                <span class={styles.itemKeybind}>{keybindText()}</span>
            </Show>
        </div>
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
    let closeTimeout: number | undefined;

    const [local, rest] = splitProps(props, [
        "label",
        "title",
        "icon",
        "class",
        "classList",
        "children",
    ]);

    const autoId = createUniqueId();
    const subLabel = () => local.label || local.title || "";
    const subCtx = useContext(SubMenuLevelContext);
    const [childActiveSubMenu, setChildActiveSubMenu] = createSignal<string | null>(null);
    const childSubMenuContextValue: SubMenuLevelContextType = {
        activeSubMenu: childActiveSubMenu,
        setActiveSubMenu: setChildActiveSubMenu,
    };

    const subId = () => (typeof subLabel() === "string" && subLabel() ? String(subLabel()) : autoId);
    const isOpen = () => subCtx?.activeSubMenu() === subId();

    const [flipX, setFlipX] = createSignal(false);
    const [flipY, setFlipY] = createSignal(false);

    const cancelClose = () => {
        if (closeTimeout) {
            clearTimeout(closeTimeout);
            closeTimeout = undefined;
        }
    };

    const scheduleClose = () => {
        cancelClose();
        closeTimeout = window.setTimeout(() => {
            if (subCtx?.activeSubMenu() === subId()) {
                subCtx?.setActiveSubMenu(null);
            }
        }, 150);
    };

    const handlePointerEnter = () => {
        cancelClose();
        subCtx?.setActiveSubMenu(subId());
        requestAnimationFrame(() => {
            if (!subRef) return;
            const rect = subRef.getBoundingClientRect();
            setFlipX(rect.right > window.innerWidth - 12);
            setFlipY(rect.bottom > window.innerHeight - 12);
        });
    };

    const handlePointerLeave = () => {
        scheduleClose();
    };

    onCleanup(() => {
        cancelClose();
    });

    const subClassName = () =>
        [
            styles.subMenuPanel,
            flipX() ? styles.flipX : "",
            flipY() ? styles.flipY : "",
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            class={[
                styles.PaperContextMenuItem,
                isOpen() ? styles.highlighted : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={styles.itemIcon}>{local.icon}</PaperIcon>
                ) : (
                    <span class={styles.itemIcon}>{local.icon}</span>
                )}
            </Show>

            <span class={styles.itemLabel}>{subLabel()}</span>
            <PaperIcon class={styles.subMenuIndicator} zeroHeight>chevron_right</PaperIcon>

            <Show when={isOpen()}>
                <SubMenuLevelContext.Provider value={childSubMenuContextValue}>
                    <div
                        ref={subRef}
                        class={subClassName()}
                        onPointerEnter={cancelClose}
                        onPointerLeave={scheduleClose}
                    >
                        {local.children}
                    </div>
                </SubMenuLevelContext.Provider>
            </Show>
        </div>
    );
}

export interface PaperContextMenuHeaderProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function PaperContextMenuHeader(props: ParentProps<PaperContextMenuHeaderProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    const className = () =>
        [styles.PaperContextMenuHeader, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            {local.children}
        </div>
    );
}

