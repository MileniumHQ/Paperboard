// A project's canvas in miniature, for its card on the home screen: each
// flow and note drawn as the room it takes, the way a document's first page
// shows on its card. Drawn from the service's layout estimate, so nothing
// is rendered or stored as an image.
import { For, Show } from "solid-js";
import { PaperIcon } from "@mileniumhq/paperui";
import type { CanvasPreview as Preview } from "../lib/flowLayout";

// room around the drawing, in canvas pixels, so flows don't touch the edge
const MARGIN = 120;

export default function CanvasPreview(props: { preview: Preview | null }) {
    return (
        <Show
            when={props.preview}
            fallback={
                <div class="project-preview project-preview-empty" aria-hidden="true">
                    <PaperIcon>account_tree</PaperIcon>
                </div>
            }
        >
            {(preview) => {
                const b = () => preview().bounds;
                return (
                    <svg
                        class="project-preview"
                        viewBox={`${b().x - MARGIN} ${b().y - MARGIN} ${b().w + MARGIN * 2} ${b().h + MARGIN * 2}`}
                        preserveAspectRatio="xMidYMid meet"
                        aria-hidden="true"
                    >
                        <For each={preview().rects}>
                            {(r) => (
                                <rect
                                    class={r.kind === "note" ? "project-preview-note" : "project-preview-flow"}
                                    x={r.x}
                                    y={r.y}
                                    width={r.w}
                                    height={r.h}
                                    rx={24}
                                />
                            )}
                        </For>
                    </svg>
                );
            }}
        </Show>
    );
}
