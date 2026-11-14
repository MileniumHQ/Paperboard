// "2m ago" moves only while someone can see it: a clock that ticks while
// `active` is true and reads the time again each time it turns on.
import { createEffect, createSignal, on, onCleanup } from "solid-js";

const AGO_TICK_MS = 15_000;

export function createAgoClock(active: () => boolean): () => number {
    const [now, setNow] = createSignal(Date.now());
    createEffect(
        on(active, (shown) => {
            if (!shown) return;
            setNow(Date.now());
            const timer = setInterval(() => setNow(Date.now()), AGO_TICK_MS);
            onCleanup(() => clearInterval(timer));
        }),
    );
    return now;
}
