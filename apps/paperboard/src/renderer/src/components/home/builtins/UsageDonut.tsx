import { PaperButton } from "@mileniumhq/paperui";
import { type Component, createMemo, For, Show } from "solid-js";
import type { BuiltinWidgetProps } from "./types";
import { useUsage } from "./usageStore";
import { formatBytes, formatPercent, type Segment, usageChart, type UsageMetric } from "./usageSegments";
import styles from "./Builtins.module.css";

// a hairline between slices, in hundredths of the ring
const LEGEND_ROWS = 3;
const SLICE_GAP = 0.8;
const RADIUS = 40;

// How much of a computer's CPU or memory each panel, Paperboard, and
// everything else uses, as a ring around what's in use.
const UsageDonut: Component<BuiltinWidgetProps & { metric: UsageMetric }> = (props) => {
    const usage = useUsage(() => props.computerId, () => props.visible);
    const title = () => (props.metric === "cpu" ? "CPU" : "Memory");
    const chart = createMemo(() => {
        const state = usage.state();
        return state.kind === "ready" ? usageChart(state.report, props.metric, props.panelName) : null;
    });
    // the three largest and free; the rest are in the label
    const rows = () => {
        const c = chart();
        return c ? [...c.segments.slice(0, LEGEND_ROWS), c.free] : [];
    };
    const summary = () => {
        const state = usage.state();
        if (state.kind !== "ready") return "";
        if (props.metric === "memory") {
            const { totalBytes, availableBytes } = state.report.memory;
            return `${formatBytes(totalBytes - availableBytes)} of ${formatBytes(totalBytes)}`;
        }
        const cores = state.report.cpu?.cores;
        return cores ? `${cores} ${cores === 1 ? "core" : "cores"}` : "";
    };
    const label = () => {
        const c = chart();
        if (!c) return `${title()} on ${props.computerName}`;
        const parts = [...c.segments, c.free].map((s) => `${s.label} ${s.detail}`);
        return `${title()} on ${props.computerName}: ${formatPercent(c.used)} in use. ${parts.join(", ")}.`;
    };

    return (
        <div
            class={styles.usage}
            classList={{ [styles.usageSmall]: props.size.w === 1, [styles.usageTall]: props.size.h > 1 }}
        >
            <Show when={props.size.h > 1}>
                <div class={styles.usageHeader}>
                    <span class={styles.usageTitle}>
                        {title()}
                        <Show when={props.showComputer}>
                            <span class={styles.usageSubtle}> · {props.computerName}</span>
                        </Show>
                    </span>
                    <span class={styles.usageSubtle}>{summary()}</span>
                </div>
            </Show>
            <Show
                when={usage.state().kind !== "unavailable"}
                fallback={
                    <div class={styles.usageMessage} role="alert">
                        <span>{(usage.state() as { message: string }).message}</span>
                        <PaperButton size="tiny" variant="text" onClick={usage.retry}>Retry</PaperButton>
                    </div>
                }
            >
                <div class={styles.usageBody}>
                    <div class={styles.donut}>
                        <svg viewBox="0 0 100 100" role="img" aria-label={label()}>
                            <circle class={styles.donutTrack} cx="50" cy="50" r={RADIUS} pathLength="100" />
                            <Show when={chart()}>{(c) => <Slices segments={c().segments} />}</Show>
                        </svg>
                        <div class={styles.donutCenter} aria-hidden="true">
                            <span class={styles.donutValue}>{chart() ? formatPercent((chart() as { used: number }).used) : "…"}</span>
                            <Show when={props.size.h === 1}>
                                <span class={styles.usageSubtle}>{title()}</span>
                            </Show>
                        </div>
                    </div>
                    <Show when={props.size.w > 1}>
                        <ul class={styles.legend} aria-hidden="true">
                            <For each={rows()}>
                                {(row) => (
                                    <li class={styles.legendRow}>
                                        <span class={styles.legendSwatch} style={{ background: row.color }} />
                                        <span class={styles.legendLabel}>{row.label}</span>
                                        <span class={styles.legendValue}>{row.detail}</span>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

const Slices: Component<{ segments: Segment[] }> = (props) => {
    const placed = () => {
        let start = 0;
        return props.segments.map((segment) => {
            const length = segment.fraction * 100;
            const slice = { segment, start, length: length > SLICE_GAP * 2 ? length - SLICE_GAP : length };
            start += length;
            return slice;
        });
    };
    return (
        <For each={placed()}>
            {(slice) => (
                <circle
                    class={styles.donutSlice}
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    pathLength="100"
                    // a style, not the attribute: presentation attributes don't read var()
                    style={{ stroke: slice.segment.color }}
                    stroke-dasharray={`${slice.length} ${100 - slice.length}`}
                    stroke-dashoffset={-slice.start}
                />
            )}
        </For>
    );
};

export default UsageDonut;
