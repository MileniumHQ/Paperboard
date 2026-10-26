import { createEffect, onCleanup } from "solid-js";

/** Hosts dispatch this cancelable event when their system Back action fires.
 * The most recently opened page or modal gets the first opportunity to close. */
const layers: Array<() => void> = [];
export function createNavigationBack(active: () => boolean, close: () => void): void {
    createEffect(() => {
        if (!active()) return;
        layers.push(close);
        const back = (event: Event) => {
            if (event.defaultPrevented || layers.at(-1) !== close) return;
            event.preventDefault();
            close();
        };
        window.addEventListener("paperboard:back", back);
        onCleanup(() => {
            window.removeEventListener("paperboard:back", back);
            const index = layers.indexOf(close);
            if (index !== -1) layers.splice(index, 1);
        });
    });
}
