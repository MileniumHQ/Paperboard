import { Show } from "solid-js";
import { PaperIcon, PaperText } from "@paperboard-dev/paperui";
import { FIT_LABELS, formatBytes, type FitEstimate, type FitRating } from "../core/fit";
import styles from "./FitMeter.module.css";

const ICONS: Record<FitRating, string> = {
    gpu: "bolt",
    partial: "speed",
    cpu: "memory",
    "too-big": "block",
    unknown: "help",
};

/**
 * How a model fits this computer: the fill is the memory the model needs,
 * laid over the GPU share (left) and the spill-over RAM (right).
 */
export default function FitMeter(props: { fit: FitEstimate; measuredTps?: number }) {
    const ramShare = () => props.fit.ramBytes * 0.6;
    const capacity = () => Math.max(props.fit.needBytes, props.fit.gpuBytes + ramShare(), 1);
    const pct = (n: number) => `${Math.min(100, (n / capacity()) * 100).toFixed(2)}%`;
    const label = () => FIT_LABELS[props.fit.rating];

    return (
        <div class={styles.FitMeter} data-rating={props.fit.rating}>
            <div class={styles.head}>
                <span class={styles.rating}>
                    <PaperIcon>{ICONS[props.fit.rating]}</PaperIcon>
                    <PaperText size={3} weight={700}>{label().title}</PaperText>
                </span>
                <Show when={props.measuredTps}>
                    <PaperText size={2} color="text-muted">{props.measuredTps} tokens/s measured</PaperText>
                </Show>
            </div>
            <div
                class={styles.track}
                role="meter"
                aria-label="Memory this model needs"
                aria-valuemin={0}
                aria-valuemax={Math.round(capacity())}
                aria-valuenow={Math.round(props.fit.needBytes)}
                aria-valuetext={`Needs about ${formatBytes(props.fit.needBytes)}; ${label().title}`}
            >
                <div class={styles.gpuZone} style={{ width: pct(props.fit.gpuBytes) }} />
                <div class={styles.fill} style={{ width: pct(props.fit.needBytes) }} />
            </div>
        </div>
    );
}
