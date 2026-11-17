import { type Component, type JSX, Show } from "solid-js";
import {
    PaperError,
    PaperFlex,
    PaperProgress,
    PaperText,
} from "@mileniumhq/paperui";
import styles from "./frame.module.css";

export interface LoadingOverlayProps {
    /** What is loading, drawn large above the bar: its icon and name. */
    heading?: { icon: JSX.Element; name: string };
    /** Draws the heading smaller, for a phone, so the name stays one line. */
    compact?: boolean;
    /** Accessible name for the bar; never rendered as visible text. */
    label?: string;
    /** How far along, from 0 to 1; the bar moves on its own without it. */
    value?: number;
    /** Shown under the bar when the wait needs explaining, such as a backup. */
    title?: string;
    /** Under the bar while it waits, under the failure once it failed. */
    detail?: string;
    /** When set, replaces the loader with the failure and its recovery. */
    error?: string;
    /** What failed, as "Couldn't …", over the failure's reason. */
    errorTitle?: string;
    retryLabel?: string;
    onRetry?: () => void;
}

// The one loading surface for shell-owned frames: panels and the panel
// library both sit behind this until their content is loaded and painted.
// The panel's name stands a full gap over the bar, and goes once the load
// failed: the failure names the panel itself.
const LoadingOverlay: Component<LoadingOverlayProps> = (props) => (
    <PaperFlex
        direction="column"
        center
        fullWidth
        fullHeight
        gap="full"
        class={styles.overlay}
    >
        <Show when={!props.error && props.heading}>{(heading) => (
            <PaperText as="h1" size={props.compact ? 6 : 9} weight={700} class={styles.overlayHeading}>
                {heading().icon}
                <span class={styles.overlayName}>{heading().name}</span>
            </PaperText>
        )}</Show>
        <PaperFlex direction="column" center fullWidth gap="half">
            <Show when={!props.error}>
                <PaperProgress
                    aria-label={props.label ?? "Loading"}
                    value={props.value === undefined ? undefined : props.value * 100}
                    class={styles.overlayProgress}
                />
            </Show>
            <Show when={!props.error && props.title}>
                <PaperText preset="label">{props.title}</PaperText>
            </Show>
            <Show when={props.error}>
                {(error) => (
                    <div class={styles.overlayError}>
                        <PaperError
                            fill
                            alert
                            title={props.errorTitle ?? "Couldn't load"}
                            error={error()}
                            action={props.onRetry ? { label: props.retryLabel ?? "Reload", onClick: props.onRetry } : undefined}
                        />
                    </div>
                )}
            </Show>
            <Show when={props.detail}>
                <PaperText preset="hint">{props.detail}</PaperText>
            </Show>
        </PaperFlex>
    </PaperFlex>
);

export default LoadingOverlay;
