import { createSignal, onCleanup } from "solid-js";

// Tracks PaperUI's reduced-motion mode reactively
export function createReducedMotion(): () => boolean {
    const read = () =>
        typeof document !== "undefined" &&
        document.documentElement.hasAttribute("data-paperui-motion");

    const [reduced, setReduced] = createSignal<boolean>(read());

    const observer = new MutationObserver(() => setReduced(read()));
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-paperui-motion"],
    });

    onCleanup(() => observer.disconnect());

    return reduced;
}
