import styles from "./index.module.css";
// the track and bar are PaperProgress's own: one look, one stylesheet
import progressStyles from "../PaperProgress/index.module.css";
import { For, Show, splitProps, type JSX } from "solid-js";

export type PaperRangeOrientation = "horizontal" | "vertical";

export type PaperRangeMark = number | { value: number; label?: JSX.Element | string };

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
    /** Spoken value, for example `"40%"`. Defaults to `formatValue`, then the number. */
    valueText?: (value: number) => string;
    /** Shown above the track, and the slider's accessible name unless `aria-label` is set. */
    label?: string;
    /** Shows the current value above the track, for example `(gb) => `${gb} GB``. */
    formatValue?: (value: number) => string;
    /** Ticks under a horizontal track. A label prints under its tick; clicking it selects that value. */
    marks?: PaperRangeMark[];
    /** Only the marks are selectable: dragging and arrow keys move between them. */
    snapToMarks?: boolean;
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
        "label",
        "formatValue",
        "marks",
        "snapToMarks",
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

    const marks = () =>
        (local.marks ?? [])
            .map((m) => (typeof m === "number" ? { value: m, label: undefined } : m))
            .filter((m) => m.value >= min() && m.value <= max())
            .sort((a, b) => a.value - b.value);
    const snapping = () => Boolean(local.snapToMarks) && marks().length > 0;
    const nearestMark = (value: number) =>
        marks().reduce((best, m) => (Math.abs(m.value - value) < Math.abs(best - value) ? m.value : best), marks()[0]!.value);
    const markOffset = (dir: 1 | -1, by: number) => {
        const values = marks().map((m) => m.value);
        const at = values.indexOf(nearestMark(clamped()));
        return values[Math.min(values.length - 1, Math.max(0, at + dir * by))]!;
    };
    const percentOf = (value: number) => ((value - min()) / (max() - min())) * 100;
    const stacked = () => !vertical() && (local.label !== undefined || local.formatValue !== undefined || marks().length > 0);

    const emit = (value: number, commit: boolean) => {
        const next = snapping() ? nearestMark(value) : clampToStep(value, min(), max(), step());
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
        const snap = snapping();
        let next: number | null = null;
        switch (e.key) {
            case "ArrowRight":
            case "ArrowUp":
                next = snap ? markOffset(1, 1) : clamped() + step();
                break;
            case "ArrowLeft":
            case "ArrowDown":
                next = snap ? markOffset(-1, 1) : clamped() - step();
                break;
            case "PageUp":
                next = snap ? markOffset(1, 3) : clamped() + page;
                break;
            case "PageDown":
                next = snap ? markOffset(-1, 3) : clamped() - page;
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
            stacked() ? styles.stacked : "",
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
            aria-valuetext={(local.valueText ?? local.formatValue)?.(clamped())}
            aria-label={local.label}
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
            <Show when={stacked() && (local.label !== undefined || local.formatValue)}>
                {/* already announced through aria-label and aria-valuetext */}
                <div class={styles.header} aria-hidden="true">
                    <span class={styles.label}>{local.label}</span>
                    <span class={styles.value}>{local.formatValue?.(clamped())}</span>
                </div>
            </Show>
            <div class={`${progressStyles.PaperProgress} ${styles.track}`} ref={track}>
                <div
                    class={`${progressStyles.bar} ${styles.bar}`}
                    style={vertical() ? { height: `${percent()}%` } : { width: `${percent()}%` }}
                />
            </div>
            <Show when={stacked() && marks().length > 0}>
                <div class={styles.marks} aria-hidden="true">
                    <For each={marks()}>
                        {(m) => (
                            <span
                                class={styles.mark}
                                classList={{ [styles.reached!]: m.value <= clamped() }}
                                style={{ left: `${percentOf(m.value)}%` }}
                            >
                                <span class={styles.tick} />
                                <Show when={m.label !== undefined}>
                                    <span class={styles.markLabel}>{m.label}</span>
                                </Show>
                            </span>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}
