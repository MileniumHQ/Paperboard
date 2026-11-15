// A project's canvas in miniature, for its card on the home screen: each
// block's outline where it sits, in its colour, the way a document's first
// page shows on its card. Drawn from where the page last saw the blocks, so
// nothing is rendered or stored as an image, and the colours follow the theme.
import { For, Show } from "solid-js";
import { getVarCss, PaperIcon } from "@mileniumhq/paperui";
import type { CanvasPreview as Preview } from "../panel";
import { tokenPixels } from "../lib/tokens";
import styles from "./Projects.module.css";

export default function CanvasPreview(props: { preview: Preview | null }) {
    return (
        <Show
            when={props.preview?.blocks.length ? props.preview : null}
            fallback={
                <div class={`${styles.preview} ${styles.previewEmpty}`} aria-hidden="true">
                    <PaperIcon>extension</PaperIcon>
                </div>
            }
        >
            {(preview) => {
                const b = () => preview().bounds;
                // room around the drawing, so blocks don't touch the card's edge
                const margin = tokenPixels("--paper-uigap");
                return (
                    <svg
                        class={styles.preview}
                        viewBox={`${b().x - margin} ${b().y - margin} ${b().w + margin * 2} ${b().h + margin * 2}`}
                        preserveAspectRatio="xMidYMid meet"
                        aria-hidden="true"
                    >
                        <For each={preview().blocks}>{(block) => <path d={block.path} transform={`translate(${block.x} ${block.y})`} fill={getVarCss(block.fill)} />}</For>
                    </svg>
                );
            }}
        </Show>
    );
}
