import styles from "./index.module.css";
import {
    createEffect,
    createSignal,
    onCleanup,
    Show,
    splitProps,
    type JSX,
    type ParentProps,
} from "solid-js";
import { Portal } from "solid-js/web";
import { PaperText } from "../PaperText";

export type PaperPopoverPlacement = "below" | "above";

export interface PaperPopoverProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    open: boolean;
    /** The element the popover points at: usually the button that opens it. */
    anchor: HTMLElement | undefined;
    onClose?: () => void;
    /** Which side of its anchor it opens on. It flips when there is no room. */
    placement?: PaperPopoverPlacement;
    title?: JSX.Element | string;
    /** Closes on a press outside the popover and its anchor (default true). */
    closeOnOutside?: boolean;
    /**
     * Its content fills it edge to edge, for a PaperList: the popover takes
     * the list's look and its title sits over the list like a group label.
     */
    flush?: boolean;
}

// room kept between the popover and the window's edges
const EDGE = 8;
// the tail is a rotated square: its center stays this far inside the box
const TAIL_INSET = 14;

/**
 * Placement for a popover: centered on its anchor, kept inside the
 * viewport, on the requested side unless only the other side has room.
 * The tail's left edge points at the anchor's center wherever the box
 * itself had to move.
 */
export function placePopover(
    anchor: { left: number; right: number; top: number; bottom: number },
    box: { width: number; height: number },
    viewport: { width: number; height: number },
    placement: PaperPopoverPlacement,
    gap: number,
): { left: number; top: number; side: PaperPopoverPlacement; tail: number } {
    const center = (anchor.left + anchor.right) / 2;
    const maxLeft = Math.max(EDGE, viewport.width - box.width - EDGE);
    const left = Math.min(maxLeft, Math.max(EDGE, center - box.width / 2));
    const roomBelow = viewport.height - anchor.bottom - gap - EDGE;
    const roomAbove = anchor.top - gap - EDGE;
    const side: PaperPopoverPlacement =
        placement === "below"
            ? roomBelow < box.height && roomAbove > roomBelow ? "above" : "below"
            : roomAbove < box.height && roomBelow > roomAbove ? "below" : "above";
    const top = side === "below" ? anchor.bottom + gap : anchor.top - gap - box.height;
    const tail = Math.min(box.width - TAIL_INSET, Math.max(TAIL_INSET, center - left));
    return { left, top: Math.max(EDGE, top), side, tail };
}

/**
 * A small bubble pointing at the control that opened it: a list of what a
 * button is doing, a question about it, a short form. It does not dim the
 * page or take focus away from it. Escape and a press outside close it.
 */
export function PaperPopover(props: ParentProps<PaperPopoverProps>) {
    const [local, rest] = splitProps(props, [
        "open",
        "anchor",
        "onClose",
        "placement",
        "title",
        "closeOnOutside",
        "flush",
        "class",
        "classList",
        "style",
        "children",
    ]);
    let box: HTMLDivElement | undefined;
    const [position, setPosition] = createSignal<ReturnType<typeof placePopover> | null>(null);

    const place = () => {
        if (!box || !local.anchor) return;
        const gap = parseFloat(getComputedStyle(box).getPropertyValue("--popover-gap")) || 10;
        setPosition(
            placePopover(
                local.anchor.getBoundingClientRect(),
                { width: box.offsetWidth, height: box.offsetHeight },
                { width: window.innerWidth, height: window.innerHeight },
                local.placement ?? "below",
                gap,
            ),
        );
    };

    createEffect(() => {
        if (!local.open) {
            setPosition(null);
            return;
        }
        // the anchor moves with layout, the box with its content
        const observer = new ResizeObserver(place);
        if (box) observer.observe(box);
        if (local.anchor) observer.observe(local.anchor);
        window.addEventListener("resize", place);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") local.onClose?.();
        };
        const onOutside = (e: PointerEvent) => {
            if (local.closeOnOutside === false) return;
            const target = e.target instanceof Node ? e.target : null;
            // the anchor's own click opens and closes it
            if (target && (box?.contains(target) || local.anchor?.contains(target))) return;
            local.onClose?.();
        };
        window.addEventListener("keydown", onKey);
        document.addEventListener("pointerdown", onOutside, true);
        requestAnimationFrame(place);
        onCleanup(() => {
            observer.disconnect();
            window.removeEventListener("resize", place);
            window.removeEventListener("keydown", onKey);
            document.removeEventListener("pointerdown", onOutside, true);
        });
    });

    return (
        <Show when={local.open}>
            <Portal>
                <div
                    ref={box}
                    role="dialog"
                    {...rest}
                    class={[styles.PaperPopover, local.class].filter(Boolean).join(" ")}
                    classList={{
                        [styles.placed]: position() !== null,
                        [styles.above]: position()?.side === "above",
                        [styles.flush]: Boolean(local.flush),
                        ...local.classList,
                    }}
                    style={{
                        left: `${position()?.left ?? 0}px`,
                        top: `${position()?.top ?? 0}px`,
                        "--popover-tail": `${position()?.tail ?? 0}px`,
                        ...(typeof local.style === "object" ? local.style : {}),
                    }}
                >
                    <span class={styles.tail} aria-hidden="true" />
                    <Show when={local.title}>
                        {typeof local.title === "string" ? (
                            local.flush ? (
                                <PaperText as="div" preset="section" color="text-subtle" class={styles.title}>
                                    {local.title}
                                </PaperText>
                            ) : (
                                <PaperText preset="label" class={styles.title}>
                                    {local.title}
                                </PaperText>
                            )
                        ) : (
                            local.title
                        )}
                    </Show>
                    <div class={styles.body}>{local.children}</div>
                </div>
            </Portal>
        </Show>
    );
}
