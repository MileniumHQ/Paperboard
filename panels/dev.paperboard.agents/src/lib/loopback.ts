// A sign-in whose page comes back to a loopback address, for as long as the
// view shows that address (PaperAPI's catchLoopbackSignIn does the rest).

import { catchLoopbackSignIn, errorMessage } from "@mileniumhq/paperapi";
import { createEffect, createSignal, on, onCleanup } from "solid-js";

/** `finish` hands the caught address over and resolves whether it was taken. */
export function createLoopbackCatch(callback: () => string | null, finish: (url: string) => Promise<boolean>) {
    // set when the person pastes the address, with why it wasn't caught (or null)
    const [paste, setPaste] = createSignal<{ error: string | null } | null>(null);
    createEffect(
        on(callback, (address) => {
            setPaste(null);
            if (!address) return;
            const stop = new AbortController();
            onCleanup(() => stop.abort());
            catchLoopbackSignIn(address, finish, { signal: stop.signal }).then(
                (result) => !stop.signal.aborted && result.status === "paste" && setPaste({ error: result.error }),
                // given up on (the view moved on) is no failure; anything else is told beside the field
                (e) => !stop.signal.aborted && setPaste({ error: errorMessage(e) }),
            );
        }),
    );
    return { paste: () => paste() !== null, error: () => paste()?.error ?? null };
}
