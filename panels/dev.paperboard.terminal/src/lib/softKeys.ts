// The keys a phone's keyboard doesn't have, and what each one sends to the
// shell. Pure, so the screen, the key row and the tests share one answer.

/** a key the key row sends as an escape sequence or control character */
export type NamedKey = "esc" | "tab" | "up" | "down" | "left" | "right" | "home" | "end" | "pageUp" | "pageDown";

/** Ctrl and Alt are latched by the key row and apply to the next key */
export interface Modifiers {
    ctrl: boolean;
    alt: boolean;
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false };

// xterm's modifier parameter: 1 plus alt (2) and ctrl (4)
function modifierParam({ ctrl, alt }: Modifiers): number {
    return 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);
}

const CURSOR_FINAL: Partial<Record<NamedKey, string>> = { up: "A", down: "B", right: "C", left: "D", home: "H", end: "F" };
const TILDE_CODE: Partial<Record<NamedKey, number>> = { pageUp: 5, pageDown: 6 };

/**
 * What a key sends. The cursor keys send `ESC O` instead of `ESC [` while a
 * program (vim, less, readline's vi mode) has asked for application cursor
 * keys; with a modifier they always send the long form every program reads.
 */
export function keyBytes(key: NamedKey, applicationCursor: boolean, mods: Modifiers = NO_MODIFIERS): string {
    const param = modifierParam(mods);
    if (key === "esc") return "\x1b";
    if (key === "tab") return mods.alt ? "\x1b\t" : "\t";
    const tilde = TILDE_CODE[key];
    if (tilde !== undefined) return param > 1 ? `\x1b[${tilde};${param}~` : `\x1b[${tilde}~`;
    const final = CURSOR_FINAL[key];
    if (!final) throw new Error(`"${key}" is not a key the key row sends`);
    if (param > 1) return `\x1b[1;${param}${final}`;
    return applicationCursor ? `\x1bO${final}` : `\x1b[${final}`;
}

// Ctrl and a character: the character's low five bits, with the few
// punctuation marks terminals map to control codes
function controlOf(char: string): string | null {
    const code = char.charCodeAt(0);
    if (/^[a-zA-Z]$/.test(char)) return String.fromCharCode(code & 0x1f);
    switch (char) {
        case " ":
        case "@":
            return "\x00";
        case "[":
            return "\x1b";
        case "\\":
            return "\x1c";
        case "]":
            return "\x1d";
        case "^":
            return "\x1e";
        case "_":
            return "\x1f";
        case "?":
            return "\x7f";
        default:
            return null;
    }
}

/**
 * Typed data with the latched modifiers applied. Only one printable
 * character takes a modifier: a paste, an escape sequence or a control
 * character from a keyboard passes through unchanged and leaves the
 * modifiers latched. `consumed` says the modifiers were used up.
 */
export function withModifiers(data: string, mods: Modifiers): { data: string; consumed: boolean } {
    if (!mods.ctrl && !mods.alt) return { data, consumed: false };
    // one character, counting an emoji or other astral character as one
    const chars = [...data];
    if (chars.length !== 1 || data < " " || data === "\x7f") return { data, consumed: false };
    let out = data;
    if (mods.ctrl) {
        const control = controlOf(data);
        // Ctrl with a character that has no control code is only the character
        if (control !== null) out = control;
    }
    if (mods.alt) out = `\x1b${out}`;
    return { data: out, consumed: true };
}
