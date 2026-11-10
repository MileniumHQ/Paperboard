import { terminalApi } from "@mileniumhq/paperapi";

// the most characters (UTF-16 units) one term:write may carry; the daemon
// refuses a longer one (papercrane/rpc/terminal.ts)
export const TERMINAL_WRITE_MAX = 64 * 1024;

// the most one write to a terminal may hold in all. Its pieces are all in
// flight at once, and the daemon closes a socket with over 1024 requests in
// flight, so a paste stays far below that: 256 pieces
export const TERMINAL_PASTE_MAX = 256 * TERMINAL_WRITE_MAX;

const megabytes = (chars: number) => `${Math.round((chars / 1024 / 1024) * 10) / 10} MB`;

/** why `data` can't be written to a terminal, or null when it can */
export function writeRefusal(data: string): string | null {
    if (data.length <= TERMINAL_PASTE_MAX) return null;
    return `This paste is ${megabytes(data.length)}, and a terminal takes at most ${megabytes(TERMINAL_PASTE_MAX)} at once. Nothing was sent.`;
}

/** `data` in pieces of at most `max` units, never splitting a surrogate pair */
export function writeChunks(data: string, max = TERMINAL_WRITE_MAX): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (data.length - start > max) {
        let end = start + max;
        const last = data.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end--;
        chunks.push(data.slice(start, end));
        start = end;
    }
    chunks.push(data.slice(start));
    return chunks;
}

/**
 * Writes text of any length up to TERMINAL_PASTE_MAX to a terminal. Text
 * longer than one write may carry goes as consecutive writes, all sent at
 * once so nothing typed meanwhile lands between them. Rejects with the
 * first refusal, and refuses an oversized paste before sending any of it.
 */
export async function writeTerminal(id: string, data: string): Promise<void> {
    const refusal = writeRefusal(data);
    if (refusal) throw new Error(refusal);
    await Promise.all(writeChunks(data).map((chunk) => terminalApi.write(id, chunk)));
}
