// A field whose value is a single use token (a sign-in code, an address) has
// no button to press: pasting it sends it, and Enter sends a typed one. The
// handlers go on the field's props.

import type { JSX } from "solid-js";

/** `onPaste` hands the pasted text to `send` at once; `onKeyDown` hands over what's typed on Enter. */
export function submitOnPaste(send: (value: string) => unknown): {
    onPaste: JSX.EventHandler<HTMLInputElement, ClipboardEvent>;
    onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent>;
} {
    return {
        onPaste: (e) => {
            const pasted = e.clipboardData?.getData("text") ?? "";
            if (!pasted.trim()) return;
            e.preventDefault();
            void send(pasted);
        },
        onKeyDown: (e) => {
            if (e.key !== "Enter" || e.isComposing) return;
            e.preventDefault();
            void send(e.currentTarget.value);
        },
    };
}
