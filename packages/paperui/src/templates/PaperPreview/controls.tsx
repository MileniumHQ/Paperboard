import styles from "./controls.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import { cx } from "../../utils/cx";

export interface PaperPreviewControlsProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** names the group for assistive technology, such as "Zoom" */
    "aria-label": string;
}

/**
 * The few controls a viewer floats over what it shows (zoom, pages, reset
 * view), in a pill at the bottom edge. Where a pointer can hover, they rest
 * faded until the viewer is hovered or one of them has focus.
 */
export function PaperPreviewControls(props: ParentProps<PaperPreviewControlsProps>) {
    const [local, rest] = splitProps(props, ["class", "children"]);
    return (
        <div role="toolbar" {...rest} class={cx(styles.controls, local.class)}>
            {local.children}
        </div>
    );
}

/** A number between the controls, such as "3 / 12" or "125%". */
export function PaperPreviewReadout(props: ParentProps<{ "aria-live"?: "polite" | "off"; title?: string }>) {
    return (
        <span class={styles.readout} aria-live={props["aria-live"] ?? "off"} title={props.title}>
            {props.children}
        </span>
    );
}

/** The class a viewer's root takes so its controls appear when it is hovered. */
export const previewHost = styles.host;
