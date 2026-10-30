// Where Paperboard opens: Home, or one computer's panel list. Never a
// panel itself: a misbehaving panel shouldn't be the first thing you see.

export const START_ON_HOME = "home";

interface StartComputer {
    id: string;
}

/** the computer to open on launch, or null for Home. A computer that's no
 * longer listed opens Home, and `missing` says so. */
export function startTarget(
    startOn: string,
    computers: StartComputer[],
): { computerId: string | null; missing: boolean } {
    if (startOn === START_ON_HOME) return { computerId: null, missing: false };
    if (computers.some((c) => c.id === startOn)) return { computerId: startOn, missing: false };
    return { computerId: null, missing: true };
}
