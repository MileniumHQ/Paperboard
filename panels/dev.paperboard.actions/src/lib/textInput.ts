// Input hygiene for the flow builder's contenteditable fields: they only
// ever store plain text (plus chip markup the panel itself inserts), so
// pasted rich content and non-numeric keystrokes are stripped before they
// can enter the DOM.

/** Keeps digits, one leading minus and one decimal point. */
export function sanitizeNumberText(text: string): string {
    let out = "";
    let seenDot = false;
    for (const ch of text) {
        if (ch >= "0" && ch <= "9") out += ch;
        else if (ch === "-" && out === "") out += ch;
        else if (ch === "." && !seenDot) {
            out += ch;
            seenDot = true;
        }
    }
    return out;
}

/**
 * Single-line fields must not receive the newlines rich pastes carry, so
 * they collapse to spaces. Multiline fields keep their line breaks (CRLF is
 * normalized to LF and no other whitespace is touched).
 */
export function plainTextFromClipboard(
    raw: string | null | undefined,
    multiline = false,
): string {
    const text = (raw ?? "").replace(/\r\n?/g, "\n");
    return multiline ? text : text.replace(/\s*\n\s*/g, " ");
}
