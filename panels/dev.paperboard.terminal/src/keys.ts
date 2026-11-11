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

export type TerminalKeyAction = "copy" | "find" | "previous-prompt" | "next-prompt" | null;

/**
 * Which terminal action the keydown should run, if any. Each takes
 * Ctrl+Shift everywhere (a shell reads Ctrl alone), and Cmd on macOS.
 */
export function terminalKeyAction(ev: TerminalKeyEvent): TerminalKeyAction {
    if (ev.type !== "keydown") return null;
    const chord = (ev.ctrlKey && ev.shiftKey) || ev.metaKey;
    if (!chord) return null;
    switch (ev.code) {
        case "KeyC":
            return "copy";
        case "KeyF":
            return "find";
        case "ArrowUp":
            return "previous-prompt";
        case "ArrowDown":
            return "next-prompt";
        default:
            return null;
    }
}

/** how a terminal shortcut reads in a menu, on this computer */
export function shortcutLabel(action: Exclude<TerminalKeyAction, null>, mac: boolean): string {
    const key = { copy: "C", find: "F", "previous-prompt": "↑", "next-prompt": "↓" }[action];
    return mac ? `⌘${key}` : `Ctrl+Shift+${key}`;
}
