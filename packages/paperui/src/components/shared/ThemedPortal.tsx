import { createRenderEffect, type ParentProps } from "solid-js";
import { Portal } from "solid-js/web";
import { usePaper } from "../PaperProvider";

/**
 * A Portal that keeps its provider's theme. What it mounts lives at the end
 * of <body>, outside the provider's root, so without this a menu or dialog
 * under a dark provider would take the document's theme instead. Outside a
 * provider it is a plain Portal.
 */
export function ThemedPortal(props: ParentProps) {
    const paper = usePaper();
    return (
        <Portal
            ref={(wrapper: HTMLDivElement) => {
                if (paper) createRenderEffect(() => wrapper.setAttribute("data-paperui-theme", paper.resolvedTheme()));
            }}
        >
            {props.children}
        </Portal>
    );
}
