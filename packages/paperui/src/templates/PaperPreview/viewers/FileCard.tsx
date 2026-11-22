import styles from "./viewers.module.css";
import { children, Show, type JSX } from "solid-js";
import { PaperIcon } from "../../../components/PaperIcon";
import { PaperText } from "../../../components/PaperText";
import { formatBytes } from "../../../utils/bytes";
import { previewIcon, previewKindLabel, type PaperPreviewKind } from "../kinds";

/**
 * A file there is no viewer for, as Quick Look shows one: its symbol, its
 * name, what it is and how big, and whatever the host offers to do with it.
 */
export function FileCard(props: { name: string; kind: PaperPreviewKind | null; size?: number; children?: JSX.Element }) {
    const actions = children(() => props.children);
    const detail = () => [previewKindLabel(props.kind, props.name), props.size !== undefined ? formatBytes(props.size) : null].filter(Boolean).join(" · ");
    return (
        <div class={`${styles.sheet} ${styles.card}`}>
            <span class={styles.cardIcon}>
                <PaperIcon>{previewIcon(props.kind)}</PaperIcon>
            </span>
            <PaperText preset="label" class={styles.cardName}>
                {props.name}
            </PaperText>
            <PaperText size={2} color="text-muted">
                {detail()}
            </PaperText>
            <Show when={actions()}>
                <div class={styles.cardActions}>{actions()}</div>
            </Show>
        </div>
    );
}
