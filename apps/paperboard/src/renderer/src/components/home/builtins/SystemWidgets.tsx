import { PaperButton, PaperChart, PaperWidget, PaperWidgetMessage, PaperWidgetStat, PaperWidgetStats } from "@mileniumhq/paperui";
import { type JSX, type Component, Show } from "solid-js";
import type { BuiltinWidgetProps } from "./types";
import { type Figure, figureOf, formatRate, formatUptime, widgetTitle } from "./systemFigures";
import { USAGE_HISTORY_SAMPLES, useUsage } from "./usageStore";
import { formatBytes, formatPercent } from "./usageSegments";
import styles from "./Builtins.module.css";

// Disk, Network and Uptime: one figure each from the computer's usage
// report, through the same shared poller as CPU and Memory.

/** A figure's loading and unavailable states, the same in every widget. */
function FigureView<T>(props: { figure: Figure<T>; retry: () => void; children: (value: () => T) => JSX.Element }) {
    return (
        <Show
            when={props.figure.kind === "ready" ? (props.figure as { value: T }).value : undefined}
            keyed={false}
            fallback={
                <Show when={props.figure.kind === "unavailable" ? (props.figure as Extract<Figure<T>, { kind: "unavailable" }>) : undefined}>
                    {(failed) => (
                        <PaperWidgetMessage title="Not available" description={failed().message} tone="warning">
                            <Show when={failed().retry}>
                                <PaperButton size="tiny" onClick={props.retry}>Retry</PaperButton>
                            </Show>
                        </PaperWidgetMessage>
                    )}
                </Show>
            }
        >
            {/* an accessor: the figure updates in place with every reading */}
            {(value) => props.children(value)}
        </Show>
    );
}

// How full the drive holding Paperboard's data is: panels, worlds, models.
export const Disk: Component<BuiltinWidgetProps> = (props) => {
    const usage = useUsage(() => props.computerId, () => props.visible);
    const disk = () => figureOf(usage.state(), "disk", props.computerName);
    return (
        <PaperWidget title={widgetTitle("Disk", props)} icon="hard_drive">
            <FigureView figure={disk()} retry={usage.retry}>
                {(d) => {
                    const used = () => (d().totalBytes > 0 ? 1 - d().freeBytes / d().totalBytes : 0);
                    return (
                        <PaperWidgetStat
                            role="img"
                            aria-label={`Disk on ${props.computerName}: ${formatBytes(d().freeBytes)} free of ${formatBytes(d().totalBytes)}`}
                            value={props.size.w > 1 ? `${formatBytes(d().freeBytes)} free` : formatPercent(used())}
                            caption={props.size.w > 1 ? `${formatPercent(used())} of ${formatBytes(d().totalBytes)} used` : "used"}
                            meter={{ value: used(), max: 1, variant: used() > 0.9 ? "danger" : "primary" }}
                        />
                    );
                }}
            </FigureView>
        </PaperWidget>
    );
};

// What the computer is moving over its network adapters right now; the
// square tile adds the last two minutes of it.
export const Network: Component<BuiltinWidgetProps> = (props) => {
    const usage = useUsage(() => props.computerId, () => props.visible);
    const network = () => figureOf(usage.state(), "network", props.computerName);
    const tall = () => props.size.h > 1;
    const history = (pick: "receivePerSecond" | "sendPerSecond") =>
        usage.history().map((report) => report.network?.[pick]).filter((v): v is number => typeof v === "number");
    const peak = () => Math.max(1024, ...history("receivePerSecond"), ...history("sendPerSecond"));
    return (
        <PaperWidget title={widgetTitle("Network", props)} icon="swap_vert">
            <FigureView figure={network()} retry={usage.retry}>
                {(n) => (
                    <>
                        <PaperWidgetStats
                            role="img"
                            aria-label={`${props.computerName} is receiving ${formatRate(n().receivePerSecond)} and sending ${formatRate(n().sendPerSecond)}`}
                        >
                            <PaperWidgetStat value={formatRate(n().receivePerSecond)} caption="Down" />
                            <PaperWidgetStat value={formatRate(n().sendPerSecond)} caption="Up" />
                        </PaperWidgetStats>
                        <Show when={tall()}>
                            <PaperChart
                                type="line"
                                class={styles.trendFill}
                                label="Network traffic over the last two minutes"
                                series={[
                                    { label: "Down", values: history("receivePerSecond").map((v) => v / peak()), detail: formatRate(n().receivePerSecond) },
                                    { label: "Up", values: history("sendPerSecond").map((v) => v / peak()), detail: formatRate(n().sendPerSecond) },
                                ]}
                                min={0}
                                max={1}
                                span={USAGE_HISTORY_SAMPLES}
                            />
                        </Show>
                    </>
                )}
            </FigureView>
        </PaperWidget>
    );
};

// How long the computer has been on.
export const Uptime: Component<BuiltinWidgetProps> = (props) => {
    const usage = useUsage(() => props.computerId, () => props.visible);
    const uptime = () => figureOf(usage.state(), "uptimeSeconds", props.computerName);
    return (
        <PaperWidget title={widgetTitle("Uptime", props)} icon="schedule">
            <FigureView figure={uptime()} retry={usage.retry}>
                {(seconds) => (
                    <PaperWidgetStat
                        role="img"
                        aria-label={`${props.computerName} has been running for ${formatUptime(seconds())}`}
                        value={formatUptime(seconds())}
                        caption="running"
                    />
                )}
            </FigureView>
        </PaperWidget>
    );
};
