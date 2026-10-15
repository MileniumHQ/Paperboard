import { PaperButton, PaperChart, PaperChartLegend, PaperWidget, PaperWidgetMessage, PaperWidgetStat, type PaperChartSegment } from "@mileniumhq/paperui";
import { type Component, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { BuiltinWidgetProps } from "./types";
import { widgetTitle } from "./systemFigures";
import { USAGE_HISTORY_SAMPLES, useUsage } from "./usageStore";
import { formatBytes, formatPercent, type Segment, usageChart, usedFraction, type UsageMetric } from "./usageSegments";
import styles from "./Builtins.module.css";

// the legend has room for one figure per row; the ring's tooltip adds CPU
const toChart = (segment: Segment, withCpu = true): PaperChartSegment => ({
    label: segment.label,
    value: segment.fraction,
    color: segment.color,
    detail: withCpu && segment.cpu ? `${segment.detail} · ${segment.cpu} CPU` : segment.detail,
});

// How much of a computer's CPU or memory each panel, Paperboard, and
// everything else uses, as a ring around what's in use.
const UsageDonut: Component<BuiltinWidgetProps & { metric: UsageMetric }> = (props) => {
    const usage = useUsage(() => props.computerId, () => props.visible);
    const title = () => (props.metric === "cpu" ? "CPU" : "Memory");
    const tall = () => props.size.h > 1;
    const chart = createMemo(() => {
        const state = usage.state();
        return state.kind === "ready" ? usageChart(state.report, props.metric, props.panelName) : null;
    });
    const slices = () => (chart()?.segments ?? []).map((segment) => toChart(segment));
    // the legend names as many of the largest users as its box has rows
    // for, then "Free"; the rest are in the ring and the chart's name
    const [rows, setRows] = createSignal(3);
    const fitLegend = (box: HTMLDivElement) => {
        const observer = new ResizeObserver(() => {
            const row = box.querySelector("li")?.getBoundingClientRect().height;
            if (row) setRows(Math.max(2, Math.floor(box.clientHeight / row)));
        });
        observer.observe(box);
        onCleanup(() => observer.disconnect());
    };
    const legend = () => {
        const c = chart();
        return c ? [...c.segments.slice(0, rows() - 1), c.free].map((segment) => toChart(segment, false)) : [];
    };
    // how the share in use has moved while the widget was watched
    const trend = () =>
        usage.history().map((report) => usedFraction(report, props.metric)).filter((used): used is number => used !== null);
    const summary = () => {
        const state = usage.state();
        if (state.kind !== "ready") return "";
        if (props.metric === "memory") {
            // what's in use is in the ring and the legend; the header says out of what
            return `${formatBytes(state.report.memory.totalBytes)} total`;
        }
        const cores = state.report.cpu?.cores;
        return cores ? `${cores} ${cores === 1 ? "core" : "cores"}` : "";
    };
    const label = () => {
        const c = chart();
        const what = `${title()} on ${props.computerName}`;
        return c ? `${what}, ${formatPercent(c.used)} in use, ${formatPercent(c.free.fraction)} free` : what;
    };

    const used = () => chart()?.used;
    const unavailable = () => {
        const state = usage.state();
        return state.kind === "unavailable" ? state.message : undefined;
    };

    return (
        <PaperWidget title={widgetTitle(title(), props)} icon={props.metric === "cpu" ? "memory" : "memory_alt"} detail={props.size.w > 1 ? summary() : undefined}>
            <Show
                when={!unavailable()}
                fallback={
                    <PaperWidgetMessage title="Not available" description={unavailable()} tone="warning">
                        <PaperButton size="tiny" onClick={usage.retry}>Retry</PaperButton>
                    </PaperWidgetMessage>
                }
            >
                {/* one cell: the share in use, as a figure and a bar */}
                <Show
                    when={props.size.w > 1}
                    fallback={
                        <Show when={used() !== undefined}>
                            <PaperWidgetStat
                                role="img"
                                aria-label={label()}
                                value={formatPercent(used() ?? 0)}
                                caption={summary() || undefined}
                                meter={{ value: used() ?? 0, max: 1, variant: (used() ?? 0) > 0.9 ? "danger" : "primary" }}
                            />
                        </Show>
                    }
                >
                    <div class={styles.usageBody} classList={{ [styles.usageTall]: tall() }}>
                        {/* a square tile has room to show the last two minutes beside the ring */}
                        <div class={styles.usageCharts}>
                            <PaperChart class={styles.donut} label={label()} segments={slices()} total={1} thickness={13}>
                                <span class={styles.donutValue}>{used() !== undefined ? formatPercent(used() ?? 0) : ""}</span>
                            </PaperChart>
                            <Show when={tall()}>
                                <PaperChart
                                    type="line"
                                    class={styles.trend}
                                    label={`${title()} in use over the last two minutes`}
                                    series={[{ label: "Now", values: trend(), detail: used() !== undefined ? formatPercent(used() ?? 0) : undefined }]}
                                    min={0}
                                    max={1}
                                    span={USAGE_HISTORY_SAMPLES}
                                    fill
                                />
                            </Show>
                        </div>
                        <div ref={fitLegend} class={styles.legendBox} aria-hidden="true">
                            <PaperChartLegend class={styles.legend} segments={legend()} total={1} />
                        </div>
                    </div>
                </Show>
            </Show>
        </PaperWidget>
    );
};

export default UsageDonut;
