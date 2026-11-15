// A sign-in whose page comes back to a loopback address. On the computer the
// sign-in runs on, its own listener hears the browser. On another device the
// panel catches the address here and hands it to `finish`. Where nothing can
// catch it (Paperboard in a web browser), or the address was refused, the
// person pastes it.

import { catchLoopbackRedirect, LoopbackRedirectError } from "@mileniumhq/paperapi";
import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { errorText } from "./failure";

/** `finish` hands the caught address over and resolves whether it was taken. */
export function createLoopbackCatch(callback: () => string | null, finish: (url: string) => Promise<boolean>) {
    const [paste, setPaste] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    createEffect(
        on(callback, (address) => {
            setPaste(false);
            setError(null);
            if (!address) return;
            const stop = new AbortController();
            onCleanup(() => stop.abort());
            catchLoopbackRedirect(address, { signal: stop.signal }).then(
                async (result) => {
                    if (stop.signal.aborted || result.status === "local") return;
                    // an address that was refused can still be pasted again
                    if (!(await finish(result.url)) && !stop.signal.aborted) setPaste(true);
                },
                (e) => {
                    if (stop.signal.aborted) return;
                    setPaste(true);
                    // no listener here (a web browser) is why there's a field, not a failure
                    if (!(e instanceof LoopbackRedirectError && e.code === "unavailable")) setError(errorText(e));
                },
            );
        }),
    );
    return { paste, error };
}
