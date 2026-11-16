import styles from "./index.module.css";
import { createEffect, createRenderEffect, For, on, onCleanup, Show, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperCode } from "../PaperCode";
import { PaperCollapsible } from "../PaperCollapsible";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { toastSlot } from "../PaperModal/layer";
import { cx } from "../../utils/cx";
import { dismissToast, shownToasts, stopToastTimers, type PaperToastVariant } from "../../utils/toasts";

export {
    createFailureToast,
    dismissToast,
    showError,
    showToast,
    type FailureToastOptions,
    type ShowErrorOptions,
    type PaperToastAction,
    type PaperToastOptions,
    type PaperToastVariant,
} from "../../utils/toasts";

// what a person presses or types into: a toast must not cover one
const CONTROLS = 'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
/** The boxes of the controls a person can press now: shown, and not under a scrim or another layer. */
function pressable(region: HTMLElement): DOMRect[] {
    const boxes: DOMRect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(CONTROLS)) {
        if (region.contains(el)) continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        if (hit && (hit === el || el.contains(hit) || hit.contains(el))) boxes.push(box);
    }
    return boxes;
}

/** The controls a region from `left` to `right`, and from `top` down by `height`, would cover. */
const coveredAt = (controls: DOMRect[], left: number, right: number, top: number, height: number) =>
    controls.filter((box) => box.left < right && left < box.right && box.top < top + height && top < box.bottom);

/**
 * Puts the region on the page where it covers no control: where it is while
 * that still covers none, so it doesn't jump about as the page changes;
 * else the highest spot below the top where it covers none, sliding down
 * past each control in its way; else along the bottom; else wherever it
 * covers the fewest.
 */
function place(region: HTMLElement): void {
    if (region.parentElement !== document.body) {
        region.style.removeProperty("top");
        region.classList.remove(styles.atBottom!);
        return;
    }
    region.classList.add(styles.measuring!);
    const controls = pressable(region);
    const box = region.getBoundingClientRect();
    const { left, right, height } = box;
    const gap = parseFloat(getComputedStyle(region).rowGap) || 0;
    // the top and bottom it keeps from the window's edges, as its stylesheet sets them
    region.style.removeProperty("top");
    region.classList.remove(styles.atBottom!);
    const first = region.getBoundingClientRect().top;
    region.classList.add(styles.atBottom!);
    const last = region.getBoundingClientRect().top;
    region.classList.remove(styles.atBottom!);

    const candidates: number[] = [box.top];
    let top = first;
    for (let tries = 0; tries < controls.length + 1 && top <= last; tries++) {
        candidates.push(top);
        const inWay = coveredAt(controls, left, right, top, height);
        if (inWay.length === 0) break;
        top = Math.max(...inWay.map((b) => b.bottom)) + gap;
    }
    candidates.push(last);
    let best: { top: number; covered: number } | null = null;
    for (const at of candidates) {
        const covered = coveredAt(controls, left, right, at, height).length;
        if (!best || covered < best.covered) best = { top: at, covered };
        if (covered === 0) break;
    }
    if (best && best.top === last) region.classList.add(styles.atBottom!);
    else if (best && best.top !== first) region.style.setProperty("top", `${best.top}px`);
    region.classList.remove(styles.measuring!);
}

const DEFAULT_ICONS: Record<PaperToastVariant, string> = {
    danger: "error",
    warning: "warning",
    success: "check_circle",
    info: "info",
};

/**
 * Where toasts appear: in the middle of the window, along its top, below
 * its top bar or along its bottom, wherever they cover no control; or,
 * while a PaperModal is open, inside it above its buttons. A toast never
 * covers what the person is about to press. PaperProvider renders one, so showToast works
 * anywhere inside it; render it yourself only outside a PaperProvider.
 */
export function PaperToastRegion(props: JSX.HTMLAttributes<HTMLDivElement>) {
    // a page rendered on a server has no toasts yet, and no document to put them in
    if (isServer) return null;
    onCleanup(stopToastTimers);
    const region = (
        <div
            {...props}
            class={cx(styles.region, props.class)}
            classList={{ [styles.inDialog]: toastSlot() !== null }}
            role="region"
            aria-label="Notifications"
            data-paper-toasts
        >
            <For each={shownToasts()}>
                {(toast) => (
                    <div
                        class={styles.toast}
                        classList={{ [styles[toast.variant ?? "info"]]: true }}
                        role={toast.variant === "danger" ? "alert" : "status"}
                    >
                        <PaperIcon class={styles.icon}>{toast.icon ?? DEFAULT_ICONS[toast.variant ?? "info"]}</PaperIcon>
                        <div class={styles.text}>
                            <PaperText preset="label" breakWord>{toast.title}</PaperText>
                            <Show when={toast.message}>
                                <PaperText preset="hint" breakWord>{toast.message}</PaperText>
                            </Show>
                            <Show when={toast.details}>
                                {(details) => (
                                    <PaperCollapsible title="Details">
                                        <div class={styles.details}>
                                            <PaperCode block language="text">{details()}</PaperCode>
                                        </div>
                                    </PaperCollapsible>
                                )}
                            </Show>
                            <Show when={toast.action}>
                                {(action) => (
                                    <div class={styles.actions}>
                                        <PaperButton
                                            size="small"
                                            onClick={() => {
                                                dismissToast(toast.id);
                                                action().onClick();
                                            }}
                                        >
                                            {action().label}
                                        </PaperButton>
                                    </div>
                                )}
                            </Show>
                        </div>
                        <PaperButton
                            size="tiny"
                            variant="text"
                            icon
                            aria-label="Close"
                            title="Close"
                            onClick={() => dismissToast(toast.id)}
                        >
                            <PaperIcon>close</PaperIcon>
                        </PaperButton>
                    </div>
                )}
            </For>
        </div>
    ) as HTMLDivElement;

    // one element, moved between the page and the open dialog: a toast keeps
    // its element (and what the person opened in it) as a dialog opens or closes
    createRenderEffect(
        on([() => shownToasts().length > 0, toastSlot], ([showing, slot]) => {
            if (!showing) return region.remove();
            const host = slot ?? document.body;
            if (region.parentElement !== host) host.append(region);
        }),
    );
    // where on the page: measured again as toasts come and go, a dialog
    // opens or closes, the window changes size, or the page under them
    // changes (a view opens, a bar appears), at most once a frame
    let frame = 0;
    const replace = () => {
        if (!frame) frame = requestAnimationFrame(() => {
            frame = 0;
            place(region);
        });
    };
    const changes = new MutationObserver((records) => {
        if (records.some((record) => !region.contains(record.target))) replace();
    });
    createEffect(
        on([() => shownToasts().length > 0, toastSlot], ([showing]) => {
            place(region);
            changes.disconnect();
            if (showing) changes.observe(document.body, { subtree: true, childList: true, attributes: true });
        }),
    );
    createEffect(on(() => shownToasts().length, () => place(region), { defer: true }));
    window.addEventListener("resize", replace);
    onCleanup(() => {
        changes.disconnect();
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", replace);
        region.remove();
    });
    return null;
}
