// Terminal keyboard policy.
//
// Copy is taken over by the panel: PaperUI's shared clipboard helper (async
// API plus the execCommand fallback) works regardless of whether the panel
// iframe holds clipboard focus.
//
// Paste is deliberately NOT intercepted. Intercepting it cancelled the keydown
// and thus suppressed the browser's native paste event, while the replacement
// (a programmatic clipboard read) is denied whenever the panel iframe does not
// hold clipboard-read focus. Leaving the key alone lets xterm's own paste
// handler insert the clipboard through the event the OS/browser delivers.

export interface TerminalKeyEvent {
    type: string;
    code: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

export type TerminalKeyAction = "copy" | null;

/** Which terminal action the keydown should run, if any. */
export function terminalKeyAction(ev: TerminalKeyEvent): TerminalKeyAction {
    if (ev.type !== "keydown") return null;
    // Ctrl+Shift+C everywhere, Cmd+C on macOS
    if (ev.code === "KeyC" && ((ev.ctrlKey && ev.shiftKey) || ev.metaKey)) return "copy";
    return null;
}
