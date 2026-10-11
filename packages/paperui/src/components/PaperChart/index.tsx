import styles from "./index.module.css";
import { children, splitProps, For, Show, type JSX } from "solid-js";
import { resolveColor } from "../../utils/theme";
import type { PaperColor } from "../../types";

export interface PaperChartSegment {
    label: string;
    value: number;
    /** role, token or CSS color; defaults to the chart palette, in order */
    color?: PaperColor;
    /** the reading as people say it ("1.2 GB"); defaults to its share ("14%") */
    detail?: string;
}

export interface PaperChartProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> {
    /** a ring with room in the middle, or a flat bar */
    type?: "donut" | "bar";
    segments: PaperChartSegment[];
    /** the whole the segments are parts of; defaults to their sum. What's left over stays empty. */
    total?: number;
    /** what the chart measures; with each segment's reading it is the accessible name */
    label: string;
    /** ring thickness, in hundredths of the donut's width */
    thickness?: number;
    /** shown in the middle of a donut */
    children?: JSX.Element;
}

export interface PaperChartLegendProps extends JSX.HTMLAttributes<HTMLUListElement> {
    /** the same segments as the chart, so colors and readings agree */
    segments: PaperChartSegment[];
    total?: number;
    /** names only, without each reading, where there is no room for them */
    compact?: boolean;
}

// a segment without a color takes the next of these, so a chart and its
// legend agree without either being told
const PALETTE: PaperColor[] = ["primary", "extra-1", "extra-2", "attention", "extra-3", "warning", "success"];
// a hairline between slices, in hundredths of the whole
const SLICE_GAP = 0.8;
const DEFAULT_THICKNESS = 12;

interface Part {
    segment: PaperChartSegment;
    color: string;
    /** share of the whole, 0-1 */
    fraction: number;
    detail: string;
}

function percent(fraction: number): string {
    const value = fraction * 100;
    return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

function partsOf(segments: PaperChartSegment[], total: number | undefined): Part[] {
    const values = segments.map((s) => (Number.isFinite(s.value) && s.value > 0 ? s.value : 0));
    const sum = values.reduce((a, b) => a + b, 0);
    // segments never draw past the whole: a total smaller than their sum is ignored
    const whole = total !== undefined && Number.isFinite(total) && total > sum ? total : sum;
    return segments.map((segment, index) => {
        const fraction = whole > 0 ? values[index] / whole : 0;
        return {
            segment,
            color: resolveColor(segment.color ?? PALETTE[index % PALETTE.length]) as string,
            fraction,
            detail: segment.detail ?? percent(fraction),
        };
    });
}

/**
 * Parts of a whole, as a donut or a bar. Pair it with PaperChartLegend,
 * given the same segments, when the parts need naming.
 */
export function PaperChart(props: PaperChartProps) {
    const [local, rest] = splitProps(props, [
        "type",
        "segments",
        "total",
        "label",
        "thickness",
        "children",
        "class",
    ]);

    const center = children(() => local.children);
    const parts = () => partsOf(local.segments, local.total);
    const isBar = () => local.type === "bar";
    const thickness = () => Math.min(50, Math.max(1, local.thickness ?? DEFAULT_THICKNESS));
    const radius = () => 50 - thickness() / 2;
    const name = () => {
        const readings = parts().map((p) => `${p.segment.label} ${p.detail}`);
        return readings.length > 0 ? `${local.label}: ${readings.join(", ")}` : local.label;
    };
    // each slice starts where the one before it ended
    const slices = () => {
        let start = 0;
        return parts().map((part) => {
            const length = part.fraction * 100;
            const slice = { part, start, length: length > SLICE_GAP * 2 ? length - SLICE_GAP : length };
            start += length;
            return slice;
        });
    };

    const className = () =>
        [styles.PaperChart, isBar() ? styles.bar : styles.donut, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} role="img" aria-label={name()} class={className()}>
            <Show
                when={!isBar()}
                fallback={
                    <For each={parts()}>
                        {(part) => (
                            <Show when={part.fraction > 0}>
                                <span class={styles.barPart} style={{ width: `${part.fraction * 100}%`, background: part.color }} />
                            </Show>
                        )}
                    </For>
                }
            >
                <svg class={styles.ring} viewBox="0 0 100 100">
                    <circle class={styles.track} cx="50" cy="50" r={radius()} stroke-width={thickness()} />
                    <For each={slices()}>
                        {(slice) => (
                            <circle
                                class={styles.slice}
                                cx="50"
                                cy="50"
                                r={radius()}
                                pathLength="100"
                                stroke-width={thickness()}
                                // a style, not the attribute: presentation attributes don't read var()
                                style={{ stroke: slice.part.color }}
                                stroke-dasharray={`${slice.length} ${100 - slice.length}`}
                                stroke-dashoffset={-slice.start}
                            />
                        )}
                    </For>
                </svg>
                <Show when={center()}>
                    <div class={styles.center}>{center()}</div>
                </Show>
            </Show>
        </div>
    );
}

/** The chart's parts by name: a swatch, a label and a reading each. */
export function PaperChartLegend(props: PaperChartLegendProps) {
    const [local, rest] = splitProps(props, ["segments", "total", "compact", "class"]);
    const className = () => [styles.legend, local.class].filter(Boolean).join(" ");
    return (
        <ul {...rest} class={className()}>
            <For each={partsOf(local.segments, local.total)}>
                {(part) => (
                    <li class={styles.legendRow}>
                        <span class={styles.swatch} style={{ background: part.color }} />
                        <span class={styles.legendLabel}>{part.segment.label}</span>
                        <Show when={!local.compact}>
                            <span class={styles.legendDetail}>{part.detail}</span>
                        </Show>
                    </li>
                )}
            </For>
        </ul>
    );
}
