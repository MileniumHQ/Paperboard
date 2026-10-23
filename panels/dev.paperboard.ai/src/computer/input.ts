// The user's keyboard and pointer, turned into the computer's input events.
// The computer takes key names as xdotool keysyms (letters, digits, _ and +
// only), so everything else is named here or typed as text.

import type { InputEvent } from "../contract";

const NAMED: Record<string, string> = {
    Enter: "Return",
    Backspace: "BackSpace",
    Tab: "Tab",
    Escape: "Escape",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "Prior",
    PageDown: "Next",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
};

// punctuation by keysym, for chords like ctrl+minus
const PUNCTUATION: Record<string, string> = {
    " ": "space", "-": "minus", "=": "equal", "+": "plus", ",": "comma", ".": "period", "/": "slash",
    ";": "semicolon", "'": "apostrophe", "[": "bracketleft", "]": "bracketright", "\\": "backslash", "`": "grave",
};

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "OS", "Hyper", "Super"]);

export interface KeyLike {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

/** One key press → a key chord or text, or null for keys that mean nothing on their own (a lone Shift). */
export function keyEvent(e: KeyLike): InputEvent | null {
    if (MODIFIERS.has(e.key)) return null;
    const mods = [e.ctrlKey && "ctrl", e.altKey && "alt", e.metaKey && "super"].filter((m): m is string => Boolean(m));
    const named = NAMED[e.key] ?? (/^F([1-9]|1[0-2])$/.test(e.key) ? e.key : undefined);
    // plain characters (shifted ones included) are typed, so layouts and symbols come through as written
    if (!named && mods.length === 0) return [...e.key].length === 1 ? { type: "text", text: e.key } : null;
    const base = named ?? (/^[a-zA-Z0-9]$/.test(e.key) ? e.key.toLowerCase() : PUNCTUATION[e.key]);
    if (!base) return null;
    if (e.shiftKey) mods.push("shift");
    return { type: "key", keys: [...mods, base].join("+") };
}

/** Add an event to a pending batch: typing joins up, moves and scrolls coalesce, and the batch stays bounded. */
export function enqueue(batch: InputEvent[], ev: InputEvent, max = 64): boolean {
    const last = batch.at(-1);
    if (ev.type === "text" && last?.type === "text" && last.text.length + ev.text.length <= 2000) {
        last.text += ev.text;
        return true;
    }
    if (ev.type === "move" && last?.type === "move") {
        batch[batch.length - 1] = ev;
        return true;
    }
    if (ev.type === "scroll" && last?.type === "scroll" && last.x === ev.x && last.y === ev.y) {
        last.dy = clampScroll((last.dy ?? 0) + (ev.dy ?? 0));
        last.dx = clampScroll((last.dx ?? 0) + (ev.dx ?? 0));
        return true;
    }
    if (batch.length >= max) return false;
    batch.push(ev);
    return true;
}

const clampScroll = (n: number) => Math.max(-20, Math.min(20, n));
