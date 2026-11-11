// What the terminal screen works out from what its shell marked (OSC 133)
// and what is on it. Pure, so the rules are tested without a screen.

/** the line a prompt jump scrolls to, or null when there is none that way */
export function promptTarget(prompts: number[], viewportTop: number, direction: -1 | 1): number | null {
    const sorted = [...prompts].sort((a, b) => a - b);
    if (direction < 0) {
        for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < viewportTop) return sorted[i];
        return null;
    }
    for (const line of sorted) if (line > viewportTop) return line;
    return null;
}

/** a screen line as the terminal holds it: its text, and whether it continues the line above */
export interface ScreenLine {
    text: string;
    wrapped: boolean;
}

/**
 * A command's output, from the line it started on up to the line it ended
 * on: a line the screen wrapped joins the one it continues, and trailing
 * blank lines go.
 */
export function outputText(lines: ScreenLine[]): string {
    const joined: string[] = [];
    for (const line of lines) {
        if (line.wrapped && joined.length > 0) joined[joined.length - 1] += line.text;
        else joined.push(line.text);
    }
    return joined.map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
}

/**
 * A paste that runs as soon as it lands: it holds a line break, the shell is
 * at its prompt (it marked one, and no command has started since), and it
 * isn't reading pastes as a whole (bracketed paste, where nothing runs until
 * Enter). Those are asked about first. A paste into a running program is its
 * input, not commands; a shell that doesn't mark its prompt can't be told
 * apart from one, so neither is asked about.
 */
export function pasteRunsAtOnce(text: string, shell: { atPrompt: boolean; bracketedPaste: boolean }): boolean {
    return shell.atPrompt && !shell.bracketedPaste && /[\r\n]/.test(text);
}

/** how many lines a paste is, for the question asked about it */
export function pasteLines(text: string): number {
    return text.replace(/(\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/).length;
}

/**
 * Whether the system browser opens a link: https anywhere, http on this
 * computer (a development server). The app holds the same rule.
 */
export function linkOpens(uri: string): boolean {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return false;
    }
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);
}
