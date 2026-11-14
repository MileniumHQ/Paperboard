// The phone's key row: shown while a screen has the cursor, which is while
// the on-screen keyboard is up; it rides on top of the keyboard. Ctrl and
// Alt latch for the next key typed.
import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { watchKeyboardInset } from "./keyboardInset";
import { NO_MODIFIERS, type Modifiers, type NamedKey } from "./softKeys";
import type { TerminalHandle } from "../Terminal";

export function createKeyRow(mobile: () => boolean, screen: () => TerminalHandle | undefined) {
    const [typing, setTyping] = createSignal(false);
    const [keyboardInset, setKeyboardInset] = createSignal(0);
    const [modifiers, setModifiers] = createSignal<Modifiers>(NO_MODIFIERS);
    const shown = () => mobile() && typing();
    onMount(() => {
        onCleanup(watchKeyboardInset(setKeyboardInset));
        // a screen has the cursor when its helper textarea does; focus moving
        // between screens, or to a key and back, settles before it is read
        const read = () => setTyping(document.activeElement?.classList.contains("xterm-helper-textarea") ?? false);
        const lost = () => setTimeout(read);
        document.addEventListener("focusin", read);
        document.addEventListener("focusout", lost);
        onCleanup(() => {
            document.removeEventListener("focusin", read);
            document.removeEventListener("focusout", lost);
        });
    });
    // the latch is for the next key typed, not for the next time the keyboard comes up
    createEffect(on(shown, (now) => !now && setModifiers(NO_MODIFIERS)));
    const keepKeyboard = () => screen()?.focus();

    return {
        shown,
        keyboardInset,
        modifiers,
        /** the next key used up the latched modifiers */
        used: () => setModifiers(NO_MODIFIERS),
        keepKeyboard,
        toggle(which: keyof Modifiers) {
            setModifiers((m) => ({ ...m, [which]: !m[which] }));
            keepKeyboard();
        },
        press(key: NamedKey) {
            screen()?.sendKey(key);
            keepKeyboard();
        },
        type(text: string) {
            screen()?.type(text);
            keepKeyboard();
        },
        hideKeyboard() {
            const field = document.activeElement;
            if (field instanceof HTMLElement) field.blur();
            setTyping(false);
        },
    };
}
