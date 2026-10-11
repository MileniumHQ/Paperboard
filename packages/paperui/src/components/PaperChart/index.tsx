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

export interface PaperChartSeries {
    label: string;
    /** readings, oldest first */
    values: number[];
    /** role, token or CSS color; defaults to the chart palette, in order */
    color?: PaperColor;
    /** the latest reading as people say it ("58%"); defaults to the last value */
    detail?: string;
}

interface PaperChartCommonProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children"> {
    /** what the chart measures; with each part's reading it is the accessible name */
    label: string;
}

export interface PaperChartPartsProps extends PaperChartCommonProps {
    /** parts of a whole: a ring with room in the middle, or a flat bar */
    type?: "donut" | "bar";
    segments: PaperChartSegment[];
    /** the whole the segments are parts of; defaults to their sum. What's left over stays empty. */
    total?: number;
    /** ring thickness, in hundredths of the donut's width */
    thickness?: number;
    /** shown in the middle of a donut */
    children?: JSX.Element;
}

export interface PaperChartLineProps extends PaperChartCommonProps {
    /** readings over time, one line per series */
    type: "line";
    series: PaperChartSeries[];
    /** the bottom of the chart; defaults to 0 */
    min?: number;
    /** the top of the chart; defaults to the largest reading */
    max?: number;
    /** how many readings the chart is wide; a shorter series is drawn from the right, as it fills in */
    span?: number;
    /** tint the area under each line */
    fill?: boolean;
}

export type PaperChartProps = PaperChartPartsProps | PaperChartLineProps;

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

interface Line {
    color: string;
    /** "x,y x,y" in a 100×100 box, y down */
    points: string;
    /** the same line closed along the bottom, for the fill */
    area: string;
}

function linesOf(props: PaperChartLineProps): Line[] {
    const clean = props.series.map((s) => s.values.filter((v) => Number.isFinite(v)));
    const min = props.min !== undefined && Number.isFinite(props.min) ? props.min : 0;
    const top = props.max !== undefined && Number.isFinite(props.max) ? props.max : Math.max(min, ...clean.flat());
    // a flat chart of nothing still needs a height to divide by
    const range = top > min ? top - min : 1;
    const span = Math.max(2, Math.floor(props.span ?? 0), ...clean.map((values) => values.length));
    const round = (n: number) => Math.round(n * 100) / 100;
    return props.series.map((series, index) => {
        // the newest readings, ending at the right edge
        const values = clean[index].slice(-span);
        const first = span - values.length;
        const at = values.map((value, i) => ({
            x: round(((first + i) / (span - 1)) * 100),
            y: round(100 - (Math.min(top, Math.max(min, value)) - min) / range * 100),
        }));
        const points = at.map((p) => `${p.x},${p.y}`).join(" ");
        return {
            color: resolveColor(series.color ?? PALETTE[index % PALETTE.length]) as string,
            // one reading is not a line yet
            points: at.length > 1 ? points : "",
            area: at.length > 1 ? `M${at[0].x},100 L${points.replaceAll(" ", " L")} L${at[at.length - 1].x},100 Z` : "",
        };
    });
}

/**
 * A small chart: parts of a whole as a donut or a bar, or readings over
 * time as a line. Pair a donut or bar with PaperChartLegend, given the same
 * segments, when the parts need naming.
 */
export function PaperChart(props: PaperChartProps) {
    return (
        <Show when={props.type === "line"} fallback={<PartsChart {...(props as PaperChartPartsProps)} />}>
            <LineChart {...(props as PaperChartLineProps)} />
        </Show>
    );
}

function LineChart(props: PaperChartLineProps) {
    const [local, rest] = splitProps(props, ["type", "series", "min", "max", "span", "fill", "label", "class"]);
    const name = () => {
        const readings = local.series
            .map((s) => ({ label: s.label, detail: s.detail ?? s.values.filter((v) => Number.isFinite(v)).at(-1) }))
            .filter((r) => r.detail !== undefined)
            .map((r) => `${r.label} ${r.detail}`);
        return readings.length > 0 ? `${local.label}: ${readings.join(", ")}` : local.label;
    };
    const className = () => [styles.PaperChart, styles.line, local.class].filter(Boolean).join(" ");
    return (
        <div {...rest} role="img" aria-label={name()} class={className()}>
            {/* stretched to the box it is given; strokes keep their width */}
            <svg class={styles.plot} viewBox="0 0 100 100" preserveAspectRatio="none">
                <For each={linesOf(props)}>
                    {(line) => (
                        <Show when={line.points}>
                            <Show when={local.fill}>
                                <path class={styles.area} d={line.area} style={{ fill: line.color }} />
                            </Show>
                            <polyline class={styles.stroke} points={line.points} style={{ stroke: line.color }} />
                        </Show>
                    )}
                </For>
            </svg>
        </div>
    );
}

function PartsChart(props: PaperChartPartsProps) {
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
