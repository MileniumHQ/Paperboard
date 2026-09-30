import styles from "./index.module.css";
// the track and bar are PaperProgress's own: one look, one stylesheet
import progressStyles from "../PaperProgress/index.module.css";
import { splitProps, type JSX } from "solid-js";

export type PaperRangeOrientation = "horizontal" | "vertical";

export interface PaperRangeProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onInput" | "onChange"> {
    value: number;
    min?: number;
    max?: number;
    /** Snapping interval for pointer and arrow keys. Defaults to 1. */
    step?: number;
    orientation?: PaperRangeOrientation;
    disabled?: boolean;
    /** Fires on every change while dragging and on each key press. */
    onInput?: (value: number) => void;
    /** Fires once a drag ends, and on each key press. */
    onChange?: (value: number) => void;
    /** Spoken value, for example `"40%"`. Defaults to the number. */
    valueText?: (value: number) => string;
}

export function clampToStep(value: number, min: number, max: number, step: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    const stepped = step > 0 ? lo + Math.round((value - lo) / step) * step : value;
    // round away float drift (0.1 + 0.2) at the step's precision
    const decimals = step > 0 ? (String(step).split(".")[1]?.length ?? 0) : 10;
    return Math.min(hi, Math.max(lo, Number(stepped.toFixed(decimals))));
}

export function PaperRange(props: PaperRangeProps) {
    const [local, rest] = splitProps(props, [
        "value",
        "min",
        "max",
        "step",
        "orientation",
        "disabled",
        "onInput",
        "onChange",
        "valueText",
        "tabIndex",
        "class",
        "classList",
    ]);

    let track: HTMLDivElement | undefined;
    let dragging = false;
    let dragValue = 0;

    const min = () => local.min ?? 0;
    const max = () => (local.max !== undefined && local.max > min() ? local.max : min() + 100);
    const step = () => (local.step !== undefined && local.step > 0 ? local.step : 1);
    const vertical = () => local.orientation === "vertical";
    const clamped = () => clampToStep(local.value, min(), max(), 0);
    const percent = () => ((clamped() - min()) / (max() - min())) * 100;

    const emit = (value: number, commit: boolean) => {
        const next = clampToStep(value, min(), max(), step());
        local.onInput?.(next);
        if (commit) local.onChange?.(next);
        return next;
    };

    const valueAt = (e: PointerEvent) => {
        if (!track) return clamped();
        const r = track.getBoundingClientRect();
        const fraction = vertical()
            ? r.height > 0 ? (r.bottom - e.clientY) / r.height : 0
            : r.width > 0 ? (e.clientX - r.left) / r.width : 0;
        return min() + Math.min(1, Math.max(0, fraction)) * (max() - min());
    };

    const onPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
        if (local.disabled || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging = true;
        dragValue = emit(valueAt(e), false);
    };

    const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
        if (!dragging) return;
        dragValue = emit(valueAt(e), false);
    };

    const endDrag: JSX.EventHandler<HTMLDivElement, PointerEvent> = (e) => {
        if (!dragging) return;
        dragging = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        local.onChange?.(dragValue);
    };

    const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
        if (local.disabled) return;
        const page = Math.max(step(), (max() - min()) / 10);
        let next: number | null = null;
        switch (e.key) {
            case "ArrowRight":
            case "ArrowUp":
                next = clamped() + step();
                break;
            case "ArrowLeft":
            case "ArrowDown":
                next = clamped() - step();
                break;
            case "PageUp":
                next = clamped() + page;
                break;
            case "PageDown":
                next = clamped() - page;
                break;
            case "Home":
                next = min();
                break;
            case "End":
                next = max();
                break;
        }
        if (next === null) return;
        e.preventDefault();
        emit(next, true);
    };

    const className = () =>
        [
            styles.PaperRange,
            vertical() ? styles.vertical : styles.horizontal,
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            role="slider"
            aria-valuemin={min()}
            aria-valuemax={max()}
            aria-valuenow={clamped()}
            aria-valuetext={local.valueText?.(clamped())}
            aria-orientation={vertical() ? "vertical" : "horizontal"}
            aria-disabled={local.disabled ? "true" : undefined}
            tabIndex={local.disabled ? -1 : (local.tabIndex ?? 0)}
            {...rest}
            class={className()}
            classList={local.classList}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
        >
            <div class={`${progressStyles.PaperProgress} ${styles.track}`} ref={track}>
                <div
                    class={`${progressStyles.bar} ${styles.bar}`}
                    style={vertical() ? { height: `${percent()}%` } : { width: `${percent()}%` }}
                />
            </div>
        </div>
    );
}
