// A child's output, read a line at a time as it arrives.

/**
 * Splits output into lines as it arrives. A line past `max` isn't buffered forever: it's dropped to its
 * end, never read as a line, and `overlong` is told once for it.
 */
export function lineReader(max: number, onLine: (line: string) => void, overlong: () => void) {
    let buf = "";
    let skipping = false;
    return {
        push(data: string) {
            buf += data;
            for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
                if (skipping) skipping = false;
                else onLine(buf.slice(0, i));
                buf = buf.slice(i + 1);
            }
            if (buf.length > max) {
                if (!skipping) overlong();
                skipping = true;
                buf = "";
            }
        },
        /** The output is over: its last line, when it didn't end with one. */
        end() {
            if (buf.trim() && !skipping) onLine(buf);
            buf = "";
        },
    };
}
