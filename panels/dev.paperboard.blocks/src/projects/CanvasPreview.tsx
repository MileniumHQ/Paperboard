// A project's canvas in miniature, for its card on the home screen: each
// stack of blocks drawn as the room it takes, the way a document's first
// page shows on its card. Drawn from where the page last saw the stacks, so
// nothing is rendered or stored as an image.
import { For, Show } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import type { CanvasPreview as Preview } from "../lib/projects";
import { tokenPixels } from "../lib/tokens";
import styles from "./Projects.module.css";

export default function CanvasPreview(props: { preview: Preview | null }) {
    return (
        <Show
            when={props.preview?.rects.length ? props.preview : null}
            fallback={
                <div class={`${styles.preview} ${styles.previewEmpty}`} aria-hidden="true">
                    <PaperIcon>extension</PaperIcon>
                </div>
            }
        >
            {(preview) => {
                const b = () => preview().bounds;
                // a stack's corners, as the canvas rounds them
                const radius = tokenPixels("--paper-border-radius-half");
                // room around the drawing, so stacks don't touch the card's edge
                const margin = tokenPixels("--paper-uigap") * 4;
                return (
                    <svg
                        class={styles.preview}
                        viewBox={`${b().x - margin} ${b().y - margin} ${b().w + margin * 2} ${b().h + margin * 2}`}
                        preserveAspectRatio="xMidYMid meet"
                        aria-hidden="true"
                    >
                        <For each={preview().rects}>{(r) => <rect class={styles.previewStack} x={r.x} y={r.y} width={r.w} height={r.h} rx={radius} />}</For>
                    </svg>
                );
            }}
        </Show>
    );
}
