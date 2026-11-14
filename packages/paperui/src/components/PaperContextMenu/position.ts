// Where a context menu and its submenus go: the point a target names, the
// edge of the viewport a menu must stay inside, and the visible part of the
// page above a phone's keyboard.

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

/** the space a menu keeps from the edges of what's on screen */
const EDGE_PADDING = 12;

/**
 * The element a target is: the element itself, or an event's currentTarget
 * (else its target). Null for a point, or an event with no element.
 */
export function elementFromTarget(target: ContextMenuTarget): HTMLElement | null {
    if (!target) return null;
    if (target instanceof HTMLElement) return target;
    if (typeof target === "object" && ("currentTarget" in target || "target" in target)) {
        const el = ((target as any).currentTarget ||
            (target as any).target) as HTMLElement | null;
        return el && typeof el.getBoundingClientRect === "function" ? el : null;
    }
    return null;
}

function positionFromTarget(
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

export function pointInside(el: Element, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
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
function resolveMenuLeft(
    targetLeft: number,
    targetRight: number | null,
    menuWidth: number,
    viewportWidth: number,
    padding = EDGE_PADDING,
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

/** a point measured on screen, as a fixed box in `host` must be placed to show there */
function toFixed(host: HTMLElement, left: number, top: number): { left: number; top: number } {
    const origin = fixedOrigin(host);
    return { left: left - origin.x, top: top - origin.y };
}

export interface MenuAnchor {
    x?: number;
    y?: number;
    target?: ContextMenuTarget;
    placement?: ContextMenuPlacement;
    matchTargetWidth?: boolean;
}

/**
 * Where the root menu `menu` goes for `anchor`: by its target, kept inside
 * the viewport and above a keyboard. A menu that matches its target's width
 * gets that width as its floor here.
 */
export function placeMenu(menu: HTMLElement, anchor: MenuAnchor): { left: number; top: number } {
    const resolvedEl = elementFromTarget(anchor.target ?? null);
    if (anchor.matchTargetWidth && resolvedEl) {
        // a floor, not a fixed width: the panel still grows for wider
        // items (descriptions), it just never looks narrower than the
        // control it belongs to
        const width = Math.max(
            160,
            Math.round(resolvedEl.getBoundingClientRect().width),
        );
        menu.style.minWidth = `${width}px`;
    }

    let targetX = anchor.x;
    let targetY = anchor.y;

    if (targetX === undefined || targetY === undefined) {
        const defaultPlacement: ContextMenuPlacement =
            anchor.target &&
            "clientX" in (anchor.target as any) &&
            !("currentTarget" in (anchor.target as any))
                ? "mouse"
                : "below";
        const pos = positionFromTarget(
            anchor.target ?? null,
            anchor.placement ?? defaultPlacement,
        );
        targetX = pos?.x ?? 0;
        targetY = pos?.y ?? 0;
    }

    const rect = menu.getBoundingClientRect();
    const targetRect = resolvedEl?.getBoundingClientRect() ?? null;
    const padding = EDGE_PADDING;

    const placementMode = anchor.placement || "mouse";
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

    return toFixed(menu.parentElement ?? document.body, left, top);
}

/**
 * Where a submenu panel goes beside its row: at the row's right edge (CSS
 * margins supply the gap), flipped to the left or pulled up when it would
 * leave the viewport or go under a keyboard. `panel` is undefined before the
 * panel is first measured.
 */
export function placeSubmenu(
    row: HTMLElement,
    panel: HTMLElement | undefined,
): { left: number; top: number; flipX: boolean; flipY: boolean } {
    const rowRect = row.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const pad = EDGE_PADDING;
    const bottom = visibleHeight();
    const fitsRight = !panelRect || rowRect.right + panelRect.width <= window.innerWidth - pad;
    const fitsBelow = !panelRect || rowRect.top + panelRect.height <= bottom - pad;
    const left = fitsRight ? rowRect.right : rowRect.left - (panelRect?.width ?? 0);
    const top = fitsBelow ? rowRect.top : Math.max(pad, bottom - pad - (panelRect?.height ?? 0));
    return { ...toFixed(panel?.parentElement ?? document.body, left, top), flipX: !fitsRight, flipY: !fitsBelow };
}
