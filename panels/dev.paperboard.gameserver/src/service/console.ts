// A server's console as its game's output fills it. Output comes in fast, so
// it is gathered for a tenth of a second and published together: a chatty
// server costs one state update per batch rather than one per line. What
// the service says itself ("[Server] Process stopped.") flushes the batch
// first, so it lands after the output that came before it.
import type { Server } from "./server";
import type { ConsoleLine } from "./types";

const CONSOLE_LINES = 1000;
const PERCENT = /\d{1,3}(?:\.\d+)?%/g;

/**
 * A progress line's step: the line with its counts masked, so "Loading world
 * data: 27%" and a new world's "95.4% - Clean up - 63.9%" (overall and step
 * count) each match their next count. Null for a line that doesn't end in one.
 */
function progressStep(line: string): string | null {
    const trimmed = line.trim();
    if (!/\d{1,3}(?:\.\d+)?%$/.test(trimmed)) return null;
    return trimmed.replace(PERCENT, "%");
}

// how far back a progress line looks for its step's earlier count
const PROGRESS_LOOKBACK = 32;

/**
 * Adds a line to a console's lines. A progress line replaces its step's
 * earlier count when only progress lines stand between them, so a start
 * shows "Loading world data: 100%" once, not a hundred times, even while
 * Terraria reprints "Finalizing world" between each of its other counts.
 * Any other line in between keeps the earlier count.
 */
function addConsoleLine(lines: ConsoleLine[], line: ConsoleLine): ConsoleLine[] {
    const step = progressStep(String(line.content));
    if (step !== null) {
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - PROGRESS_LOOKBACK); i--) {
            const earlier = progressStep(String(lines[i]!.content));
            if (earlier === null) break;
            if (earlier === step) return [...lines.slice(0, i), ...lines.slice(i + 1), line];
        }
    }
    return [...lines, line];
}

export class ServerConsole {
    #pending: ConsoleLine[] = [];
    #timer: ReturnType<typeof setTimeout> | null = null;
    constructor(private readonly server: Server) {}

    /** a line of the game's output; `error` when the game reads it as one */
    push(content: string, error: boolean): void {
        // a game's first line can start with byte order marks (Terraria writes one each start): they are no text
        content = content.replace(/^\uFEFF+/, "");
        if (!content) return;
        this.#pending = addConsoleLine(this.#pending, { type: error ? "error" : "info", content }).slice(-CONSOLE_LINES);
        this.#timer ??= setTimeout(() => this.flush(), 100);
    }

    /** publishes the gathered output now */
    flush(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
        if (this.#pending.length === 0) return;
        const lines = this.#pending;
        this.#pending = [];
        // added to what is published now: a line written in between keeps the old progress line
        let entries = this.server.state.serverEntries;
        for (const line of lines) entries = addConsoleLine(entries, line);
        this.server.setState({ serverEntries: entries.slice(-CONSOLE_LINES) });
    }

    /** drops what wasn't published: the server is going away */
    dispose(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = null;
        this.#pending = [];
    }
}
