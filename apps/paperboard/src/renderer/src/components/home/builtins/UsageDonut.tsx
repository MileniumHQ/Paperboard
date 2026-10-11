import { PaperButton, PaperChart, PaperChartLegend, PaperText, type PaperChartSegment } from "@mileniumhq/paperui";
import { type Component, createMemo, Show } from "solid-js";
import type { BuiltinWidgetProps } from "./types";
import { USAGE_HISTORY_SAMPLES, useUsage } from "./usageStore";
import { formatBytes, formatPercent, type Segment, usageChart, usedFraction, type UsageMetric } from "./usageSegments";
import styles from "./Builtins.module.css";

// the largest users a legend names before "Free"; the rest are in the chart's name
const LEGEND_ROWS = 2;

const toChart = (segment: Segment): PaperChartSegment => ({
    label: segment.label,
    value: segment.fraction,
    color: segment.color,
    detail: segment.detail,
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
    const slices = () => (chart()?.segments ?? []).map(toChart);
    const legend = () => {
        const c = chart();
        return c ? [...c.segments.slice(0, LEGEND_ROWS), c.free].map(toChart) : [];
    };
    // how the share in use has moved while the widget was watched
    const trend = () =>
        usage.history().map((report) => usedFraction(report, props.metric)).filter((used): used is number => used !== null);
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
        const what = `${title()} on ${props.computerName}`;
        return c ? `${what}, ${formatPercent(c.used)} in use, ${formatPercent(c.free.fraction)} free` : what;
    };

    return (
        <div
            class={styles.usage}
            classList={{ [styles.usageSmall]: props.size.w === 1, [styles.usageTall]: tall() }}
        >
            <Show when={tall()}>
                <div class={styles.usageHeader}>
                    <PaperText size={2} weight={800} truncate class={styles.usageTitle}>
                        {title()}
                        <Show when={props.showComputer}>
                            <PaperText size={1} weight={400} color="text-subtle"> · {props.computerName}</PaperText>
                        </Show>
                    </PaperText>
                    <PaperText size={1} color="text-subtle" class={styles.usageSubtle}>{summary()}</PaperText>
                </div>
            </Show>
            <Show
                when={usage.state().kind !== "unavailable"}
                fallback={
                    <div class={styles.usageMessage} role="alert">
                        <PaperText size={1} color="text-subtle">{(usage.state() as { message: string }).message}</PaperText>
                        <PaperButton size="tiny" variant="text" onClick={usage.retry}>Retry</PaperButton>
                    </div>
                }
            >
                <div class={styles.usageBody}>
                    {/* a square tile has room to show the last two minutes beside a smaller ring */}
                    <div class={styles.usageCharts}>
                        <PaperChart class={styles.donut} label={label()} segments={slices()} total={1} thickness={13}>
                            <span class={styles.donutValue}>{chart() ? formatPercent((chart() as { used: number }).used) : "…"}</span>
                            <Show when={props.size.w === 1}>
                                <span class={styles.donutCaption}>{title()}</span>
                            </Show>
                        </PaperChart>
                        <Show when={tall()}>
                            <PaperChart
                                type="line"
                                class={styles.trend}
                                label={`${title()} in use over the last two minutes`}
                                series={[{ label: "Now", values: trend(), detail: chart() ? formatPercent((chart() as { used: number }).used) : undefined }]}
                                min={0}
                                max={1}
                                span={USAGE_HISTORY_SAMPLES}
                                fill
                            />
                        </Show>
                    </div>
                    <Show when={props.size.w > 1}>
                        <div class={styles.usageSide} aria-hidden="true">
                            <Show when={!tall()}>
                                <PaperText size={2} weight={800} truncate>{title()}</PaperText>
                            </Show>
                            {/* a wide tile is one row high: the ring takes its height, which leaves room for names only */}
                            <PaperChartLegend class={styles.legend} segments={legend()} total={1} compact={!tall()} />
                        </div>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default UsageDonut;
