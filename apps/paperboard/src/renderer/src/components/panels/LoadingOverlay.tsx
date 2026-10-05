import { type Component, type JSX, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperProgress,
    PaperText,
} from "@mileniumhq/paperui";

export interface LoadingOverlayProps {
    /** Accessible name for the bar; never rendered as visible text. */
    label?: string;
    /** When set, replaces the loader with the failure and its recovery. */
    error?: string;
    retryLabel?: string;
    onRetry?: () => void;
    style?: JSX.CSSProperties;
}

// The one loading surface for shell-owned frames: panels and the panel
// library both sit behind this until their content is loaded and painted.
const LoadingOverlay: Component<LoadingOverlayProps> = (props) => (
    <PaperFlex
        direction="column"
        center
        fullWidth
        fullHeight
        gap="half"
        style={{ position: "absolute", inset: "0", ...props.style }}
    >
        <Show when={!props.error}>
            <PaperProgress
                aria-label={props.label ?? "Loading"}
                style={{ width: "12rem" }}
            />
        </Show>
        <Show when={props.error}>
            <PaperText role="alert">{props.error}</PaperText>
        </Show>
        <Show when={props.error && props.onRetry}>
            <PaperButton onClick={props.onRetry}>
                {props.retryLabel ?? "Reload"}
            </PaperButton>
        </Show>
    </PaperFlex>
);

export default LoadingOverlay;
